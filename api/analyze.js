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
  // 設定 CORS 標頭，允許跨網域呼叫
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    if (!db) throw new Error("Firebase 初始化失敗");

    // 抓取最近 5 筆支出紀錄
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(5).get();
    let summary = "";
    snapshot.forEach(doc => { 
      summary += `${doc.data().note || '支出'}: ${doc.data().amount}\n`; 
    });

    // 取得環境變數中的 API KEY
    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    // 使用 v1beta 路由以支援最新模型
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `你是一位經營專家，請針對以下五筆收支給予兩條繁體中文建議：\n${summary}` }] }]
      })
    });

    const result = await response.json();

    // 回傳成功結果
    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ advice: result.candidates[0].content.parts[0].text });
    } else {
      const errorMsg = result.error?.message || JSON.stringify(result);
      return res.status(200).json({ advice: `API 回應異常：${errorMsg}` });
    }

  } catch (error) {
    return res.status(200).json({ advice: `系統錯誤：${error.message}` });
  }
};
