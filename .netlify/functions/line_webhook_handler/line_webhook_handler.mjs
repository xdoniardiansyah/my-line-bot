import * as line from '@line/bot-sdk';
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import axios from 'axios'; // Import axios

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- KONFIGURASI GITHUB AI (PRIMARY + FALLBACK MODELS) ---
const githubToken = process.env.GITHUB_TOKEN;
const githubEndpoint = "https://models.github.ai/inference";

const githubAiModels = [
    "openai/gpt-4.1",
    "openai/gpt-3.5-turbo",
    "meta/Llama-4-Scout-17B-16E-Instruct",
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

// --- KONFIGURASI OPENWEATHERMAP ---
const openWeatherMapApiKey = process.env.OPENWEATHER_API_KEY;
const openWeatherMapBaseUrl = "https://api.openweathermap.org/data/2.5/weather";


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
        const userMessage = eventItem.message.text.toLowerCase();
        let replyText = "";
        let aiUsed = "None";

        // --- Fitur Kustom: Cuaca ---
        if (userMessage.startsWith("cuaca ")) {
            const city = userMessage.replace("cuaca ", "").trim();
            if (city && openWeatherMapApiKey) {
                try {
                    const weatherResponse = await axios.get(openWeatherMapBaseUrl, {
                        params: {
                            q: city,
                            appid: openWeatherMapApiKey,
                            units: 'metric', // Untuk mendapatkan suhu dalam Celsius
                            lang: 'id'     // Untuk mendapatkan deskripsi dalam Bahasa Indonesia
                        }
                    });

                    const data = weatherResponse.data;
                    const cityName = data.name;
                    const temp = data.main.temp;
                    const description = data.weather[0].description;
                    const humidity = data.main.humidity;
                    const windSpeed = data.wind.speed; // m/s

                    replyText = `Cuaca di ${cityName} saat ini: ${description}, Suhu: ${temp}°C, Kelembaban: ${humidity}%, Kecepatan Angin: ${windSpeed} m/s.`;
                    aiUsed = "Custom: Weather";
                    console.log(`Weather info for ${city}: ${replyText}`);
                } catch (weatherError) {
                    console.error(`Error fetching weather for ${city}:`, weatherError.response ? weatherError.response.data : weatherError.message);
                    if (weatherError.response && weatherError.response.status === 404) {
                        replyText = `Maaf, kota "${city}" tidak ditemukan.`;
                    } else if (weatherError.response && weatherError.response.status === 401) {
                         replyText = "Maaf, API Key OpenWeatherMap tidak valid.";
                    } else {
                        replyText = "Maaf, ada masalah saat mengambil data cuaca. Coba lagi nanti.";
                    }
                    aiUsed = "Custom: Weather (Failed)";
                }
            } else if (!openWeatherMapApiKey) {
                 replyText = "Maaf, fitur cuaca belum dikonfigurasi sepenuhnya (API Key tidak ada).";
                 aiUsed = "Custom: Weather (No API Key)";
            } else {
                 replyText = "Mohon sebutkan nama kota (contoh: cuaca Jakarta).";
                 aiUsed = "Custom: Weather (No City)";
            }
        }
        // --- Fitur Kustom Lain (sebelumnya) ---
        else if (userMessage === "halo") {
            replyText = "Hai juga! Ada yang bisa saya bantu?";
            aiUsed = "Custom: Halo";
        } else if (userMessage.includes("jam berapa")) {
            const currentTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
            replyText = `Sekarang jam ${currentTime} WIB.`;
            aiUsed = "Custom: Jam";
        }
        // --- Akhir Fitur Kustom ---


        // --- Jika tidak ada fitur kustom yang cocok, baru panggil AI ---
        if (replyText === "") {
            if (githubAiClient) {
                let primaryAiSuccess = false;
                for (const currentModel of githubAiModels) {
                    try {
                        console.log(`Trying GitHub AI with model: ${currentModel} for message: ${userMessage}`);
                        const response = await githubAiClient.path("/chat/completions").post({
                            body: {
                                messages: [
                                    { role:"system", content: "selalu balas dengan bahasa indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu" },
                                    { role:"user", content: userMessage }
                                ],
                                temperature: 0.8,
                                top_p: 0.1,
                                max_tokens: 2048,
                                model: currentModel
                            }
                        });

                        if (isUnexpected(response)) {
                            console.warn(`GitHub AI with model ${currentModel} failed (status: ${response.status || 'unknown'}). Error: ${response.body.error ? JSON.stringify(response.body.error) : 'No error detail'}`);
                            continue;
                        }

                        replyText = response.body.choices[0].message.content;
                        aiUsed = `GitHub AI (${currentModel})`;
                        console.log(`GitHub AI response (Model: ${currentModel}): ${replyText}`);
                        primaryAiSuccess = true;
                        break;
                    } catch (e) {
                        console.warn(`GitHub AI with model ${currentModel} call failed: ${e.message || e}.`);
                        continue;
                    }
                }

                if (!primaryAiSuccess) {
                    replyText = "Maaf, semua model AI GitHub gagal merespons. Silakan coba lagi nanti.";
                    aiUsed = "None (GitHub AI models failed)";
                    console.error("All specified GitHub AI models failed to provide a response.");
                }
            } else {
                replyText = "Bot ini belum terhubung dengan AI. Silakan hubungi admin.";
                aiUsed = "None (GitHub AI client not initialized)";
                console.error("GitHub AI client not initialized.");
            }
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

