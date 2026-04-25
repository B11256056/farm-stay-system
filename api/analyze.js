// --- 關鍵修復：改用 v1beta 且確保模型路徑完整 ---
    const API_KEY = (process.env.GEMINI_API_KEY || "").trim();
    
    // 實驗證實：在 REST API 中，v1beta 對於 flash 模型的支援最穩定
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `你是一位農場民宿經營專家，請根據以下數據給予兩條繁體中文建議：\n${summary}` }]
        }]
      })
    });
