# MapMiner / KlienFlow — Google Maps Scraper

Ambil data bisnis dari Google Maps (nama, kategori, alamat lengkap, telepon, website, email, sosmed IG/FB/TikTok, rating & jumlah ulasan, jam buka, koordinat, status operasional, link Google Maps) berdasarkan kata kunci & kota, verifikasi WhatsApp, lalu ekspor ke Excel/CSV/JSON/peta HTML — plus kirim penawaran massal via WhatsApp.

## Cara Menjalankan (komputer baru sekalipun)

1. Clone repo ini (atau unduh ZIP lalu ekstrak).
2. **Klik dua kali `start.bat`** — selesai.

Tidak perlu install apa pun secara manual. Saat pertama kali dijalankan, `start.bat` memasang semuanya secara otomatis (butuh koneksi internet, ±5–10 menit):

| Yang dipasang otomatis | Keterangan |
|---|---|
| Bun | Runtime utama semua layanan (via `bun.sh/install.ps1`) |
| Node.js LTS | Dibutuhkan Next.js — dipasang via `winget` |
| Dependensi aplikasi | `bun install` di root (folder `node_modules`) |
| Dependensi mini-service | `bun install` di `mini-services/gmaps-scraper` & `mini-services/wa-checker` |
| Chromium | Browser untuk scraper — **dilewati** bila Chrome/Edge sudah terpasang |
| File `.env` | Dibuat otomatis bila belum ada |

Jalankan kedua kali dan seterusnya: semua sudah terpasang, layanan langsung menyala.

## Layanan yang Berjalan

| Port | Layanan |
|---|---|
| 3000 | Aplikasi web (buka di browser: <http://localhost:3000>) |
| 3003 | Scraper engine (Google Maps) |
| 3004 | Verifikasi WhatsApp (protokol resmi / Baileys) |

## Mematikan Layanan

- Tutup jendela `start.bat` (klik X) — semua layanan ikut mati, **atau**
- Jalankan `stop.bat`.

## Catatan

- Layanan hanya hidup selama jendela `start.bat` terbuka; menutup jendelanya mematikan semuanya.
- Kalau Windows SmartScreen menampilkan peringatan saat menjalankan `start.bat`, klik **More info → Run anyway**.
- Data hasil scraping tersimpan di `mini-services/gmaps-scraper/data/` dan ikut terhapus permanen saat job dihapus dari aplikasi.
- Gunakan data sesuai ketentuan Google & UU PDP.
