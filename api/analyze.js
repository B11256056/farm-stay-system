const admin = require("firebase-admin");

// --- Firebase 初始化 (已驗證成功) ---
const initFirebase = () => {
  if (admin.apps.length > 0) return admin.firestore();
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) return null;
    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
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
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      summary += `項目:${d.note || d.category || '未命名'}, 金額:${d.amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // --- 核心改動：嘗試多個模型路徑 ---
    const modelsToTry = [
      "gemini-1.5-flash",
      "gemini-pro"
    ];
    
    let advice = "";
    let lastError = "";

    for (const modelName of modelsToTry) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `你是一位民宿經營專家，根據以下收支給予兩條繁體中文建議：\n${summary}` }] }]
          })
        });

        const result = await response.json();
        if (response.ok && result.candidates) {
          advice = result.candidates[0].content.parts[0].text;
          break; // 成功拿到資料，跳出迴圈
        } else {
          lastError = result.error?.message || "未知錯誤";
        }
      } catch (e) {
        lastError = e.message;
      }
    }

    if (!advice) throw new Error(`所有模型均不可用。最後一個錯誤: ${lastError}`);

    res.status(200).json({ advice });

  } catch (error) {
    res.status(500).json({ error: "AI 分析失敗", details: error.message });
  }
};
