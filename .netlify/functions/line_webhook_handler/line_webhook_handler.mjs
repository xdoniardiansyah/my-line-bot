import * as line from '@line/bot-sdk';
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import axios from 'axios';
import SpotifyWebApi from 'spotify-web-api-node';

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

// --- KONFIGURASI SPOONACULAR API ---
const spoonacularApiKey = process.env.SPOONACULAR_API_KEY; // Ambil API Key dari Environment Variables
const spoonacularBaseUrl = "https://api.spoonacular.com";

// --- KONFIGURASI SPOTIFY API (Inisialisasi Manual) ---
const spotifyClientId = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

let spotifyClient = null; // Deklarasi spotifyClient
if (spotifyClientId && spotifyClientSecret) {
    spotifyClient = new SpotifyWebApi({
        clientId: spotifyClientId,
        clientSecret: spotifyClientSecret,
    });

    // Ambil token akses klien (client credentials flow)
    // Untuk fungsi serverless, paling aman mengambilnya di setiap invokasi atau menggunakan cache yang cerdas
    spotifyClient.clientCredentialsGrant()
        .then(data => {
            console.log('Spotify access token obtained. Expires in:', data.body['expires_in'], 'seconds.');
            spotifyClient.setAccessToken(data.body['access_token']);
        })
        .catch(err => {
            console.error('Error getting Spotify access token:', err.message);
            spotifyClient = null; // Set null jika gagal otentikasi
        });
} else {
    console.warn("SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET not found. Spotify features will be limited.");
}

