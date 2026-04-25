const admin = require("firebase-admin");

const initFirebase = () => {
  if (admin.apps.length > 0) return admin.firestore();
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return admin.firestore();
  } catch (e) { return null; }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = initFirebase();
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(5).get();
    let summary = "";
    snapshot.forEach(doc => { summary += `${doc.data().note || '項目'}: ${doc.data().amount}\n`; });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // --- 關鍵修正：改用 gemini-pro，這是目前 404 機率最低的模型 ---
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `你是一位經營專家，請針對以下收支給予兩條繁體中文建議：\n${summary}` }] }]
      })
    });

    const result = await response.json();

    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ advice: result.candidates[0].content.parts[0].text });
    } else {
      // 如果 gemini-pro 也不行，我們就印出具體的 Google 報錯給前端
      const msg = result.error?.message || "模型路徑錯誤";
      return res.status(200).json({ advice: `分析暫時無法產生 (${msg})` });
    }

  } catch (error) {
    return res.status(200).json({ advice: `連線失敗：${error.message}` });
  }
};
