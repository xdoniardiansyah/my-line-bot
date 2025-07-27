import os
import json # Perlu import json untuk parse body event

from linebot import LineBotApi, WebhookHandler
from linebot.exceptions import InvalidSignatureError
from linebot.models import MessageEvent, TextMessage, TextSendMessage

from azure.ai.inference import ChatCompletionsClient
from azure.ai.inference.models import SystemMessage, UserMessage
from azure.core.credentials import AzureKeyCredential

# Ambil dari environment variables
LINE_CHANNEL_ACCESS_TOKEN = os.environ.get('LINE_CHANNEL_ACCESS_TOKEN')
LINE_CHANNEL_SECRET = os.environ.get('LINE_CHANNEL_SECRET')
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN')

# Inisialisasi LINE Bot API dan Webhook Handler
line_bot_api = LineBotApi(LINE_CHANNEL_ACCESS_TOKEN)
# Ubah nama variabel 'handler' menjadi 'line_webhook_handler_sdk' atau serupa
# agar tidak bentrok dengan nama fungsi utama 'handler'
line_webhook_handler_sdk = WebhookHandler(LINE_CHANNEL_SECRET)

github_ai_client = None
if GITHUB_TOKEN:
    try:
        github_endpoint = "https://models.github.ai/inference"
        github_model = "openai/gpt-4.1"

        github_ai_client = ChatCompletionsClient(
            endpoint=github_endpoint,
            credential=AzureKeyCredential(GITHUB_TOKEN),
        )
        print("GitHub AI client initialized.")
    except Exception as e:
        print(f"Error initializing GitHub AI client: {e}")
        github_ai_client = None
else:
    print("GITHUB_TOKEN not found. GitHub AI will not be used.")


# --- INI ADALAH FUNGSI UTAMA NETLIFY (AWS Lambda) ---
# Nama fungsi harus 'handler' secara default jika di 'main.py' atau 'index.py'
# Atau sesuai dengan konfigurasi handler di netlify.toml (tapi lebih mudah pakai default)
def handler(event, context):
    """
    Fungsi utama yang akan dipanggil oleh Netlify Function.
    `event` berisi payload HTTP request (dari webhook LINE).
    `context` berisi metadata tentang invocations, environment, dll.
    """
    # Webhook LINE biasanya menggunakan metode POST
    if event['httpMethod'] != 'POST':
        return {
            'statusCode': 405,
            'body': 'Method Not Allowed'
        }

    # Ambil signature LINE dari header 'event'
    signature = event['headers'].get('x-line-signature')
    
    # Ambil body request dari 'event'
    # Body dari Netlify Function (Lambda) sudah berupa string
    body = event['body'] 
    
    try:
        # Gunakan handler_line_sdk di sini
        line_webhook_handler_sdk.handle(body, signature)
    except InvalidSignatureError:
        print("Invalid signature. Check your channel access token/channel secret.")
        # Mengembalikan dictionary untuk error HTTP 400
        return {
            'statusCode': 400,
            'body': 'Invalid signature. Check your channel access token/channel secret.'
        }
    except Exception as e:
        print(f"Error handling event: {e}")
        # Mengembalikan dictionary untuk error HTTP 500
        return {
            'statusCode': 500,
            'body': f"Internal Server Error: {e}"
        }

    # Mengembalikan dictionary untuk respons HTTP 200 OK
    return {
        'statusCode': 200,
        'body': 'OK'
    }

# --- Handler untuk event LINE SDK (tidak ada perubahan besar di sini) ---
@line_webhook_handler_sdk.add(MessageEvent, message=TextMessage)
def handle_message(event):
    """
    Fungsi untuk menangani event pesan teks dan membalas dengan GitHub AI.
    """
    user_message = event.message.text
    reply_text = ""

    if github_ai_client:
        try:
            print(f"User message: {user_message}")
            response = github_ai_client.complete(
                messages=[
                    SystemMessage(content="selalu balas dengan bahasa indonesia dan singkat dan padat dan tidak menggunakan kata-kata yang tidak perlu"),
                    UserMessage(content=user_message),
                ],
                temperature=1,
                top_p=1,
                model=github_model
            )
            reply_text = response.choices[0].message.content
            print(f"GitHub AI response: {reply_text}")
        except Exception as e:
            print(f"Error calling GitHub AI: {e}")
            reply_text = "Maaf, saya tidak bisa memproses permintaan Anda saat ini karena masalah dengan AI. Silakan coba lagi nanti."
    else:
        reply_text = "Bot ini belum terhubung dengan AI (GitHub). Silakan hubungi admin."

    line_bot_api.reply_message(
        event.reply_token,
        TextSendMessage(text=reply_text)
    )

