const admin = require("firebase-admin");

// --- 1. 封裝初始化邏輯，確保只執行一次 ---
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.firestore();

  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) throw new Error("環境變數 FIREBASE_SERVICE_ACCOUNT 缺失");

    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase 初始化成功");
    return admin.firestore();
  } catch (e) {
    console.error("Firebase 初始化失敗:", e.message);
    return null;
  }
};

module.exports = async (req, res) => {
  // 處理 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // --- 2. 在 Handler 內部獲取 db 實例，確保 initializeApp 已完成 ---
    const db = initFirebase();
    if (!db) throw new Error("無法取得 Firestore 實例");

    // 抓取最近 10 筆資料
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || d.category || '未命名'}, 金額:${d.amount}\n`;
    });

    // --- 3. 呼叫 Gemini REST API (v1 正式版) ---
    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `你是一位農場民宿經營專家，請根據以下數據給予兩條繁體中文建議：\n${summary}` }]
        }]
      })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || 'Google API 報錯');

    const advice = result.candidates[0].content.parts[0].text;
    res.status(200).json({ advice });

  } catch (error) {
    console.error("運作時錯誤:", error.message);
    res.status(500).json({ 
      error: "AI 分析失敗", 
      details: error.message 
    });
  }
};
