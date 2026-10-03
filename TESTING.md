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

> Tes memakai Playwright dengan `channel: 'chromium'` (mode **new headless**) agar extension
> Manifest V3 bisa dimuat tanpa layar. Jangan memakai mode headless lama — mode itu tidak
> mendukung extension.

## Menjaga ID Extension Tetap Konsisten (Opsional untuk Tes)
Tes mengambil ID extension secara otomatis dari URL service worker, jadi tidak wajib
di-pin. Bila ingin ID yang tetap (mis. untuk allow-list di server), tambahkan field `"key"`
di `public/manifest.json`.

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

## Penjelasan Tes (`tests/blocking.spec.ts`)
Tes ini melakukan langkah-langkah berikut secara otomatis:
1. Membuka browser (persistent context) dengan extension Boker dimuat dari folder `dist/`.
2. Menunggu **service worker** MV3 muncul, lalu mengambil extension ID dari URL-nya.
3. Membuka popup dan menambahkan `https://example.com` ke daftar blokir.
4. Memastikan domain tersebut muncul di UI daftar blokir.
5. Memastikan **dynamic rule** `declarativeNetRequest` benar-benar terbentuk:
   ```js
   chrome.declarativeNetRequest.getDynamicRules()
   ```
6. Membuka tab baru untuk mencoba mengakses `https://example.com` dan memverifikasi
   navigasi diblokir (`net::ERR_BLOCKED_BY_CLIENT`).

## Catatan Manifest V3
- Background berjalan sebagai **service worker**, bukan *background page*. Gunakan
  `context.serviceWorkers()` (Playwright) — `context.backgroundPages()` selalu kosong di MV3.
- Dynamic rule DNR **persisten** lintas sesi/upgrade, jadi tidak perlu di-rebuild saat startup.

## Debugging Manual
1. Buka `chrome://extensions/`, aktifkan *Developer mode*, lalu reload extension.
2. Klik *service worker* pada kartu extension untuk membuka DevTools-nya.
3. Cek rule yang aktif:
   ```js
   chrome.declarativeNetRequest.getDynamicRules().then(console.log)
   ```
4. Tambah URL lewat popup, lalu pastikan rule bertambah dan halaman yang diblokir
   menampilkan `ERR_BLOCKED_BY_CLIENT`.
