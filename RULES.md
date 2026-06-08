## intro
- must work on chrome browser
- use standard web extension when possible and chrome browser supports it
- maybe in the future: work on firefox browser.
- no plan for safari browser

## workflow
- user mengisikan URL yang ingin di block
- simpan URL ke tabel `link`
- parse URL untuk mendapatkan domain, termasuk subdomain, secara recursive jika memungkinkan.
- simpan domain/subdomain ke tabel `host`
- blok subdomain/domain jika URL terdaftar pada tabel `host`

## database
gunakan SQLite.

semua proses penyimpanan dilakukan menggunakan metode upsert,
create jika tidak ada, update jika ada.

semua tabel punya kolom created_at,updated_at.

tabel link digunakan untuk simpan URL yang dimasukan user secara apa adanya.
tabel host digunakan untuk simpan domain/subdomain dari hasil parse URL yang dimasukan user.


# other
tersedia fitur export/import file SQLite database.
