# Panduan Pengujian (Testing Guide)

Dokumen ini menjelaskan cara menjalankan pengujian otomatis untuk Chrome Extension **Boker**.

## Prasyarat
1. Pastikan [Node.js](https://nodejs.org/) sudah terinstal di sistem Anda.
2. Instal browser Chromium untuk Playwright:
   ```bash
   npx playwright install chromium
   ```

## Menjalankan Tes
1. Pastikan Anda sudah melakukan *build* terbaru:
   ```bash
   npm run build
   ```
2. Jalankan pengujian otomatis:
   ```bash
   npm run test
   ```

## Menjaga ID Extension Tetap Konsisten (Penting untuk Tes)
Agar ID extension tidak berubah-ubah (penting agar `tests/blocking.spec.ts` tidak perlu diperbarui terus-menerus), tambahkan field `"key"` di dalam `public/manifest.json`.

1. **Generate Kunci RSA** (atau gunakan kunci yang sudah ada):
   ```bash
   openssl genrsa 2048 | openssl pkcs8 -topk8 -inform PEM -outform DER -out key.pem -nocrypt
   openssl rsa -in key.pem -pubout -outform DER | base64 > public.key.base64
   ```
2. **Ambil isi** dari `public.key.base64`.
3. **Tambahkan ke `public/manifest.json`**:
   ```json
   {
     "manifest_version": 3,
     ...
     "key": "ISI_BASE64_PUBLIC_KEY_DISINI"
   }
   ```
4. **Update ID di Tes**:
   - Setelah menambahkan `key`, *load* ulang extension di Chrome (`chrome://extensions/`).
   - Salin ID extension yang muncul.
   - Perbarui variabel `EXTENSION_ID` di file `tests/blocking.spec.ts`.

## Penjelasan Tes (`tests/blocking.spec.ts`)
Tes ini melakukan langkah-langkah berikut secara otomatis:
1. Membuka browser dengan extension Boker dimuat.
2. Menavigasi ke popup dan menambahkan `https://example.com` ke daftar blokir.
3. Memastikan domain tersebut muncul di UI daftar blokir.
4. Membuka tab baru untuk mencoba mengakses `https://example.com` dan memverifikasi bahwa navigasi tersebut diblokir atau gagal (sesuai perilaku DNR).
