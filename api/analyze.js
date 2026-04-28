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

    // 抓取最近 20 筆交易紀錄
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(20).get();
    let summary = "";
    let totalIncome = 0;
    let totalExpense = 0;
    let latestIncomeItem = "";
    let latestIncomeCategory = "";

    snapshot.forEach(doc => {
      const data = doc.data();
      const amount = Number(data.amount) || 0;
      if (data.type === 'income') {
        totalIncome += amount;
        if (!latestIncomeItem) {
          latestIncomeItem = data.note || "產品銷售";
          latestIncomeCategory = data.category || "一般收入";
        }
      } else {
        totalExpense += amount;
      }
      summary += `- ${data.note}: ${data.type === 'income' ? '收入' : '支出'} NT$${amount}\n`;
    });

    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // 改用最基礎、相容性最高的 v1/gemini-pro 端點
    const API_URL = `https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent?key=${API_KEY}`;
    
    const promptText = `你是一位台灣農場民宿經營專家。請針對以下收支給予兩條繁體中文經營建議。
數據：總收入 NT$${totalIncome}, 總支出 NT$${totalExpense}。
細節：
${summary || "暫無紀錄"}
請直接列出建議，不要有引言。`;

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
      } else {
        throw new Error("AI 端點無回應，切換至專業邏輯引擎");
      }
    } catch (aiError) {
      console.error("AI 失敗，啟動數值判斷分析邏輯:", aiError.message);
      
      let incomeAdvice = "";
      let expenseAdvice = "";

      // 1. 收入邏輯判斷
      if (totalIncome >= 5000) {
        incomeAdvice = `目前總收入 NT$${totalIncome} 表現優異，建議提撥 15% 作為「${latestIncomeItem}」相關的品牌推廣基金，例如拍攝高品質宣傳圖或投放社群廣告，擴大穩定客源。`;
      } else if (totalIncome > 0 && totalIncome < 1500) {
        incomeAdvice = `目前總收入為 NT$${totalIncome}，金額較低。建議審視「${latestIncomeCategory}」的定價策略，或考慮將「${latestIncomeItem}」與其他體驗活動綑綁銷售，提高單次消費客單價。`;
      } else if (totalIncome >= 1500 && totalIncome < 5000) {
        incomeAdvice = `目前收入狀況平穩。建議建立「${latestIncomeItem}」的顧客滿意度回訪機制，透過收集評論獲取更多口碑推薦。`;
      } else {
        incomeAdvice = "目前尚未有收入紀錄，建議儘早開始記錄農場產品銷售或住宿預約，以便系統進行初步分析。";
      }

      // 2. 支出邏輯判斷
      if (totalExpense >= 5000) {
        expenseAdvice = `總支出已達到 NT$${totalExpense}。建議立即檢視成本明細，特別是固定資產維護或大量採購項目，評估是否能與在地農場結盟採購，以爭取更佳的折扣空間。`;
      } else if (totalExpense > 0 && totalExpense < 2000) {
        expenseAdvice = `目前支出 NT$${totalExpense} 控管得宜。建議在低支出的緩衝期內，小額投入場域綠化或基礎設施微調，以維持農場對新客的視覺吸引力。`;
      } else if (totalExpense >= 2000 && totalExpense < 5000) {
        expenseAdvice = `支出處於中階範圍。建議建立月度成本對照表，觀察是否有週期性浪費，並將省下的資金投入數位預約系統的維護。`;
      } else {
        expenseAdvice = "目前支出紀錄為零。建議詳細記錄所有必要開銷（如飼料、維修、水電），以計算精確的農場獲利率。";
      }

      aiAdvice = `1. [收入分析] ${incomeAdvice}\n2. [財務建議] ${expenseAdvice}`;
    }

    return res.status(200).json({ advice: aiAdvice });

  } catch (error) {
    return res.status(200).json({ advice: "分析系統優化中，請稍後重新嘗試。" });
  }
};
