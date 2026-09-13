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
Frontend memanggil public Hugging Face Space `kulkas2pintu/QWEN_EDIT_IMAGE` untuk mode 3 pose. Space ini memakai Qwen Image Edit dan mendukung preserve identity, output HD, serta perbaikan tangan. Karena public ZeroGPU, dapat memiliki antrean dan kuota.

## Video gratis
Frontend memanggil public Hugging Face Space `prithivMLmods/Wan2.2-Fast`. Ini cocok untuk MVP/testing. Space public dapat memiliki antrean, perubahan layanan, dan kuota ZeroGPU.

## Jalankan
```bash
npm install
npm run dev
```
Buka http://localhost:3000

## Environment
Salin `.env.example` menjadi `.env.local` dan isi OpenAI key jika ingin fitur analisis aktif.

## Catatan produksi
Untuk website publik dengan banyak pengguna, sebaiknya jangan bergantung pada Space demo pihak ketiga. Nanti bisa dipindahkan ke Space/GPU milik sendiri atau worker GPU.
