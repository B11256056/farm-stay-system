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

    // 抓取最近的交易紀錄
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(20).get();
    let summary = "";
    let totalIncome = 0;
    let totalExpense = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const type = data.type === 'income' ? '收入' : '支出';
      const amount = Number(data.amount) || 0;
      if (data.type === 'income') totalIncome += amount;
      else totalExpense += amount;
      summary += `- ${data.note || '項目'}: ${type} NT$${amount} (${data.category || '未分類'})\n`;
    });

    if (!summary || summary === "") {
      summary = "目前尚未有任何收支紀錄。";
    }

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    if (!API_KEY) {
      return res.status(200).json({ advice: "系統錯誤：未設定 GEMINI_API_KEY 環境變數。" });
    }
    
    /**
     * 【極致相容方案】
     * 由於 1.5-flash 頻繁回報 404，改用 gemini-pro。
     * gemini-pro 是 Google 最早期的穩定名稱，通常擁有最高的相容性。
     */
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
    
    const promptText = `你是一位專業的台灣農場民宿經營分析師。
請根據以下最近的收支數據，提供兩條「繁體中文」的具體經營建議。
建議要實用、針對台灣市場、並專注於農事體驗優化或成本控管。

數據摘要：
總計收入：NT$${totalIncome}
總計支出：NT$${totalExpense}

詳細明細：
${summary}

請直接輸出兩條建議，使用 Markdown 列表格式（1. 和 2.），每條建議約 50 字左右。不要有引言或結語。`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        }
      })
    });

    const result = await response.json();

    if (result.error) {
      console.error("Gemini API Error Detail:", JSON.stringify(result.error));
      return res.status(200).json({ 
        advice: `AI 服務錯誤 (${result.error.code}): ${result.error.message}` 
      });
    }

    const adviceText = result.candidates?.[0]?.content?.parts?.[0]?.text;

    if (adviceText) {
      return res.status(200).json({ advice: adviceText.trim() });
    } else {
      return res.status(200).json({ advice: "AI 暫時無法分析，請確保後端數據已正確傳輸。" });
    }
  } catch (error) {
    console.error("System Error:", error);
    return res.status(200).json({ advice: `系統錯誤：${error.message}` });
  }
};
