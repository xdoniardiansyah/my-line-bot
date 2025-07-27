import line from '@line/bot-sdk';
import axios from 'axios'; // Import axios

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

let githubAiConfig = null;
const githubToken = process.env.GITHUB_TOKEN;

if (githubToken) {
    githubAiConfig = {
        endpoint: "https://models.github.ai/inference",
        model: "openai/gpt-4.1",
        headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Content-Type': 'application/json'
        }
    };
    console.log("GitHub AI configuration loaded.");
} else {
    console.log("GITHUB_TOKEN not found. GitHub AI will not be used.");
}

const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-line-signature'];
  const body = JSON.parse(event.body);

  try {
    // Line SDK parser webhook
    // Catatan: line.validateSignature bisa digunakan jika parseWebhook tidak tersedia atau ingin validasi manual
    const isValidSignature = line.validateSignature(event.body, config.channelSecret, signature);
    if (!isValidSignature) {
        console.error("Invalid signature. Check your channel access token/channel secret.");
        return { statusCode: 400, body: 'Invalid signature. Check your channel access token/channel secret.' };
    }

    // Loop melalui setiap event dari LINE
    for (const eventItem of body.events) {
      if (eventItem.type === 'message' && eventItem.message.type === 'text') {
        const userMessage = eventItem.message.text;
        let replyText = "";

        if (githubAiConfig) {
            try {
                console.log(`User message: ${userMessage}`);
                const aiPayload = {
                    messages: [
                        { role: "system", content: "selalu balas dengan bahasa indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu" },
                        { role: "user", content: userMessage },
                    ],
                    temperature: 1,
                    top_p: 1,
                    model: githubAiConfig.model
                };

                const response = await axios.post(githubAiConfig.endpoint, aiPayload, {
                    headers: githubAiConfig.headers
                });

                replyText = response.data.choices[0].message.content;
                console.log(`GitHub AI response: ${replyText}`);
            } catch (e) {
                console.error(`Error calling GitHub AI: ${e.response ? e.response.data : e.message}`);
                replyText = "Maaf, saya tidak bisa memproses permintaan Anda saat ini karena masalah dengan AI. Silakan coba lagi nanti.";
            }
        } else {
            replyText = "Bot ini belum terhubung dengan AI (GitHub). Silakan hubungi admin.";
        }

        await client.replyMessage(eventItem.replyToken, { type: 'text', text: replyText });
      }
    }

    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error("Error handling webhook event:", err);
    return { statusCode: 500, body: `Internal Server Error: ${err.message}` };
  }
};

export { handler }; // Penting untuk .mjs

