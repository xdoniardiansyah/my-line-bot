import * as line from '@line/bot-sdk';
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import axios from 'axios'; // Import axios untuk fitur cuaca

// --- KONFIGURASI LINE BOT ---
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- KONFIGURASI GITHUB AI (PRIMARY + FALLBACK MODELS) ---
const githubToken = process.env.GITHUB_TOKEN;
const githubEndpoint = "https://models.github.ai/inference";

// Definisikan daftar model GitHub AI yang ingin Anda coba, urutkan dari yang paling disukai
const githubAiModels = [
    "openai/gpt-4.1",
    "openai/gpt-3.5-turbo",
    "meta/Llama-4-Scout-17B-16E-Instruct", // Model cadangan Llama
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


// --- FUNGSI UTAMA HANDLER ---
export const handler = async (event) => {
  // Pastikan method adalah POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const signature = event.headers['x-line-signature'];
  const body = JSON.parse(event.body);

  try {
    // Validasi signature dari LINE
    const isValidSignature = line.validateSignature(event.body, config.channelSecret, signature);
    if (!isValidSignature) {
        console.error("Invalid signature. Check your channel access token/channel secret.");
        return { statusCode: 400, body: 'Invalid signature. Check your channel access token/channel secret.' };
    }

    // Loop melalui setiap event dari LINE
    for (const eventItem of body.events) {
      if (eventItem.type === 'message' && eventItem.message.type === 'text') {
        const userMessage = eventItem.message.text.toLowerCase(); // Ubah ke lowercase untuk perbandingan mudah
        let replyText = "";
        let aiUsed = "None"; // Untuk logging, AI/fitur mana yang berhasil digunakan

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
                    const windSpeed = data.wind.speed;

                    // Logika untuk menentukan emoji berdasarkan deskripsi cuaca
                    let weatherEmoji = '☁️'; // Default
                    if (description.includes('cerah') || description.includes('terang') || description.includes('panas')) {
                        weatherEmoji = '☀️'; // Matahari
                    } else if (description.includes('hujan')) {
                        weatherEmoji = '🌧️'; // Hujan
                    } else if (description.includes('berawan') || description.includes('awan') || description.includes('mendung')) {
                        weatherEmoji = '☁️'; // Awan
                    } else if (description.includes('badai') || description.includes('petir')) {
                        weatherEmoji = '⛈️'; // Badai
                    } else if (description.includes('kabut')) {
                        weatherEmoji = '🌫️'; // Kabut
                    } else if (description.includes('salju')) {
                        weatherEmoji = '❄️'; // Salju
                    } else {
                        weatherEmoji = '🌡️'; // Suhu umum jika tidak ada yang cocok
                    }

                    // Template jawaban cuaca yang Anda inginkan (sederhana + emoji)
                    replyText = `Di ${cityName} ${weatherEmoji} ${description}. Suhu ${temp}°C.`;

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
        // --- Fitur Kustom Lain yang tidak digunakan telah dihapus di sini ---


        // --- Jika tidak ada fitur kustom yang cocok, baru panggil AI ---
        if (replyText === "") { // Hanya panggil AI jika belum ada balasan dari fitur kustom
            if (githubAiClient) {
                let primaryAiSuccess = false;
                for (const currentModel of githubAiModels) { // Loop melalui daftar model
                    try {
                        console.log(`Trying GitHub AI with model: ${currentModel} for message: ${userMessage}`);
                        const response = await githubAiClient.path("/chat/completions").post({
                            body: {
                                messages: [
                                    { role:"system", content: "selalu balas dengan bahasa gaul jakarta jaksel indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu" },
                                    { role:"user", content: userMessage }
                                ],
                                temperature: 0.8, // Parameter disesuaikan untuk model AI
                                top_p: 0.1,     // Parameter disesuaikan untuk model AI
                                max_tokens: 2048, // Parameter disesuaikan untuk model AI
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
        }

        // Balas pesan ke LINE
        await client.replyMessage(eventItem.replyToken, { type: 'text', text: replyText });
        console.log(`Replied with AI: ${aiUsed}`);
      }
    }

    return { statusCode: 200, body: 'OK' }; // Beri tahu LINE bahwa permintaan berhasil diproses

  } catch (err) {
    // Tangani error yang tidak terduga pada tingkat handler
    console.error("Error handling webhook event:", err);
    return { statusCode: 500, body: `Internal Server Error: ${err.message}` };
  }
};

