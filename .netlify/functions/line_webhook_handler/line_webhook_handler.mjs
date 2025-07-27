import * as line from '@line/bot-sdk'; // Pastikan ini import yang benar setelah perbaikan sebelumnya
import axios from 'axios'; // Masih gunakan axios untuk LINE SDK, tapi tidak untuk GitHub AI lagi

// Import package baru untuk GitHub AI
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Konfigurasi untuk GitHub AI (berdasarkan kode contoh baru Anda)
const githubToken = process.env.GITHUB_TOKEN;
const githubEndpoint = "https://models.github.ai/inference";
const githubModel = "openai/gpt-4.1";

let githubAiClient = null; // Ini akan menjadi instance dari ModelClient

if (githubToken) {
    try {
        githubAiClient = ModelClient(
            githubEndpoint,
            new AzureKeyCredential(githubToken),
        );
        console.log("GitHub AI client initialized with new Azure Rest SDK.");
    } catch (e) {
        console.error(`Error initializing GitHub AI client with new SDK: ${e}`);
        githubAiClient = null;
    }
} else {
    console.log("GITHUB_TOKEN not found. GitHub AI will not be used.");
}


export const handler = async (event) => { // Perhatikan 'export const handler'
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-line-signature'];
  const body = JSON.parse(event.body);

  try {
    const isValidSignature = line.validateSignature(event.body, config.channelSecret, signature);
    if (!isValidSignature) {
        console.error("Invalid signature. Check your channel access token/channel secret.");
        return { statusCode: 400, body: 'Invalid signature. Check your channel access token/channel secret.' };
    }

    for (const eventItem of body.events) {
      if (eventItem.type === 'message' && eventItem.message.type === 'text') {
        const userMessage = eventItem.message.text;
        let replyText = "";

        if (githubAiClient) {
            try {
                console.log(`User message: ${userMessage}`);

                // Panggil API GitHub AI menggunakan client.path().post()
                const response = await githubAiClient.path("/chat/completions").post({
                    body: {
                        messages: [
                            { role:"system", content: "selalu balas dengan bahasa indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu" },
                            { role:"user", content: userMessage } // Gunakan userMessage dari LINE
                        ],
                        temperature: 1,
                        top_p: 1,
                        model: githubModel
                    }
                });

                if (isUnexpected(response)) {
                    // Tangani error dari API GitHub AI
                    throw response.body.error || new Error(`Unexpected response status: ${response.status}`);
                }

                replyText = response.body.choices[0].message.content;
                console.log(`GitHub AI response: ${replyText}`);
            } catch (e) {
                console.error(`Error calling GitHub AI: ${e.message || e}`); // Lebih baik log message error
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

