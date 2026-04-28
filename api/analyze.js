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

    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(20).get();
    let summary = "";
    let totalIncome = 0;
    let totalExpense = 0;
    let categories = {};

    snapshot.forEach(doc => {
      const data = doc.data();
      const amount = Number(data.amount) || 0;
      if (data.type === 'income') {
        totalIncome += amount;
      } else {
        totalExpense += amount;
      }
      const cat = data.category || '一般';
      categories[cat] = (categories[cat] || 0) + amount;
      summary += `- ${data.note || '項目'}: ${data.type === 'income' ? '收入' : '支出'} NT$${amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // 【終極網址方案】嘗試 v1 配合最新 flash 模型
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const promptText = `你是一位台灣農場民宿經營專家。請針對以下收支給予兩條繁體中文經營建議。
數據：收入 NT$${totalIncome}, 支出 NT$${totalExpense}。
細節：
${summary || "暫無紀錄"}
請直接列出建議。`;

    let aiAdvice = "";

    try {
      if (!API_KEY) throw new Error("Missing API Key");

      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      const result = await response.json();

      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        aiAdvice = result.candidates[0].content.parts[0].text.trim();
      } else if (result.error) {
        throw new Error(result.error.message);
      }
    } catch (aiError) {
      console.error("AI 呼叫失敗，啟用備援建議系統:", aiError.message);
      
      // 【備援分析系統】如果 AI 報錯，由程式邏輯產生建議
      if (totalIncome > 0 && totalExpense === 0) {
        aiAdvice = "1. 目前營收表現穩定，建議可提撥部分盈餘進行線上社群廣告投放，擴大潛在客群。\n2. 建議針對高單價項目設計「早鳥優惠」或「回訪折扣」，鎖定忠實客戶。";
      } else if (totalExpense > totalIncome) {
        aiAdvice = "1. 當前支出高於收入，建議審視固定資產維護與食材採購成本，尋找更具性價比的在地供應商。\n2. 考慮開發「半日遊」或「手作體驗」等低成本、高毛利的活動，快速增加現金流。";
      } else {
        aiAdvice = "1. 建議定期分析客戶偏好，將熱門項目打包成組合套票提升客單價。\n2. 維持良好的環境維護紀錄，並將農場日常更新至社群平台以增加品牌信任感。";
      }
    }

    return res.status(200).json({ advice: aiAdvice });

  } catch (error) {
    return res.status(200).json({ advice: `系統發生非預期錯誤：${error.message}` });
  }
};
