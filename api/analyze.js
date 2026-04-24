const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

/**
 * 核心防錯邏輯：處理環境變數中的 Firebase 私鑰換行問題
 */
const getServiceAccount = () => {
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) throw new Error("找不到環境變數 FIREBASE_SERVICE_ACCOUNT");

    // 解析 JSON
    const serviceAccount = JSON.parse(rawData);

    // 強制將字面上的 \n 轉義為真正的換行符號，解決 Vercel 解析失敗的問題
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    return serviceAccount;
  } catch (error) {
    console.error("Service Account 解析失敗:", error.message);
    return null;
  }
};

// 1. 初始化 Firebase (確保不重複初始化)
if (!admin.apps.length) {
  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase 初始化成功");
    } catch (initError) {
      console.error("Firebase 初始化失敗:", initError.message);
    }
  }
}

const db = admin.firestore();

// --- Gemini 初始化與除錯邏輯 ---
const rawApiKey = process.env.GEMINI_API_KEY;
let genAI;

if (!rawApiKey) {
    console.error("CRITICAL ERROR: 環境變數 GEMINI_API_KEY 是空的！請檢查 Vercel 設定。");
} else {
    // 【關鍵修復】使用 .trim() 移除可能誤加的換行符或隱形空格
    const cleanApiKey = rawApiKey.trim();
    // 輸出前四碼以便在 Vercel Log 中確認變數確實存在且正確
    console.log("Gemini API Key 已載入，字首確認為:", cleanApiKey.substring(0, 4));
    genAI = new GoogleGenerativeAI(cleanApiKey);
}

module.exports = async (req, res) => {
  // 設定 CORS 讓前端可以順利呼叫
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 檢查 Gemini 是否成功初始化
    if (!genAI) {
        throw new Error("Gemini API 未能初始化，請檢查 API Key 設定。");
    }

    // 2. 從 Firestore 抓取最近的紀錄
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    
    if (snapshot.empty) {
      return res.status(200).json({ advice: "目前資料庫還沒有收支紀錄喔！請先新增一些帳目，我才能幫你分析。" });
    }

    let dataSummary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      dataSummary += `日期:${d.date || '未註記'}, 類型:${d.type || '未知'}, 類別:${d.category || '未分類'}, 金額:${d.amount || 0}, 備註:${d.note || '無'}\n`;
    });

    // 3. 呼叫 Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `你是一位專業的農場民宿經營專家。
    以下是這間民宿最近的 10 筆收支數據：
    ${dataSummary}
    
    請針對這些數據，以專業、親切的口吻提供兩條具體的經營建議（例如如何節省開支或增加收入）。請用繁體中文回答。`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // 4. 回傳結果
    res.status(200).json({ advice: text });

  } catch (error) {
    console.error("API Error 詳細資訊:", error);
    // 回傳更友善的錯誤訊息
    res.status(500).json({ 
      error: "AI 分析暫時無法運作", 
      details: error.message 
    });
  }
};
