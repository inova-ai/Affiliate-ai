# Affiliate AI Studio — Final Starter

## Yang sudah jadi
- Upload 1 foto produk
- AI Vision membaca produk
- AI membuat hook, script, caption, hashtag
- AI Text-to-Speech membuat voice-over
- UI siap dipasang di Vercel
- Worker FFmpeg untuk membuat MP4 9:16

## Deploy web ke Vercel
1. Upload folder ini ke GitHub.
2. Import repository ke Vercel.
3. Set environment variables dari `.env.example`.
4. Isi `OPENAI_API_KEY` di Vercel (jangan di frontend).
5. Deploy.

## Video MP4
Vercel cocok untuk web/API ringan, sedangkan render FFmpeg sebaiknya dijalankan sebagai worker.
Folder `worker/` adalah worker yang bisa dijalankan di server/container yang mendukung Docker.

Set:
- `VIDEO_WORKER_URL=https://alamat-worker-kamu`
- `VIDEO_WORKER_TOKEN=token-rahasia`

## Catatan storage
Worker starter mengembalikan MP4 sebagai data URL agar mudah dites. Untuk produksi, jangan menyimpan MP4 besar sebagai data URL. Ganti bagian upload di `worker/server.js` dengan S3/R2/Supabase Storage lalu kembalikan signed/public URL.

## Alur produksi
Upload → Vision → Script → TTS → Worker FFmpeg → Storage → URL MP4.

## Keamanan
Jangan pernah menaruh OPENAI_API_KEY di browser, HTML, atau repository publik.
