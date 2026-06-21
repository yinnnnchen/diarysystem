require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
db.init();

// Helper to get Gemini client
function getGeminiClient(clientKey) {
  const apiKey = clientKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API Key is missing. Please set it in the backend .env or provide it in the settings.');
  }
  return new GoogleGenerativeAI(apiKey);
}

// Endpoint: Check API status
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

// Endpoint: Analyze diary content
app.post('/api/diaries/analyze', async (req, res) => {
  const { content, key } = req.body;
  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Diary content cannot be empty.' });
  }

  try {
    const ai = getGeminiClient(key);
    const model = ai.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: { responseMimeType: 'application/json' }
    });

    const systemPrompt = `
      你是一個專業的心理諮商師與情感分析AI。請詳細分析以下日記內容，並回傳一份符合JSON格式的分析報告。
      
      請依據日記文字的情感特徵、語意上下文、事件，評估以下指標並填入對應欄位：
      1. emotion_score (整體情緒分數)：介於 1 到 100 之間。1 代表極度悲傷/負面，100 代表極度快樂/正向，50 代表中性。
      2. stress_index (壓力指數)：介於 1 到 100 之間，評估日記中所顯露的心理或工作/課業壓力。
      3. anxiety_index (焦慮指數)：介於 1 到 100 之間，評估日記中表現出的焦慮、擔憂或不安傾向。
      4. stability_index (情緒穩定度指數)：介於 1 到 100 之間，評估情緒的波動劇烈程度（波動越少，穩定度越高）。
      5. positive_emotions：由日記中識別出的正向情緒詞彙陣列 (如：["開心", "平靜", "感激"])。
      6. negative_emotions：由日記中識別出的負向情緒詞彙陣列 (如：["焦慮", "疲憊", "憤怒"])。
      7. summary：以心理諮商師角度，用溫暖的語氣對當天日記做出的語意摘要（限 80 字內）。
      8. advice：根據情緒與壓力指數，提供溫馨的心理健康與生活作息建議，必須包含以下面向（限 150 字內）：
         - 放鬆與解壓建議
         - 作息與生活提醒
         - 壓力管理建議
      
      請務必回傳標準 JSON 格式，不加額外的 Markdown 標籤（如 \`\`\`json ），直接回傳 JSON 物件。
      JSON Schema:
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
      contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n日記內容如下：\n"${content}"` }] }]
    });

    const text = result.response.text();
    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch (parseError) {
      console.error('Failed to parse Gemini response as JSON. Raw response:', text);
      // Fallback regex extraction if JSON parsing fails
      throw new Error('API returned an invalid format. Please try again.');
    }

    res.json(analysis);
  } catch (error) {
    console.error('Gemini analysis failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Save or update diary
app.post('/api/diaries', async (req, res) => {
  const { date, content, analysis } = req.body;
  if (!date || !content) {
    return res.status(400).json({ error: 'Date and content are required.' });
  }

  try {
    const diaryData = {
      date,
      content,
      emotion_score: analysis?.emotion_score ?? 50,
      stress_index: analysis?.stress_index ?? 0,
      anxiety_index: analysis?.anxiety_index ?? 0,
      stability_index: analysis?.stability_index ?? 50,
      positive_emotions: analysis?.positive_emotions ?? [],
      negative_emotions: analysis?.negative_emotions ?? [],
      summary: analysis?.summary ?? '',
      advice: analysis?.advice ?? '',
      raw_ai_response: JSON.stringify(analysis ?? {})
    };

    const saved = await db.saveDiary(diaryData);
    res.json(saved);
  } catch (error) {
    console.error('Save diary failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Get all diaries
app.get('/api/diaries', async (req, res) => {
  try {
    const list = await db.getAllDiaries();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Get diary by date
app.get('/api/diaries/:date', async (req, res) => {
  try {
    const diary = await db.getDiaryByDate(req.params.date);
    if (!diary) {
      return res.status(404).json({ error: 'Diary entry not found for this date.' });
    }
    res.json(diary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Delete diary
app.delete('/api/diaries/:date', async (req, res) => {
  try {
    const result = await db.deleteDiary(req.params.date);
    res.json({ success: true, message: `Deleted ${result.changes} entry.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Statistical data
app.get('/api/stats', async (req, res) => {
  try {
    const diaries = await db.getAllDiaries();
    if (diaries.length === 0) {
      return res.json({
        totalCount: 0,
        averages: { emotion: 50, stress: 0, anxiety: 0, stability: 50 },
        recentTrends: [],
        emotionsDistribution: { positive: {}, negative: {} }
      });
    }

    let totalEmotion = 0;
    let totalStress = 0;
    let totalAnxiety = 0;
    let totalStability = 0;
    const posWordCount = {};
    const negWordCount = {};

    diaries.forEach(d => {
      totalEmotion += d.emotion_score;
      totalStress += d.stress_index;
      totalAnxiety += d.anxiety_index;
      totalStability += d.stability_index;

      d.positive_emotions.forEach(w => {
        if (w) posWordCount[w] = (posWordCount[w] || 0) + 1;
      });
      d.negative_emotions.forEach(w => {
        if (w) negWordCount[w] = (negWordCount[w] || 0) + 1;
      });
    });

    const count = diaries.length;

    res.json({
      totalCount: count,
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
    res.status(500).json({ error: error.message });
  }
});

// Catch-all: Route other traffic to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
