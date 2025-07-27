import * as line from '@line/bot-sdk';
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- KONFIGURASI GITHUB AI (PRIMARY + FALLBACK MODELS) ---
const githubToken = process.env.GITHUB_TOKEN;
const githubEndpoint = "https://models.github.ai/inference";

// Definisikan daftar model yang ingin Anda coba, urutkan dari yang paling disukai
const githubAiModels = [
    "openai/gpt-4.1",
    "openai/gpt-3.5-turbo",
    "meta/Llama-4-Scout-17B-16E-Instruct", // Model cadangan baru Anda
];

let githubAiClient = null;

if (githubToken) {
    try {
        githubAiClient = ModelClient(
            githubEndpoint,
            new AzureKeyCredential(githubToken),
        );
        console.log("GitHub AI client initialized.");
    } catch (e) {
        console.error(`Error initializing GitHub AI client: ${e}`);
        githubAiClient = null;
    }
} else {
    console.log("GITHUB_TOKEN not found. GitHub AI will not be used.");
}

// --- Hapus semua bagian untuk "AI KEDUA (FALLBACK)" jika Anda tidak menggunakannya lagi ---
// Jika Anda tidak punya AI kedua selain GitHub AI, hapus blok ini
// const secondAiApiKey = process.env.GEMINI_API_KEY;
// let secondAiClient = null;
// if (secondAiApiKey) { /* ... inisialisasi Gemini ... */ }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-line-signature'];
  const body = JSON.parse(event.body);

  try {
    const isValidSignature = line.validateSignature(event.body, config.channelSecret, signature);
    if (!isValidSignature) {
        console.error("Invalid signature.");
        return { statusCode: 400, body: 'Invalid signature.' };
    }

    for (const eventItem of body.events) {
      if (eventItem.type === 'message' && eventItem.message.type === 'text') {
        const userMessage = eventItem.message.text;
        let replyText = "";
        let aiUsed = "None";

        // --- COBA AI UTAMA (GITHUB AI) dengan fallback model ---
        if (githubAiClient) {
            let primaryAiSuccess = false;
            for (const currentModel of githubAiModels) { // Loop melalui daftar model
                try {
                    console.log(`Trying GitHub AI with model: ${currentModel} for message: ${userMessage}`);
                    const response = await githubAiClient.path("/chat/completions").post({
                        body: {
                            messages: [
                                { role:"system", content: "selalu balas dengan bahasa gaul anak muda indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu" },
                                { role:"user", content: userMessage }
                            ],
                            temperature: 0.8, // Gunakan temperature dari contoh Anda
                            top_p: 0.1, // Gunakan top_p dari contoh Anda
                            max_tokens: 2048, // Gunakan max_tokens dari contoh Anda
                            model: currentModel // Gunakan model dari loop
                        }
                    });

                    if (isUnexpected(response)) {
                        // Jika ada error dari model ini, coba model berikutnya
                        console.warn(`GitHub AI with model ${currentModel} failed (status: ${response.status || 'unknown'}). Error: ${response.body.error ? JSON.stringify(response.body.error) : 'No error detail'}`);
                        continue; // Lanjutkan ke iterasi berikutnya (model selanjutnya)
                    }

                    replyText = response.body.choices[0].message.content;
                    aiUsed = `GitHub AI (${currentModel})`;
                    console.log(`GitHub AI response (Model: ${currentModel}): ${replyText}`);
                    primaryAiSuccess = true; // Set flag sukses
                    break; // Keluar dari loop karena sudah berhasil
                } catch (e) {
                    // Jika ada error lain (misal network), log dan coba model berikutnya
                    console.warn(`GitHub AI with model ${currentModel} call failed: ${e.message || e}.`);
                    continue; // Lanjutkan ke iterasi berikutnya (model selanjutnya)
                }
            }

            // Jika semua model GitHub AI gagal
            if (!primaryAiSuccess) {
                replyText = "Maaf, semua model AI GitHub gagal merespons. Silakan coba lagi nanti.";
                aiUsed = "None (GitHub AI models failed)";
                console.error("All specified GitHub AI models failed to provide a response.");
            }
        } else {
            // Jika GitHub AI tidak terinisialisasi sama sekali (misal GITHUB_TOKEN tidak ada)
            replyText = "Bot ini belum terhubung dengan AI. Silakan hubungi admin.";
            aiUsed = "None (GitHub AI client not initialized)";
            console.error("GitHub AI client not initialized.");
        }

        await client.replyMessage(eventItem.replyToken, { type: 'text', text: replyText });
        console.log(`Replied with AI: ${aiUsed}`);
      }
    }

    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error("Error handling webhook event:", err);
    return { statusCode: 500, body: `Internal Server Error: ${err.message}` };
  }
};

