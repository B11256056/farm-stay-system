const admin = require("firebase-admin");

// 封裝初始化邏輯
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.firestore();
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) return null;
    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    return admin.firestore();
  } catch (e) {
    console.error("Firebase Init Error:", e.message);
    return null;
  }
};

// 導出主函數，確保它是 async
module.exports = async (req, res) => {
  // CORS 設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const db = initFirebase();
    if (!db) throw new Error("Firebase 尚未準備就緒");

    // 1. 抓取資料
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || d.category || '未命名'}, 金額:${d.amount}\n`;
    });

    // 2. 呼叫 Gemini REST API
    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    // 使用 globalThis.fetch 或直接 fetch (Node.js 18+)
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `你是一位民宿經營專家，請根據以下數據給予兩條繁體中文建議：\n${summary}` }]
        }]
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || 'Gemini API 呼叫失敗');
    }

    const advice = result.candidates[0].content.parts[0].text;
    res.status(200).json({ advice });

  } catch (error) {
    console.error("Runtime Error:", error.message);
    res.status(500).json({ 
      error: "AI 分析失敗", 
      details: error.message 
    });
  }
};
