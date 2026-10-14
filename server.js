require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const app = express();
const PORT = process.env.PORT || 3000;

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

if (!getApps().length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    try {
      const serviceAccount = JSON.parse(
        Buffer.from(
          process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
          'base64'
        ).toString('utf8')
      );

      initializeApp({
        credential: cert(serviceAccount)
      });

      console.log('Firebase Admin 初始化成功');
    } catch (e) {
      console.error('FIREBASE_SERVICE_ACCOUNT_BASE64 內容無法解析:', e.message);
      process.exit(1);
    }
  } else {
    console.error('缺少 FIREBASE_SERVICE_ACCOUNT_BASE64，伺服器無法驗證登入，已中止啟動。');
    process.exit(1);
  }
}

// CORS 白名單：預設只允許本站網域與本機開發；可用 ALLOWED_ORIGINS（逗號分隔）覆寫
const DEFAULT_ORIGINS = [
  'https://aidiary-tap6.onrender.com',
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`
];
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : DEFAULT_ORIGINS;

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  }
}));
app.use(express.json());

// 健康檢查：供外部定時喚醒，不需登入、不碰資料庫
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use(express.static(path.join(__dirname, 'public')));

async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: '未登入，請先登入 Google 帳號'
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await getAuth().verifyIdToken(idToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Firebase Token 驗證失敗:', error.message);
    return res.status(401).json({
      error: '登入驗證失敗，請重新登入'
    });
  }
}

// Gemini 模型名稱可用環境變數 GEMINI_MODEL 覆寫，之後換模型不必改程式、只要改環境變數並重啟。
// 目前固定使用 gemini-2.5-flash。依官方停用公告（2026/10/12 更新），2.5 系列尚未宣布停用，
// 但 Google 已限制「過去曾使用過 2.5 的專案」才能繼續存取；若日後出現 404 / 無權限錯誤，
// 請改用環境變數 GEMINI_MODEL 指定新模型（例如 gemini-3.8-flash）。公告：
// https://ai.google.dev/gemini-api/docs/deprecations
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Gemini API Key is missing. Please configure GEMINI_API_KEY in backend .env.'
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * 安全解析 AI 回傳的 JSON，過濾開頭與結尾的 Markdown 圍欄字元
 */
function safeParseAiJson(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('AI 回傳內容為空');
  }
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

const CRISIS_KEYWORDS = [
  '自殺', '想死', '不想活', '活不下去', '結束生命', '自我了斷',
  '自殘', '割腕', '傷害自己', '消失就好', '沒有存在的意義',
  '想離開這個世界', '解脫了'
];

const RISK_LEVELS = ['none', 'low', 'medium', 'high'];

function normalizeRiskLevel(value) {
  const level = String(value || '').toLowerCase().trim();
  return RISK_LEVELS.includes(level) ? level : 'none';
}

function detectCrisis(content) {
  if (!content) return false;
  return CRISIS_KEYWORDS.some(keyword => content.includes(keyword));
}

const CRISIS_RESOURCES = {
  message: '我們注意到這篇日記的內容可能反映出強烈的情緒困擾。你並不孤單，專業的協助隨時都在。',
  hotlines: [
    { name: '衛福部安心專線', phone: '1925', available: '24 小時' },
    { name: '生命線協談專線', phone: '1995', available: '24 小時' },
    { name: '張老師專線', phone: '1980', available: '9:00-21:00' }
  ]
};

// ========================================
// 輸入驗證、頻率限制與日期工具
// ========================================
const MAX_DIARY_LENGTH = 5000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDaysToDateStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // 固定在中午 12:00 UTC，防止跨日光節約時間或午夜時區抖動
  const date = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function clampScore(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : fallback;
}

function cleanText(value, maxLen) {
  return typeof value === 'string' ? value.slice(0, maxLen) : '';
}

function cleanList(list, maxItems = 20, maxLen = 30) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => typeof item === 'string' && item.trim() !== '')
    .slice(0, maxItems)
    .map(item => item.slice(0, maxLen));
}

function taipeiDateStr(d = new Date()) {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

const rateBuckets = new Map();

function rateLimit(limit, windowMs) {
  return (req, res, next) => {
    const key = `${req.user.uid}:${req.path}`;
    const now = Date.now();
    const recent = (rateBuckets.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= limit) {
      return res.status(429).json({ error: '操作太頻繁，請稍後再試。' });
    }
    recent.push(now);
    rateBuckets.set(key, recent);
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, times] of rateBuckets) {
    if (!times.some(t => t > cutoff)) rateBuckets.delete(key);
  }
}, 10 * 60 * 1000).unref();

app.param('date', (req, res, next, value) => {
  if (!isValidDate(value)) {
    return res.status(400).json({ error: '日期格式錯誤，需為 YYYY-MM-DD。' });
  }
  next();
});

const DEFAULT_FALLBACK_MODELS = [];

const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ||
  process.env.GEMINI_FALLBACK_MODEL || 
  ''
).split(',').map(m => m.trim()).filter(Boolean);

const GEMINI_MODEL_CHAIN = [
  GEMINI_MODEL,
  ...(GEMINI_FALLBACK_MODELS.length ? GEMINI_FALLBACK_MODELS : DEFAULT_FALLBACK_MODELS)
].filter((name, i, arr) => name && arr.indexOf(name) === i);

function isRetryableGeminiError(err) {
  const msg = String((err && err.message) || '');
  return /\b(429|500|502|503|504)\b/.test(msg) ||
    /overloaded|high demand|unavailable|timeout|timed out|ECONNRESET|fetch failed/i.test(msg);
}

function isModelUnavailableError(err) {
  const msg = String((err && err.message) || '');
  return /\b404\b/.test(msg) ||
    /not found|is not supported|no longer available|deprecated|shut ?down|retired/i.test(msg);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function generateWithFallback(ai, request) {
  let lastError;

  for (let m = 0; m < GEMINI_MODEL_CHAIN.length; m++) {
    const modelName = GEMINI_MODEL_CHAIN[m];
    const maxAttempts = GEMINI_MODEL_CHAIN.length === 1 ? 3 : (m === 0 ? 2 : 1);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const model = ai.getGenerativeModel({
          model: modelName,
          generationConfig: { responseMimeType: 'application/json' }
        });
        const result = await model.generateContent(request);
        if (m > 0) console.warn(`Gemini 已改用備援模型：${modelName}`);
        return result;
      } catch (err) {
        lastError = err;
        const canMoveOn = isRetryableGeminiError(err) || isModelUnavailableError(err);
        if (!canMoveOn) throw err; 
        if (isModelUnavailableError(err)) break;
        if (attempt < maxAttempts - 1) await sleep(1200 * (attempt + 1));
      }
    }
    console.warn(`Gemini 模型 ${modelName} 暫時無法使用，嘗試下一個備援模型`);
  }
  throw lastError;
}

app.get('/api/status', (req, res) => {
  const hasEnvKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: 'ok',
    hasEnvKey,
    message: hasEnvKey
      ? 'System running with backend Gemini API key configured.'
      : 'System running, but the administrator needs to configure GEMINI_API_KEY on the backend.'
  });
});

app.post('/api/diaries/analyze', authenticateUser, rateLimit(10, 60 * 1000), async (req, res) => {
  const { content } = req.body;

  if (typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      error: 'Diary content cannot be empty.'
    });
  }

  if (content.length > MAX_DIARY_LENGTH) {
    return res.status(400).json({
      error: `日記內容過長，請控制在 ${MAX_DIARY_LENGTH} 字以內。`
    });
  }

  try {
    console.log('AI 分析日記請求');

    const ai = getGeminiClient();

    const systemPrompt = `
你是一個情緒分析與生活支持的AI助理，不是醫師或心理師。
請不要做任何醫療或精神疾病的診斷，不要提及疾病名稱，也不要提供用藥建議。
若內容顯示使用者可能有嚴重的情緒困擾，advice 請溫和地鼓勵尋求專業協助或信任的人。

請詳細分析以下日記內容，並回傳一份符合JSON格式的分析報告。

請依據日記文字的情感特徵、語意上下文、事件，評估以下指標：

1. emotion_score：介於 1 到 100。1 代表極度悲傷/負面，100 代表極度快樂/正向，50 代表中性。
2. stress_index：介於 1 到 100，評估日記中所顯露的心理或工作/課業壓力。
3. anxiety_index：介於 1 到 100，評估日記中表現出的焦慮、擔憂或不安。
4. stability_index：介於 1 到 100，評估情緒波動程度。波動越少，穩定度越高。
5. positive_emotions：正向情緒詞彙陣列。
6. negative_emotions：負向情緒詞彙陣列。
7. summary：以溫暖語氣摘要當天日記，限 80 字內。
8. advice：提供溫馨的心理健康與生活建議，限 150 字內。必須包含放鬆建議、作息提醒與壓力管理。
9. risk_level：評估自傷、自殺或強烈絕望風險，只能是下列四個字串之一："none"、"low"、"medium"、"high"。

請務必回傳標準 JSON，不要加入 Markdown。

JSON Schema：
{
  "emotion_score": number,
  "stress_index": number,
  "anxiety_index": number,
  "stability_index": number,
  "positive_emotions": string[],
  "negative_emotions": string[],
  "summary": string,
  "advice": string,
  "risk_level": "none" | "low" | "medium" | "high"
}
`;

    const result = await generateWithFallback(ai, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${systemPrompt}\n\n日記內容如下：\n"${content}"`
            }
          ]
        }
      ]
    });

    const text = result.response.text();
    let analysis;
    try {
      analysis = safeParseAiJson(text);
    } catch (error) {
      console.error('Gemini JSON 解析失敗:', text);
      throw new Error('AI 回傳格式錯誤，請重新分析。');
    }

    const keywordHit = detectCrisis(content);
    let riskLevel = normalizeRiskLevel(analysis.risk_level);
    if (keywordHit && (riskLevel === 'none' || riskLevel === 'low')) {
      riskLevel = 'medium';
    }
    const crisisAlert =
      keywordHit || riskLevel === 'medium' || riskLevel === 'high';

    res.json({
      ...analysis,
      risk_level: riskLevel,
      crisis_alert: crisisAlert,
      crisis_resources: crisisAlert ? CRISIS_RESOURCES : null
    });
  } catch (error) {
    console.error('Gemini analysis failed:', error.message);

    const fallbackCrisis = detectCrisis(content);
    const friendlyError =
      error.message === 'AI 回傳格式錯誤，請重新分析。'
        ? error.message
        : (isRetryableGeminiError(error) || isModelUnavailableError(error))
          ? 'AI 服務目前較為忙碌，請稍等幾秒後再試一次。'
          : '分析服務暫時無法使用，請稍後再試。';

    res.status(500).json({
      error: friendlyError,
      ...(fallbackCrisis
        ? { crisis_alert: true, crisis_resources: CRISIS_RESOURCES }
        : {})
    });
  }
});

