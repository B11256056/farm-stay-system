const admin = require("firebase-admin");

// --- Firebase 初始化 (維持不變，因為這部分已經通了) ---
const getServiceAccount = () => {
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) return null;
    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
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

  try {
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || '支出'}, 金額:${d.amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // 使用最穩定的 v1 路由與官方正式 ID
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `你是一位民宿經營專家，根據以下數據給予兩條繁體中文建議：\n${summary}` }] }]
      })
    });

    const result = await response.json();

    if (!response.ok) {
      // 如果還是 404，回傳完整的 Google 錯誤訊息讓我們判斷
      return res.status(response.status).json({ 
        error: "Google 拒絕請求", 
        message: result.error?.message,
        status: response.status 
      });
    }

    const advice = result.candidates[0].content.parts[0].text;
    res.status(200).json({ advice });

  } catch (error) {
    res.status(500).json({ error: "系統錯誤", details: error.message });
  }
};