// --- KONFIGURASI KLIK RESI API ---
const klikResiApiKey = process.env.KLIK_RESI_API_KEY;
const klikResiBaseUrl = "https://klikresi.com/api"; // Endpoint dasar Klik Resi


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
                            units: 'metric',
                            lang: 'id'
                        }
                    });

                    const data = weatherResponse.data;
                    const cityName = data.name;
                    const temp = data.main.temp;
                    const rawDescription = data.weather[0].description;
                    const humidity = data.main.humidity;
                    const windSpeed = data.wind.speed;

                    let weatherEmoji = '☁️';
                    let displayDescription = rawDescription;

                    if (rawDescription.includes('cerah') || rawDescription.includes('clear')) {
                        weatherEmoji = '☀️';
                        displayDescription = 'cerah';
                    } else if (rawDescription.includes('hujan') || rawDescription.includes('rain')) {
                        weatherEmoji = '🌧️';
                        if (rawDescription.includes('ringan')) displayDescription = 'hujan ringan';
                        else if (rawDescription.includes('sedang')) displayDescription = 'hujan sedang';
                        else if (rawDescription.includes('lebat')) displayDescription = 'hujan lebat';
                        else displayDescription = 'hujan';
                    } else if (rawDescription.includes('berawan') || rawDescription.includes('clouds') || rawDescription.includes('mendung')) {
                        weatherEmoji = '☁️';
                        if (rawDescription.includes('pecah') || rawDescription.includes('broken')) {
                            displayDescription = 'berawan (awan terpencar)';
                        } else if (rawDescription.includes('tersebar') || rawDescription.includes('scattered')) {
                            displayDescription = 'berawan tersebar';
                        } else if (rawDescription.includes('sebagian') || rawDescription.includes('few')) {
                            displayDescription = 'sebagian berawan';
                        } else if (rawDescription.includes('padat') || rawDescription.includes('overcast')) {
                            displayDescription = 'mendung tebal';
                        } else {
                            displayDescription = 'berawan';
                        }
                    } else if (rawDescription.includes('badai') || rawDescription.includes('storm')) {
                        weatherEmoji = '⛈️';
                        displayDescription = 'badai';
                    } else if (rawDescription.includes('kabut') || rawDescription.includes('mist') || rawDescription.includes('fog')) {
                        weatherEmoji = '🌫️';
                        displayDescription = 'berkabut';
                    } else if (rawDescription.includes('salju') || rawDescription.includes('snow')) {
                        weatherEmoji = '❄️';
                        displayDescription = 'bersalju';
                    } else {
                        weatherEmoji = '🌡️';
                        displayDescription = 'kondisi tidak diketahui';
                    }

                    replyText = `Di ${cityName} ${weatherEmoji} ${displayDescription}. Suhu ${temp}°C.`;

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
        // --- Fitur Kustom: Spoonacular API ---
        else if (userMessage.startsWith("resep acak")) {
            if (spoonacularApiKey) {
                try {
                    const response = await axios.get(`${spoonacularBaseUrl}/recipes/random`, {
                        params: {
                            number: 1, // Hanya ingin 1 resep
                            apiKey: spoonacularApiKey
                        }
                    });
                    const recipe = response.data.recipes[0];
                    if (recipe) {
                        const summary = recipe.summary ? recipe.summary.replace(/<[^>]*>/g, '') : 'Tidak ada ringkasan.';
                        const categories = recipe.dishTypes && recipe.dishTypes.length > 0
                            ? recipe.dishTypes.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ') // Kapitalisasi huruf pertama
                            : 'Tidak diketahui';

                        replyText = `✨ Resep Acak untuk Kamu! ✨\n\n` +
                                    `🍳 ${recipe.title}\n` +
                                    `    • Kategori: ${categories}\n` +
                                    `    • Waktu Siap: ⏱️ ${recipe.readyInMinutes || '?'} menit\n\n` +
                                    `📝 Ringkasan:\n` +
                                    `${summary.substring(0, Math.min(summary.length, 250))}...\n\n` +
                                    `➡️ Yuk, lihat resep lengkapnya di sini:\n` +
                                    `${recipe.sourceUrl || 'Tidak ada link.'}`;

                    } else {
                        replyText = "Maaf, tidak dapat menemukan resep acak saat ini. 😕";
                    }
                    aiUsed = "Custom: Spoonacular Random Recipe";
                } catch (e) {
                    console.error("Error fetching Spoonacular random recipe:", e.response ? e.response.data : e.message);
                    replyText = "Maaf, ada masalah saat mengambil resep acak. Coba lagi nanti atau cek API Key Spoonacular Anda. 🙏";
                    aiUsed = "Custom: Spoonacular Random Recipe (Failed)";
                }
            } else {
                replyText = "Maaf, fitur resep belum dikonfigurasi (API Key Spoonacular tidak ada). 🛠️";
                aiUsed = "Custom: Spoonacular Random Recipe (No API Key)";
            }
        }
        else if (userMessage.startsWith("cari resep ")) {
            const query = userMessage.replace("cari resep ", "").trim();
            if (query && spoonacularApiKey) {
                try {
                    const response = await axios.get(`${spoonacularBaseUrl}/recipes/complexSearch`, {
                        params: {
                            query: query,
                            number: 1, // Ambil 1 resep teratas
                            addRecipeInformation: true, // Untuk mendapatkan detail seperti summary, instructions
                            apiKey: spoonacularApiKey
                        }
                    });
                    const recipe = response.data.results[0];
                    if (recipe) {
                         const summary = recipe.summary ? recipe.summary.replace(/<[^>]*>/g, '') : 'Tidak ada ringkasan.';
                        const categories = recipe.dishTypes && recipe.dishTypes.length > 0
                            ? recipe.dishTypes.map(d => d.charAt(0).toUpperCase() + d.slice(1)).join(', ')
                            : 'Tidak diketahui';

                        replyText = `✨ Resep Ditemukan! ✨\n\n` +
                                    `🥘 ${recipe.title}\n` +
                                    `    • Kategori: ${categories}\n` +
                                    `    • Waktu Siap: ⏱️ ${recipe.readyInMinutes || '?'} menit\n\n` +
                                    `📝 Ringkasan:\n` +
                                    `${summary.substring(0, Math.min(summary.length, 250))}...\n\n` +
                                    `➡️ Yuk, lihat resep lengkapnya di sini:\n` +
                                    `${recipe.sourceUrl || 'Tidak ada link.'}`;

                    } else {
                        replyText = `Maaf, tidak menemukan resep untuk "${query}". 🧐`;
                    }
                    aiUsed = "Custom: Spoonacular Search Recipe";
                } catch (e) {
                    console.error("Error fetching Spoonacular search recipe:", e.response ? e.response.data : e.message);
                    replyText = "Maaf, ada masalah saat mencari resep. Coba lagi nanti atau cek API Key Spoonacular Anda. 🙏";
                    aiUsed = "Custom: Spoonacular Search Recipe (Failed)";
                }
            } else if (!spoonacularApiKey) {
                replyText = "Maaf, fitur resep belum dikonfigurasi (API Key Spoonacular tidak ada). 🛠️";
                aiUsed = "Custom: Spoonacular Search Recipe (No API Key)";
            } else {
                replyText = "Mohon sebutkan nama resep yang ingin dicari (contoh: cari resep nasi goreng). 🍽️";
                aiUsed = "Custom: Spoonacular Search Recipe (No Query)";
            }
        }
        // --- Fitur Kustom: Spotify (CARI PLAYLIST SAJA) ---
        else if (userMessage.startsWith("cari playlist ")) {
            const query = userMessage.replace("cari playlist ", "").trim();
            if (query) {
                if (!spotifyClient || !spotifyClient.getAccessToken()) {
                    replyText = "Maaf, fitur Spotify belum siap. Coba lagi sebentar.";
                    aiUsed = "Custom: Spotify Playlist Search (Not Ready)";
                } else {
                    try {
                        const data = await spotifyClient.searchPlaylists(query, { limit: 3 });
                        const playlistResults = data.body.playlists.items;

                        if (Array.isArray(playlistResults) && playlistResults.length > 0) {
                            replyText = `🎧 Temuan Playlist Santai di Spotify! 🧘‍♀️\n\n`;
                            playlistResults.forEach((item, index) => {
                                const title = item.name || "Judul playlist tidak diketahui";
                                const owner = (item.owner && item.owner.display_name) ? item.owner.display_name : "Tidak diketahui";
                                const externalUrl = (item.external_urls && item.external_urls.spotify) ? item.external_urls.spotify : "Link tidak tersedia";

                                replyText += `${index + 1}. ${title} oleh ${owner}\n`;
                                replyText += `   Link: ${externalUrl}\n\n`;
                            });
                            replyText = replyText.trim() + "\n\nSemoga hari Anda semakin tenang! 😌";
                        } else {
                            replyText = `Maaf, tidak menemukan playlist di Spotify untuk "${query}". Coba kata kunci lain. 😔`;
                        }
                        aiUsed = "Custom: Spotify Playlist Search";
                    } catch (e) {
                        console.error("Error fetching Spotify playlist search results:", e.message);
                        replyText = "Maaf, ada masalah saat mencari playlist di Spotify. Coba lagi nanti. 🙏";
                        aiUsed = "Custom: Spotify Playlist Search (Failed)";
                    }
                }
            } else {
                replyText = "Mohon sebutkan nama playlist yang ingin dicari (contoh: cari playlist santai). 🎶";
                aiUsed = "Custom: Spotify Playlist Search (No Query)";
            }
        }
        // --- Fitur Kustom: Spotify (CARI LAGU/ARTIS/ALBUM) ---
        else if (userMessage.startsWith("cari spotify ")) {
            const query = userMessage.replace("cari spotify ", "").trim();
            if (query) {
                if (!spotifyClient || !spotifyClient.getAccessToken()) {
                    replyText = "Maaf, fitur Spotify belum siap. Coba lagi sebentar.";
                    aiUsed = "Custom: Spotify Search (Not Ready)";
                } else {
                    try {
                        let foundItems = [];
                        let resultType = "";
                        let closingMessage = "";

                        const data = await spotifyClient.search(query, ['track', 'album', 'artist'], { limit: 3 });

                        if (data.body.tracks && data.body.tracks.items.length > 0) {
                            foundItems = data.body.tracks.items.slice(0, 3);
                            resultType = "Lagu";
                            replyText = `🎵 Melodi yang Ditemukan di Spotify! 🎤\n\n`;
                            closingMessage = "Semoga menemukan irama favoritmu! 🎧";
                        } else if (data.body.albums && data.body.albums.items.length > 0) {
                            foundItems = data.body.albums.items.slice(0, 3);
                            resultType = "Album";
                            replyText = `💿 Koleksi Album Pilihan di Spotify! 🌠\n\n`;
                            closingMessage = "Nikmati setiap lagunya! ✨";
                        } else if (data.body.artists && data.body.artists.items.length > 0) {
                            foundItems = data.body.artists.items.slice(0, 3);
                            resultType = "Artis";
                            replyText = `🌟 Mengenal Lebih Dekat Musisi di Spotify! 🎸\n\n`;
                            closingMessage = "Temukan lebih banyak karya mereka! 🎶";
                        }

                        if (foundItems.length > 0) {
                            foundItems.forEach((item, index) => {
                                const title = item.name || "Judul tidak diketahui";
                                const externalUrl = (item.external_urls && item.external_urls.spotify) ? item.external_urls.spotify : "Link tidak tersedia";

                                replyText += `${index + 1}. ${title}`;

                                if (resultType === "Lagu") {
                                    const artist = (item.artists && item.artists.length > 0 && item.artists[0].name) ? item.artists[0].name : "Artis tidak diketahui";
                                    replyText += ` oleh ${artist}`;
                                } else if (resultType === "Album") {
                                    const artist = (item.artists && item.artists.length > 0 && item.artists[0].name) ? item.artists[0].name : "Artis tidak diketahui";
                                    const releaseYear = item.release_date ? item.release_date.substring(0, 4) : "Tidak diketahui";
                                    replyText += ` oleh ${artist} (${releaseYear})`;
                                }

                                replyText += `\n   Link: ${externalUrl}\n\n`;
                            });
                            replyText = replyText.trim() + `\n\n${closingMessage}`;
                        } else {
                            replyText = `Maaf, tidak menemukan hasil di Spotify untuk "${query}". Coba kata kunci lain. 😔`;
                        }
                        aiUsed = "Custom: Spotify Search";
                    } catch (e) {
                        console.error("Error fetching Spotify search results:", e.message);
                        replyText = "Maaf, ada masalah saat mencari di Spotify. Coba lagi nanti. 🙏";
                        aiUsed = "Custom: Spotify Search (Failed)";
                    }
                }
            } else {
                replyText = "Mohon sebutkan lagu, album, atau artis yang ingin dicari di Spotify (contoh: cari spotify Bad Romance). 🎵";
                aiUsed = "Custom: Spotify Search (No Query)";
            }
        }
        // --- Akhir Fitur Kustom Spotify ---

        // --- Fitur Kustom: Cek Resi (Klik Resi) --- [KODE DIPERBAIKI] ---
        const cekResiMatch = userMessage.match(/^cek resi\s+(\S+)\s+(\S+)$/);

        if (cekResiMatch) {
            const courierCode = cekResiMatch[1];
            const trackingNumber = cekResiMatch[2];

            if (klikResiApiKey) {
                try {
                    console.log(`Mencoba cek resi: Kurir=${courierCode}, Resi=${trackingNumber}`);
                    const response = await axios.get(
                        `${klikResiBaseUrl}/trackings/${trackingNumber}/couriers/${courierCode}`,
                        {
                            headers: {
                                'x-api-key': klikResiApiKey
                            }
                        }
                    );

                    const apiData = response.data.data; // Langsung akses object 'data' dari respons

                    // Ganti kondisi pengecekan agar sesuai dokumentasi
                    if (apiData && apiData.histories) {
                        const histories = apiData.histories || [];
                        const lastStatus = histories.length > 0 ? histories[0] : null; // Ambil status terakhir dari riwayat pertama

                        let historyDetails = "";
                        if (histories.length > 0) {
                            historyDetails = "Riwayat Pengiriman:\n";
                            // Dokumentasi sudah mengurutkan dari terbaru, jadi tidak perlu .sort() lagi
                            histories.slice(0, 5).forEach(item => {
                                // GANTI 'item.description' menjadi 'item.message'
                                historyDetails += `• [${new Date(item.date).toLocaleString('id-ID')}] ${item.message}\n`;
                            });
                            if (histories.length > 5) {
                                historyDetails += `... (dan riwayat lainnya)\n`;
                            }
                        } else {
                            historyDetails = "Riwayat pengiriman tidak tersedia.";
                        }

                        // Buat ulang format balasan karena object 'summary' tidak ada
                        replyText = `📦 Status Resi: **${trackingNumber}**\n` +
                                    `Kurir: **${courierCode.toUpperCase()}**\n` +
                                    // Ambil status dari data utama atau dari riwayat terakhir
                                    `Status Terakhir: **${apiData.status || (lastStatus ? lastStatus.status : 'Tidak diketahui')}**\n` +
                                    `Tanggal Update: **${lastStatus ? new Date(lastStatus.date).toLocaleString('id-ID') : 'Tidak diketahui'}**\n\n` +
                                    `${historyDetails}`;

                    } else {
                        // Jika format respons tidak seperti yang diharapkan
                        replyText = "Maaf, data resi tidak ditemukan atau format respons dari API tidak sesuai.";
                    }
                    aiUsed = "Custom: Cek Resi";
                    console.log(`Cek Resi info for ${trackingNumber}: ${replyText}`);

                } catch (cekResiError) {
                    // Blok catch Anda sudah bagus, bisa dibiarkan seperti adanya
                    console.error(`Error fetching Klik Resi for ${trackingNumber}:`, cekResiError.response ? cekResiError.response.data : cekResiError.message);
                    const apiErrorMessage = cekResiError.response?.data?.message;

                    if (cekResiError.response && cekResiError.response.status === 401) {
                        replyText = "Maaf, API Key Klik Resi tidak valid atau tidak terotorisasi.";
                    } else if (apiErrorMessage) {
                        replyText = `Maaf, terjadi kesalahan: ${apiErrorMessage}`;
                    } else if (cekResiError.response && cekResiError.response.status === 404) {
                        replyText = "Maaf, nomor resi atau kode kurir tidak ditemukan/invalid.";
                    } else {
                        replyText = "Maaf, ada masalah teknis saat mengambil data resi.";
                    }
                    aiUsed = "Custom: Cek Resi (Failed)";
                }
            } else {
                replyText = "Maaf, fitur cek resi belum dikonfigurasi sepenuhnya (API Key Klik Resi tidak ada).";
                aiUsed = "Custom: Cek Resi (No API Key)";
            }
        } else if (userMessage.startsWith("cek resi")) {
            // Jika user hanya mengetik "cek resi" tanpa parameter lengkap
            replyText = "Mohon masukkan format yang benar: `cek resi [kode_kurir] [nomor_resi]` (contoh: `cek resi jne 1234567890`).";
            aiUsed = "Custom: Cek Resi (Invalid Format)";
        }
        // --- Akhir Fitur Kustom: Cek Resi ---


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

        // Balas pesan ke LINE
        if (replyText !== "") {
            await client.replyMessage(eventItem.replyToken, { type: 'text', text: replyText });
            console.log(`Replied with AI: ${aiUsed}`);
        } else {
             await client.replyMessage(eventItem.replyToken, { type: 'text', text: "Maaf, saya tidak mengerti. Coba tanyakan hal lain." });
             console.log("No feature or AI could handle the message.");
        }
      }
    }

    return { statusCode: 200, body: 'OK' };

  } catch (err) {
    console.error("Error handling webhook event:", err);
    return { statusCode: 500, body: `Internal Server Error: ${err.message}` };
  }
};

