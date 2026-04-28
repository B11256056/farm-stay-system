const admin = require("firebase-admin");

const initFirebase = () => {
  if (admin.apps.length > 0) return admin.firestore();
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return admin.firestore();
  } catch (e) {
    return null;
  }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    if (!db) throw new Error("Firebase 初始化失敗");

    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(5).get();
    let summary = "";
    snapshot.forEach(doc => {
      const data = doc.data();
      const type = data.type === 'income' ? '收入' : '支出';
      summary += `${data.note || '項目'}: ${type} ${data.amount}元 (${data.category})\n`;
    });

    if (!summary) {
      summary = "目前尚無收支紀錄";
    }

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent?key=${API_KEY}`;
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `你是一位台灣民宿經營專家，請根據以下收支紀錄給予兩條繁體中文建議，建議要實用且針對農場民宿經營：\n${summary}`
          }]
        }]
      })
    });

    const result = await response.json();

    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ advice: result.candidates[0].content.parts[0].text });
    } else {
      const errorMsg = result.error?.message || "Gemini 無法產生回應";
      return res.status(200).json({ advice: `AI 暫時無法分析：${errorMsg}` });
    }
  } catch (error) {
    return res.status(200).json({ advice: `系統錯誤：${error.message}` });
  }
};
