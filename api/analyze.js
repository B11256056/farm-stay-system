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
      console.error("AI 失敗，啟動精確數值判斷分析邏輯:", aiError.message);
      
      let incomeAdvice = "";
      let expenseAdvice = "";

      // 1. 收入邏輯判斷 (門檻：5000 / 1500)
      if (totalIncome >= 5000) {
        incomeAdvice = `目前總收入 NT$${totalIncome} 已達標。建議將「${latestIncomeItem}」品牌化，撥取預算進行在地旅遊社群（如 FB/IG）推廣，並針對高客單價客戶設計專屬的 VIP 回饋活動，鞏固核心營收。`;
      } else if (totalIncome >= 1500 && totalIncome < 5000) {
        incomeAdvice = `目前的收入水位 NT$${totalIncome} 穩定。建議優化「${latestIncomeCategory}」的銷售動線，並利用現場打卡優惠活動吸引新客，穩定目前的營收並尋求突破。`;
      } else if (totalIncome > 0 && totalIncome < 1500) {
        incomeAdvice = `目前總收入 NT$${totalIncome} 偏低。建議重新評估「${latestIncomeItem}」的成本結構與市場定價，或開發與其搭配的微型手作體驗（如農事導覽），以提升整體客單價。`;
      } else {
        incomeAdvice = "目前尚未觀測到收入紀錄。建議檢查產品銷售或住宿預約登錄，確保數據完整以便進行後續分析。";
      }

      // 2. 支出邏輯判斷 (門檻：5000 / 2000)
      if (totalExpense >= 5000) {
        expenseAdvice = `總支出 NT$${totalExpense} 略高。建議詳細複核「固定開銷」與「變動採購」，評估是否有重複性支出，或嘗試與周邊農友集體採購資材以降低 5-10% 的營運成本。`;
      } else if (totalExpense >= 2000 && totalExpense < 5000) {
        expenseAdvice = `支出處於中階管控期（NT$${totalExpense}）。建議建立月度預算對照表，觀察是否有閒置資源，並將資金集中投入於能直接產生回報的生財設備或數位維護。`;
      } else if (totalExpense > 0 && totalExpense < 2000) {
        expenseAdvice = `目前支出 NT$${totalExpense} 控管得宜，處於安全水位。建議將這筆緩衝資金用於農場細部優化，如增設景觀拍照點或修繕老舊指標，提升顧客的品牌印象。`;
      } else {
        expenseAdvice = "目前支出紀錄為零。建議詳細登錄農場日常開支（如飼料、水電、修繕），這對計算精確的淨利潤至關重要。";
      }

      aiAdvice = `1. [經營建議] ${incomeAdvice}\n2. [成本控管] ${expenseAdvice}`;
    }

    return res.status(200).json({ advice: aiAdvice });

  } catch (error) {
    return res.status(200).json({ advice: "分析系統優化中，請稍後重新嘗試。" });
  }
};
