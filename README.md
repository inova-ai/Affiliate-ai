# Affiliate AI Studio — Complete MVP

Versi gabungan dari alur awal sampai versi Wan 2.2 sekarang.

## Fitur
- Upload foto produk/model
- Nama produk + link affiliate
- AI analisis membuat hook, script, caption, hashtag
- AI image-to-video Wan 2.2 Fast
- Pilihan gerakan: Natural, Review, Energetic, Elegant
- Pilihan durasi: 3,5 / 4 / 5 detik
- Preview dan download MP4
- Edit Foto AI: 1 orang menjadi 3 pose dalam satu gambar
- Desain dark luxury / modern

## Edit foto gratis
Frontend sekarang memanggil route server `/api/edit-photo`. Route server terhubung ke public Hugging Face Space `kulkas2pintu/QWEN_EDIT_IMAGE` memakai `HF_TOKEN` server-side, sehingga token tidak pernah dikirim ke browser. Pemakaian ZeroGPU dihitung ke akun Hugging Face yang memiliki token tersebut. Space memakai Qwen Image Edit dan mendukung preserve identity, output HD, serta perbaikan tangan.

## Video gratis
Frontend memanggil public Hugging Face Space `prithivMLmods/Wan2.2-Fast`. Ini cocok untuk MVP/testing. Space public dapat memiliki antrean, perubahan layanan, dan kuota ZeroGPU.

## Jalankan
```bash
npm install
npm run dev
```
Buka http://localhost:3000

## Environment
Salin `.env.example` menjadi `.env.local`. Isi `OPENAI_API_KEY` untuk analisis affiliate dan isi `HF_TOKEN` dengan Hugging Face User Access Token untuk fitur Edit Foto. Jangan taruh token HF di kode frontend atau commit ke Git.

## Catatan produksi
Untuk website publik dengan banyak pengguna, sebaiknya jangan bergantung pada Space demo pihak ketiga. Nanti bisa dipindahkan ke Space/GPU milik sendiri atau worker GPU.

### Cara memasang HF_TOKEN
1. Buat User Access Token di Hugging Face Settings → Access Tokens.
2. Gunakan token dengan izin yang diperlukan untuk mengakses Space/API.
3. Untuk lokal, isi `HF_TOKEN` di `.env.local`.
4. Untuk Vercel, buka Project Settings → Environment Variables → tambah `HF_TOKEN`, lalu redeploy.

Token dipakai hanya di server route `/api/edit-photo`; browser tidak pernah menerima nilai token. Hugging Face mendokumentasikan bahwa token yang diautentikasi membuat penggunaan ZeroGPU dihitung ke kuota akun pemilik token.
