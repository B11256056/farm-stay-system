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

    // 抓取最近 20 筆交易紀錄，按日期降序排列
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(20).get();
    let summary = "";
    let totalIncome = 0;
    let totalExpense = 0;
    let latestIncomeNote = "";

    snapshot.forEach(doc => {
      const data = doc.data();
      const amount = Number(data.amount) || 0;
      if (data.type === 'income') {
        totalIncome += amount;
        // 抓取第一筆（最新的）收入項目名稱
        if (!latestIncomeNote) latestIncomeNote = data.note;
      } else {
        totalExpense += amount;
      }
      summary += `- ${data.note || '未命名'}: ${data.type === 'income' ? '收入' : '支出'} NT$${amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;
    
    const promptText = `你是一位台灣農場民宿經營專家。請針對以下收支給予兩條繁體中文經營建議。
數據：總收入 NT$${totalIncome}, 總支出 NT$${totalExpense}。
細節：
${summary || "暫無紀錄"}
請直接列出建議，不要有引言或結語。`;

    let aiAdvice = "";

    try {
      if (!API_KEY) throw new Error("缺少 API Key");

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
      } else {
        throw new Error("AI 無法分析，啟用本地引擎");
      }
    } catch (aiError) {
      console.error("AI 呼叫失敗:", aiError.message);
      // 備援邏輯優化：根據最新的收入項目進行分析
      if (totalIncome > 0) {
        const target = latestIncomeNote || "農場產品";
        aiAdvice = `1. 針對「${target}」相關營收，建議可建立客戶名單，並在下個產季前發送早鳥預購通知，穩定現金流。
2. 目前支出控管良好，建議撥出小額經費進行場域美化或增設打卡點，提升社群媒體曝光度。`;
      } else if (totalExpense > 0) {
        aiAdvice = `1. 目前支出主要集中在營運維護，建議定期檢視耗材庫存，嘗試與在地農友集體採購以降低單價。
2. 建議開發低成本的農事體驗活動（如導覽或種植），在不增加顯著支出的情況下創造新收入。`;
      } else {
        aiAdvice = "1. 系統目前尚無足夠紀錄。建議每日登錄收支，積累數據後 AI 將能提供更精準的農場獲利分析。";
      }
    }

    return res.status(200).json({ advice: aiAdvice });

  } catch (error) {
    return res.status(200).json({ advice: "系統處理中，請確保資料已正確登錄。" });
  }
};
