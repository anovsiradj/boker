## Ruang Lingkup
- must work on chrome browser
- future plan for work on firefox browser
- no plan for work on safari browser
- use standard web extension when chrome browser supports it

## dev
- pakai SQLite sebagai tempat penyimpanan data
- pakai Origin Private File System (OPFS) untuk menaruh file SQLite dalam extension

## workflow
- user mengisikan URL yang ingin di block
- simpan URL ke tabel `link`
- parse URL untuk mendapatkan domain.
- simpan domain ke tabel `host`
- blok akses web jika domain dari URL di tab terdaftar pada tabel `host`

## db
semua query harus dilakukan menggunakan metode upsert, create jika tidak ada, update jika ada.

semua tabel harus punya kolom created_at,updated_at.

tabel `link` digunakan untuk simpan URL/link yang dimasukan user secara apa adanya.
tabel `host` digunakan untuk simpan domain/host dari hasil parse URL yang dimasukan user.

selalu bikin backup file db ketika import file db dari user.

# app
user bisa imput URL yang sama berkali-kali.
tersedia fitur export/import file db.
