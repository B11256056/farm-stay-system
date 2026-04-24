const admin = require("firebase-admin");

// 這是核心防錯邏輯：處理環境變數中的 JSON 格式與私鑰換行
const getServiceAccount = () => {
  try {
    const rawData = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawData) throw new Error("找不到環境變數 FIREBASE_SERVICE_ACCOUNT");

    const serviceAccount = JSON.parse(rawData);

    // 重點：強制將字面上的 \n 轉义為真正的換行符號，這是 Firebase SDK 的要求
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    
    return serviceAccount;
  } catch (error) {
    console.error("解析 Service Account 失敗:", error.message);
    return null;
  }
};

// 初始化 Firebase
if (!admin.apps.length) {
  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
}

const db = admin.firestore();

module.exports = async (req, res) => {
  // 只允許 POST 請求
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const data = req.body;
    console.log("收到資料:", data);

    // 寫入 Firestore 'transactions' 集合
    const result = await db.collection('transactions').add({
      type: data.type || 'expense',
      category: data.category || '未分類',
      amount: Number(data.amount) || 0,
      note: data.note || '',
      date: data.date || new Date().toISOString().split('T')[0],
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ success: true, id: result.id });
  } catch (error) {
    console.error("Firebase 寫入錯誤:", error);
    res.status(500).json({ 
      success: false, 
      error: "伺服器忙碌中，請稍後再試。",
      detail: error.message 
    });
  }
};