const admin = require("firebase-admin");

// --- Firebase 初始化 ---
const getServiceAccount = () => {
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) return null;
    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    return serviceAccount;
  } catch (e) { return null; }
};

if (!admin.apps.length) {
  const cert = getServiceAccount();
  if (cert) admin.initializeApp({ credential: admin.credential.cert(cert) });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. 抓取資料
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || d.category || '未命名'}, 金額:${d.amount}\n`;
    });

    // 2. 切換到 v1 正式版路由 (原本是 v1beta)
    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `你是一位農場經營顧問，請根據以下數據給予兩條繁體中文建議：\n${summary}` }]
        }]
      })
    });

    const result = await response.json();

    if (!response.ok) {
      // 這裡會印出 Google 真正的錯誤原因（例如：API_KEY_INVALID 或地區限制）
      throw new Error(result.error?.message || 'Google API 呼叫失敗');
    }

    const advice = result.candidates[0].content.parts[0].text;
    res.status(200).json({ advice });

  } catch (error) {
    console.error("REST API v1 Error:", error.message);
    res.status(500).json({ error: "AI 分析失敗", details: error.message });
  }
};
