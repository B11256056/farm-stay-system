const { GoogleGenerativeAI } = require("@google/generative-ai");
const admin = require("firebase-admin");

// Firebase 初始化邏輯
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
  if (cert) admin.initializeApp({ credential: admin.credential.cert(cert) });
}

const db = admin.firestore();
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY?.trim() || "");

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    // 1. 抓取資料
    const snapshot = await db.collection('transactions').orderBy('date', 'desc').limit(10).get();
    if (snapshot.empty) return res.status(200).json({ advice: "目前還沒有資料可以分析喔！" });

    let dataSummary = "";
    snapshot.forEach(doc => {
      const d = doc.data();
      dataSummary += `類型:${d.type}, 金額:${d.amount}, 備註:${d.note}\n`;
    });

    // 2. 呼叫 Gemini (關鍵修復：使用 -latest 標籤)
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    
    const prompt = `你是一位經營專家。根據以下數據給予兩條繁體中文建議：\n${dataSummary}`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    res.status(200).json({ advice: text });

  } catch (error) {
    console.error("Final Error Log:", error.message);
    res.status(500).json({ error: "AI 分析失敗", details: error.message });
  }
};
