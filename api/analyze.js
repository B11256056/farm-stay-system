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
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    let summary = "";
    let totalIncome = 0;
    let totalExpense = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const type = data.type === 'income' ? '收入' : '支出';
      if (data.type === 'income') totalIncome += data.amount;
      else totalExpense += data.amount;
      summary += `- ${data.note || '未命名項目'}: ${type} NT$${data.amount} (${data.category})\n`;
    });

    if (!summary) {
      summary = "目前尚無收支紀錄";
    }

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // 【關鍵修正點】：改用 v1beta 並確認模型路徑
    // 建議使用 gemini-1.5-flash，速度較快且對於簡易分析非常足夠
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `你是一位專業的台灣農場民宿經營分析師。
請根據以下最近的收支數據，提供兩條「繁體中文」的具體經營建議。
建議要實用、具有執行力，並針對農場民宿的特性（如季節性、活動設計或成本控制）。

數據摘要：
總計收入：NT$${totalIncome}
總計支出：NT$${totalExpense}

詳細明細：
${summary}

請直接輸出兩條建議，不要有額外的引言。`
          }]
        }]
      })
    });

    const result = await response.json();

    if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
      return res.status(200).json({ advice: result.candidates[0].content.parts[0].text });
    } else {
      // 輸出更詳細的錯誤資訊以便調試
      const errorMsg = result.error?.message || "Gemini 回傳格式異常";
      console.error("Gemini API Error:", result);
      return res.status(200).json({ advice: `AI 暫時無法分析：${errorMsg}` });
    }
  } catch (error) {
    console.error("System Error:", error);
    return res.status(200).json({ advice: `系統錯誤：${error.message}` });
  }
};
