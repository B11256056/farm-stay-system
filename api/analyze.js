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

    // 抓取最近的交易紀錄 (增加到 20 筆讓分析更準確)
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

    if (!summary) {
      summary = "目前尚無收支紀錄";
    }

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    /**
     * 【最終修正方案】
     * 嘗試使用 v1 版本的最穩定路徑。
     * 如果 gemini-1.5-flash 持續報錯，可以嘗試切換為 gemini-pro (這是舊版但最穩定的名稱)
     */
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const promptText = `你是一位專業的台灣農場民宿經營分析師。
請根據以下最近的收支數據，提供兩條「繁體中文」的具體經營建議。
建議要實用、具有執行力，並針對農場民宿的特性（如季節性、活動設計或成本控制）。

數據摘要：
總計收入：NT$${totalIncome}
總計支出：NT$${totalExpense}

詳細明細：
${summary}

請直接輸出二至三條建議，使用 Markdown 的列表格式，不要有額外的引言或結語。`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: promptText }]
        }],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 1024,
        }
      })
    });

    const result = await response.json();

    // 增加對 result.error 的直接檢查
    if (result.error) {
      console.error("Gemini API Error Detail:", JSON.stringify(result.error));
      return res.status(200).json({ 
        advice: `AI 服務錯誤 (${result.error.code}): ${result.error.message}` 
      });
    }

    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ advice: result.candidates[0].content.parts[0].text });
    } else {
      return res.status(200).json({ advice: "AI 暫時無法分析：回傳內容格式不正確。" });
    }
  } catch (error) {
    console.error("System Error:", error);
    return res.status(200).json({ advice: `系統錯誤：${error.message}` });
  }
};
