require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const app = express();
const PORT = process.env.PORT || 3000;

// Use the modular firebase-admin submodule imports instead of the
// top-level `require('firebase-admin')` namespace object. Newer
// firebase-admin releases have been inconsistent about which properties
// (apps / credential / auth) are exposed on that top-level object, but
// 'firebase-admin/app' and 'firebase-admin/auth' are the stable,
// documented entry points across current versions.
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

app.use(cors());
app.use(express.json());

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

    console.log('目前使用者 UID:', decodedToken.uid);

    next();

  } catch (error) {
    console.error('Firebase Token 驗證失敗:', error.message);

    return res.status(401).json({
      error: '登入驗證失敗，請重新登入'
    });
  }
}

function getGeminiClient(clientKey) {
  const apiKey = clientKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Gemini API Key is missing. Please set it in backend .env.'
    );
  }
  return new GoogleGenerativeAI(apiKey);
}


app.get('/api/status', (req, res) => {
  const hasEnvKey = !!process.env.GEMINI_API_KEY;
  res.json({
    status: 'ok',
    hasEnvKey,
    message: hasEnvKey
      ? 'System running with backend Gemini API key configured.'
      : 'System running, but Gemini API key needs to be configured.'
  });
});

app.post('/api/diaries/analyze', authenticateUser, async (req, res) => {

  const { content, key } = req.body;

  if (!content || content.trim() === '') {

    return res.status(400).json({
      error: 'Diary content cannot be empty.'
    });

  }

  try {

    console.log(
      `AI 分析日記 - UID: ${req.user.uid}`
    );

    const ai = getGeminiClient(key);

    const model = ai.getGenerativeModel({

      model: 'gemini-2.5-flash',

      generationConfig: {
        responseMimeType: 'application/json'
      }

    });

    const systemPrompt = `
你是一個專業的心理諮商師與情感分析AI。

請詳細分析以下日記內容，並回傳一份符合JSON格式的分析報告。

請依據日記文字的情感特徵、語意上下文、事件，評估以下指標：

1. emotion_score：
介於 1 到 100。
1 代表極度悲傷/負面，
100 代表極度快樂/正向，
50 代表中性。

2. stress_index：
介於 1 到 100，
評估日記中所顯露的心理或工作/課業壓力。

3. anxiety_index：
介於 1 到 100，
評估日記中表現出的焦慮、擔憂或不安。

4. stability_index：
介於 1 到 100，
評估情緒波動程度。
波動越少，穩定度越高。

5. positive_emotions：
正向情緒詞彙陣列。

6. negative_emotions：
負向情緒詞彙陣列。

7. summary：
以溫暖語氣摘要當天日記，
限 80 字內。

8. advice：
提供溫馨的心理健康與生活建議，
限 150 字內。

必須包含：

- 放鬆與解壓建議
- 作息與生活提醒
- 壓力管理建議

請務必回傳標準 JSON，
不要加入 Markdown。

JSON Schema：

{
  "emotion_score": number,
  "stress_index": number,
  "anxiety_index": number,
  "stability_index": number,
  "positive_emotions": string[],
  "negative_emotions": string[],
  "summary": string,
  "advice": string
}
`;

    const result = await model.generateContent({

      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `${systemPrompt}\n\n日記內容如下：\n"${content}"`
            }
          ]
        }
      ]

    });

    const text = result.response.text();

    let analysis;

    try {

      analysis = JSON.parse(text);

    } catch (error) {

      console.error(
        'Gemini JSON 解析失敗:',
        text
      );

      throw new Error(
        'AI 回傳格式錯誤，請重新分析。'
      );

    }

    res.json(analysis);

  } catch (error) {

    console.error(
      'Gemini analysis failed:',
      error.message
    );

    res.status(500).json({
      error: error.message
    });

  }

});


// ========================================
// 新增 / 修改日記
// ========================================

app.post('/api/diaries', authenticateUser, async (req, res) => {

  const { date, content, analysis } = req.body;

  if (!date || !content) {

    return res.status(400).json({
      error: 'Date and content are required.'
    });

  }

  try {

    const userId = req.user.uid;

    console.log(
      `儲存日記 - UID: ${userId}, 日期: ${date}`
    );

    const diaryData = {

      user_id: userId,

      date,
      content,

      emotion_score:
        analysis?.emotion_score ?? 50,

      stress_index:
        analysis?.stress_index ?? 0,

      anxiety_index:
        analysis?.anxiety_index ?? 0,

      stability_index:
        analysis?.stability_index ?? 50,

      positive_emotions:
        analysis?.positive_emotions ?? [],

      negative_emotions:
        analysis?.negative_emotions ?? [],

      summary:
        analysis?.summary ?? '',

      advice:
        analysis?.advice ?? '',

      raw_ai_response:
        JSON.stringify(analysis ?? {})

    };

    const saved =
      await db.saveDiary(diaryData);

    res.json(saved);

  } catch (error) {

    console.error(
      'Save diary failed:',
      error.message
    );

    res.status(500).json({
      error: error.message
    });

  }

});


// ========================================
// 取得「自己的」所有日記
// ========================================

app.get('/api/diaries', authenticateUser, async (req, res) => {

  try {

    const list =
      await db.getAllDiaries(req.user.uid);

    res.json(list);

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

});


app.get('/api/diaries/:date', authenticateUser, async (req, res) => {

  try {

    const diary =
      await db.getDiaryByDate(
        req.user.uid,
        req.params.date
      );


    if (!diary) {

      return res.status(404).json({
        error: 'Diary entry not found for this date.'
      });

    }


    res.json(diary);

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

});
app.delete('/api/diaries/:date', authenticateUser, async (req, res) => {

  try {

    const result =
      await db.deleteDiary(
        req.user.uid,
        req.params.date
      );


    res.json({
      success: true,
      message:
        `Deleted ${result.changes} entry.`
    });

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

});

app.get('/api/stats', authenticateUser, async (req, res) => {

  try {

    const userId = req.user.uid;

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
        }

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

        if (w) {
          posWordCount[w] =
            (posWordCount[w] || 0) + 1;
        }

      });


      (d.negative_emotions || []).forEach(w => {

        if (w) {
          negWordCount[w] =
            (negWordCount[w] || 0) + 1;
        }

      });

    });


    const count = diaries.length;


    res.json({

      totalCount: count,

      averages: {

        emotion:
          Math.round(totalEmotion / count),

        stress:
          Math.round(totalStress / count),

        anxiety:
          Math.round(totalAnxiety / count),

        stability:
          Math.round(totalStability / count)

      },

      recentTrends:

        diaries.slice(-14).map(d => ({

          date: d.date,

          emotion_score:
            d.emotion_score,

          stress_index:
            d.stress_index,

          anxiety_index:
            d.anxiety_index,

          stability_index:
            d.stability_index

        })),

      emotionsDistribution: {

        positive: posWordCount,

        negative: negWordCount

      }

    });

  } catch (error) {

    res.status(500).json({
      error: error.message
    });

  }

});


// ========================================
// Catch-all
// (middleware, not app.get('*', ...) — a bare '*' route
//  throws a path-to-regexp error and crashes startup on Express 5)
// ========================================

app.use((req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      'public',
      'index.html'
    )
  );

});


// ========================================
// Start Server
// (wait for the DB to finish initializing before accepting requests)
// ========================================

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(
      `Server is running at http://localhost:${PORT}`
    );
  });
}).catch((err) => {
  console.error('資料庫初始化失敗，伺服器未啟動:', err.message);
  process.exit(1);
});