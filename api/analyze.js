const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

// --- Firebase 初始化 ---
const getServiceAccount = () => {
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) return null;
    const serviceAccount = JSON.parse(rawData);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    return serviceAccount;
  } catch (e) { return null; }
};

if (!admin.apps.length) {
  const cert = getServiceAccount();
  if (cert) {
    admin.initializeApp({ credential: admin.credential.cert(cert) });
  }
}

const db = admin.firestore();
// 確保 API Key 前後沒有空格
const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").trim());

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. 從 Firestore 抓取數據
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    
    let summary = "";
    if (snapshot.empty) {
      summary = "目前無收支紀錄。";
    } else {
      snapshot.forEach(doc => {
        const d = doc.data();
        summary += `項目:${d.note || d.category || '未命名'}, 金額:${d.amount}\n`;
      });
    }

    // 2. 呼叫 Gemini (關鍵修復：使用最通用的模型名稱)
    // 如果 gemini-1.5-flash 報 404，SDK 可能在尋找 v1 版本而非 v1beta
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    const prompt = `你是一位專業的民宿經營顧問。以下是最近的收支狀況：\n${summary}\n請提供兩條簡短的繁體中文經營建議。`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    res.status(200).json({ advice: text });

  } catch (error) {
    console.error("API Execution Error:", error.message);
    res.status(500).json({ 
      error: "AI 分析失敗", 
      details: error.message 
    });
  }
};
