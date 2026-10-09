# MapMiner / KlienFlow — Google Maps Scraper

Ambil data bisnis dari Google Maps (Bisnis, Review, Website, Instagram, Telepon, WhatsApp, Link Google Maps) berdasarkan kata kunci & kota, verifikasi WhatsApp, lalu ekspor ke Excel/CSV/JSON/peta HTML — plus kirim penawaran massal via WhatsApp.

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

- Butuh Windows 10/11 64-bit. Saat **pertama kali** dijalankan, Windows bisa meminta izin administrator (UAC) untuk memasang Node.js — klik **Yes**.
- Dialog firewall Windows ("Do you want to allow…") untuk Bun/Node dicegah otomatis: `start.bat` membuat aturan firewall-nya sendiri saat pertama kali dijalankan sebagai Administrator.

### Kalau Windows menolak menjalankan start.bat (Smart App Control)

Windows 11 kadang menampilkan **"Smart App Control blocked a file that may be unsafe"** saat start.bat diklik — ini terjadi karena file hasil unduhan ZIP diberi label "dari internet" dan skrip `.bat` berlabel itu diblokir. Fitur ini tidak punya tombol Allow; pilih salah satu:

1. **Paling cepat:** matikan Smart App Control — *Windows Security → App & browser control → Smart App Control settings → Off* — lalu klik dua kali `start.bat` lagi. (Setelah Off, fitur ini hanya bisa dinyalakan lagi lewat reset Windows.)
2. **Tanpa mematikan:** klik kanan `start.bat` → *Properties* → centang **Unblock** → OK, lalu jalankan lagi. Lakukan hal sama untuk `stop.bat`.
3. **Cara developer:** pasang Git lalu `git clone https://github.com/doaibu0000000/MapMiner.git` — file hasil clone tidak berlabel "dari internet" sehingga tidak diblokir.
4. **Tanpa mematikan & tanpa klik Unblock:** unduh lewat terminal — berkas hasil unduhan `curl`+`tar` tidak diberi label internet, jadi `start.bat` langsung jalan saat diklik. Buka PowerShell, tempel dua baris ini:
   ```
   curl -L -o mm.zip https://github.com/doaibu0000000/MapMiner/archive/refs/heads/main.zip
   tar -xf mm.zip ; cd MapMiner-main ; start start.bat
   ```
- Layanan hanya hidup selama jendela `start.bat` terbuka; menutup jendelanya mematikan semuanya.
- Kalau Windows SmartScreen menampilkan peringatan saat menjalankan `start.bat`, klik **More info → Run anyway**.
- Data hasil scraping tersimpan di `mini-services/gmaps-scraper/data/` dan ikut terhapus permanen saat job dihapus dari aplikasi.
- Gunakan data sesuai ketentuan Google & UU PDP.