// ========================================
// 新增 / 修改日記
// ========================================
app.post('/api/diaries', authenticateUser, async (req, res) => {
  const { date, content, analysis } = req.body;

  if (!isValidDate(date) || typeof content !== 'string' || content.trim() === '') {
    return res.status(400).json({
      error: 'Date (YYYY-MM-DD) and content are required.'
    });
  }

  if (content.length > MAX_DIARY_LENGTH) {
    return res.status(400).json({
      error: `日記內容過長，請控制在 ${MAX_DIARY_LENGTH} 字以內。`
    });
  }

  try {
    const userId = req.user.uid;
    console.log(`儲存日記 - 日期: ${date}`);

    const diaryData = {
      user_id: userId,
      date,
      content,
      emotion_score: clampScore(analysis?.emotion_score, 50),
      stress_index: clampScore(analysis?.stress_index, 0),
      anxiety_index: clampScore(analysis?.anxiety_index, 0),
      stability_index: clampScore(analysis?.stability_index, 50),
      positive_emotions: cleanList(analysis?.positive_emotions),
      negative_emotions: cleanList(analysis?.negative_emotions),
      summary: cleanText(analysis?.summary, 1000),
      advice: cleanText(analysis?.advice, 1000),
      crisis_alert: analysis?.crisis_alert === true,
      risk_level: normalizeRiskLevel(analysis?.risk_level),
      raw_ai_response: JSON.stringify(analysis ?? {}).slice(0, 10000)
    };

    const saved = await db.saveDiary(diaryData);
    res.json(saved);
  } catch (error) {
    console.error('Save diary failed:', error.message);
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

// ========================================
// 取得「自己的」所有日記
// ========================================
app.get('/api/diaries', authenticateUser, async (req, res) => {
  try {
    const list = await db.getAllDiaries(req.user.uid);
    res.json(list);
  } catch (error) {
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

app.get('/api/diaries/:date', authenticateUser, async (req, res) => {
  try {
    const diary = await db.getDiaryByDate(req.user.uid, req.params.date);
    if (!diary) {
      return res.status(404).json({
        error: 'Diary entry not found for this date.'
      });
    }
    res.json(diary);
  } catch (error) {
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

app.delete('/api/diaries/:date', authenticateUser, async (req, res) => {
  try {
    const result = await db.deleteDiary(req.user.uid, req.params.date);
    res.json({
      success: true,
      message: `Deleted ${result.changes} entry.`
    });
  } catch (error) {
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

app.delete('/api/diaries', authenticateUser, async (req, res) => {
  try {
    const count = await db.clearAllDiaries(req.user.uid);
    res.json({
      success: true,
      message: `已清空 ${count} 篇日記。`
    });
  } catch (error) {
    console.error('清空日記失敗:', error.message);
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

// ========================================
// 個人化建議追蹤
// ========================================
app.patch('/api/diaries/:date/advice-status', authenticateUser, async (req, res) => {
  try {
    const { completed } = req.body;
    if (typeof completed !== 'boolean') {
      return res.status(400).json({ error: 'completed must be a boolean.' });
    }

    const updated = await db.updateAdviceStatus(
      req.user.uid,
      req.params.date,
      completed
    );

    if (!updated) {
      return res.status(404).json({
        error: 'Diary entry not found for this date.'
      });
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

// ========================================
// AI 週報 / 月報
// ========================================
app.post('/api/diaries/report', authenticateUser, rateLimit(5, 60 * 1000), async (req, res) => {
  try {
    const period = req.body.period === 'month' ? 'month' : 'week';
    const todayStr = taipeiDateStr();
    const daysBack = period === 'month' ? 29 : 6;
    const startDateStr = addDaysToDateStr(todayStr, -daysBack);
    const endDateStr = todayStr;
    const diaries = await db.getDiariesInRange(
      req.user.uid,
      startDateStr,
      endDateStr
    );

    if (diaries.length === 0) {
      return res.json({
        period,
        totalCount: 0,
        message: '這段期間內尚無日記紀錄，寫下幾篇日記後即可產生報告。'
      });
    }

    const count = diaries.length;
    const avg = (key) =>
      Math.round(
        diaries.reduce((sum, d) => sum + (Number(d[key]) || 0), 0) / count
      );

    const periodStats = {
      emotion: avg('emotion_score'),
      stress: avg('stress_index'),
      anxiety: avg('anxiety_index'),
      stability: avg('stability_index')
    };

    const diarySummaries = diaries.map(d =>
      `${d.date}｜情緒:${d.emotion_score} 壓力:${d.stress_index} 焦慮:${d.anxiety_index} 穩定:${d.stability_index}｜摘要:${d.summary || '(無摘要)'}`
    ).join('\n');

    const ai = getGeminiClient();
    const reportPrompt = `
你是一個情緒分析與生活支持的AI助理，不是醫師或心理師，請勿做任何醫療或精神疾病的診斷、也不要提供用藥建議。以下是使用者在${period === 'month' ? '過去一個月' : '過去一週'}內，
每日日記的每日摘要與心理指標（情緒、壓力、焦慮、穩定度，皆為 1-100 分）：

${diarySummaries}

請根據這些每日紀錄，統整成一份整體性的${period === 'month' ? '月報' : '週報'}，並以 JSON 格式回傳，內容包含：

{
  "overview": "以溫暖語氣，200字內總結這段期間整體的心理狀態變化",
  "trend_insight": "觀察到的情緒/壓力趨勢變化（例如：週初到週末的起伏、是否逐漸好轉或惡化），100字內",
  "top_stressors": ["歸納出的主要壓力來源，最多5項，簡短詞語"],
  "positive_highlights": ["這段期間值得肯定或正向的地方，最多5項，簡短詞語"],
  "recommendation": "針對整體狀態的具體生活與心理健康建議，150字內"
}

請務必只回傳標準 JSON，不要加入 Markdown 或其他文字。
`;

    const result = await generateWithFallback(ai, {
      contents: [{ role: 'user', parts: [{ text: reportPrompt }] }]
    });

    const text = result.response.text();
    let report;
    try {
      report = safeParseAiJson(text);
    } catch (error) {
      console.error('報告 JSON 解析失敗:', text);
      throw new Error('AI 報告格式錯誤，請重新產生。');
    }

    const weekdayLabels = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const weekdayBuckets = Array.from({ length: 7 }, () => []);
    diaries.forEach(d => {
      const day = new Date(d.date + 'T00:00:00').getDay();
      weekdayBuckets[day].push(Number(d.emotion_score) || 0);
    });
    const weekdayAverages = weekdayBuckets.map((bucket, i) => ({
      label: weekdayLabels[i],
      average: bucket.length
        ? Math.round(bucket.reduce((a, b) => a + b, 0) / bucket.length)
        : null,
      count: bucket.length
    }));

    res.json({
      period,
      totalCount: count,
      startDate: startDateStr,
      endDate: endDateStr,
      periodStats,
      weekdayAverages,
      ...report
    });
  } catch (error) {
    console.error('產生報告失敗:', error.message);
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

app.get('/api/stats', authenticateUser, async (req, res) => {
  try {
    const diaries = await db.getAllDiaries(req.user.uid);

    if (diaries.length === 0) {
      return res.json({
        totalCount: 0,
        averages: {
          emotion: 50,
          stress: 0,
          anxiety: 0,
          stability: 50
        },
        recentTrends: [],
        emotionsDistribution: {
          positive: {},
          negative: {}
        },
        streak: 0
      });
    }

    let totalEmotion = 0;
    let totalStress = 0;
    let totalAnxiety = 0;
    let totalStability = 0;

    const posWordCount = {};
    const negWordCount = {};

    diaries.forEach(d => {
      totalEmotion += Number(d.emotion_score) || 0;
      totalStress += Number(d.stress_index) || 0;
      totalAnxiety += Number(d.anxiety_index) || 0;
      totalStability += Number(d.stability_index) || 0;

      (d.positive_emotions || []).forEach(w => {
        if (w) posWordCount[w] = (posWordCount[w] || 0) + 1;
      });

      (d.negative_emotions || []).forEach(w => {
        if (w) negWordCount[w] = (negWordCount[w] || 0) + 1;
      });
    });

    const count = diaries.length;
    const dateSet = new Set(diaries.map(d => d.date));
    const toDateStr = (d) => taipeiDateStr(d);
    let streak = 0;
    let checkDate = taipeiDateStr();
    if (!dateSet.has(checkDate)) {
      checkDate = addDaysToDateStr(checkDate, -1);
    }
    while (dateSet.has(checkDate)) {
      streak += 1;
      checkDate = addDaysToDateStr(checkDate, -1);
    }

    res.json({
      totalCount: count,
      streak,
      averages: {
        emotion: Math.round(totalEmotion / count),
        stress: Math.round(totalStress / count),
        anxiety: Math.round(totalAnxiety / count),
        stability: Math.round(totalStability / count)
      },
      recentTrends: diaries.slice(-14).map(d => ({
        date: d.date,
        emotion_score: d.emotion_score,
        stress_index: d.stress_index,
        anxiety_index: d.anxiety_index,
        stability_index: d.stability_index
      })),
      emotionsDistribution: {
        positive: posWordCount,
        negative: negWordCount
      }
    });
  } catch (error) {
    res.status(500).json({
      error: '伺服器發生錯誤，請稍後再試。'
    });
  }
});

// ========================================
// Catch-all
// ========================================
app.use((req, res) => {
  // 避免未定義的 API 請求回傳 index.html 造成前端 JSON 解析錯誤
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========================================
// Start Server
// ========================================
db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('資料庫初始化失敗，伺服器未啟動:', err.message);
  process.exit(1);
});