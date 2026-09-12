# Affiliate AI Studio — MP4 Ready

## Yang sudah aktif
1. Upload foto produk
2. OpenAI Vision membuat hook/script/caption/hashtag
3. OpenAI TTS membuat voice-over
4. `/api/render` mengirim asset ke worker
5. Worker FFmpeg membuat MP4 1080x1920, 30fps, 15 detik
6. Website menampilkan video dan tombol Download MP4

## Deploy
### Vercel
Deploy folder utama ke Vercel dan isi:
OPENAI_API_KEY
OPENAI_TEXT_MODEL=gpt-5.6-luna
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
VIDEO_WORKER_URL=https://URL-WORKER
VIDEO_WORKER_TOKEN=token-rahasia

### Worker
Folder `worker/` adalah Docker service. Deploy ke Railway/Render/Fly.io/VPS yang mendukung Docker.
Set:
VIDEO_WORKER_TOKEN=token-rahasia
PORT=8080

Setelah worker online, tes:
GET /health

Lalu masukkan URL worker ke Vercel:
VIDEO_WORKER_URL=https://alamat-worker-kamu

## Catatan
Untuk starter ini worker mengembalikan MP4 sebagai data URL. Untuk skala besar, sebaiknya MP4 disimpan di object storage (R2/S3/Supabase Storage) dan website menerima URL file.
