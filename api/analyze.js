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
    console.error("Firebase Init Error:", e.message);
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
    if (!db) throw new Error("Firebase Fail");

    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = snapshot.empty ? "無資料" : "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || '支出'}, 金額:${d.amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `你是一位民宿經營專家，根據以下收支給予兩條繁體中文建議：\n${summary}` }] }]
      })
    });

    const result = await response.json();

    // --- 關鍵容錯處理 ---
    if (result.candidates && result.candidates[0] && result.candidates[0].content) {
      const text = result.candidates[0].content.parts[0].text;
      return res.status(200).json({ advice: text });
    } else {
      console.error("Google Error Details:", JSON.stringify(result));
      return res.status(500).json({ 
        error: "AI 格式錯誤", 
        details: result.error?.message || "無法從 Gemini 取得內容" 
      });
    }

  } catch (error) {
    console.error("Runtime Error:", error.message);
    return res.status(500).json({ error: "AI 分析失敗", details: error.message });
  }
};
