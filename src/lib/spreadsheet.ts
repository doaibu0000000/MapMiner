// ---------- util spreadsheet ----------
// Data + logika untuk fitur "Lihat & Edit" file Excel di Penawaran Massal:
// parse .xlsx/.xls/.csv menjadi grid (baris × kolom) yang bisa diedit,
// lalu derivasi daftar penerima dari grid tersebut setiap kali berubah.

export interface Recipient {
  jobId: string;
  cid: string;
  name: string;
  phoneDigits: string;
  kota: string;
  kategori: string;
  alamat: string;
  website: string;
  /** Nilai sel baris ini per judul kolom file — sumber placeholder dinamis
   *  {<nama kolom>} di template pesan. Kosong bila nomor diketik manual. */
  fields: Record<string, string>;
}

/** Grid spreadsheet yang dimuat dari file — dipakai editor ala Google Sheets.
 *  Semua sel disimpan sebagai string sehingga aman diedit langsung. */
export interface SheetSource {
  fileName: string;
  headers: string[];   // judul kolom (baris 1), bisa diedit
  rows: string[][];    // baris data mulai baris 2
  phoneIdx: number;    // indeks kolom sumber nomor telepon
  nameIdx: number;     // -1 = tidak ada kolom nama
  webIdx: number;
  alamatIdx: number;
  kategori: string;    // dari nama file, utk placeholder {kategori}
  kota: string;        // dari nama file, utk placeholder {kota}
}

/** Normalisasi nomor ke format internasional 62… (sama dengan aturan wa-checker):
 *  0813… → 62813…, 813… → 62813… — agar tampilan, dedup & riwayat konsisten.
 *  Nomor luar negeri (cth. +60… Malaysia) tidak berawalan 0/8/62 → dibiarkan apa adanya. */
export function toDigits62(raw: string): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("8")) return "62" + d;
  return d;
}

const looksLikePhone = (v: unknown): boolean => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 15;
};

/** Indeks kolom nomor telepon berdasar judul header. Kolom WhatsApp (berisi
 *  tanda ✓/✗, bukan nomor) sengaja tidak dipilih; kolom terpilih harus benar-
 *  benar berisi nomor, kalau tidak lanjut ke kandidat berikutnya. */
function detectPhoneIndex(headers: string[], rows: string[][]): number {
  for (const re of [/telepon/i, /telp/i, /phone/i, /no\.?\s*hp|\bhp\b/i, /nomor|no\.?\s*telp/i]) {
    const idx = headers.findIndex((h) => re.test(h) && !/whatsapp|(^|\s)wa\b/i.test(h));
    if (idx >= 0 && rows.some((r) => looksLikePhone(r[idx]))) return idx;
  }
  // fallback: kolom dengan baris terbanyak berisi angka menyerupai nomor
  let best = -1;
  let bestCount = 0;
  headers.forEach((_, c) => {
    const count = rows.reduce((n, r) => n + (looksLikePhone(r[c]) ? 1 : 0), 0);
    if (count > bestCount) { best = c; bestCount = count; }
  });
  return bestCount > 0 ? best : -1;
}

/** Kategori & kota dari nama file hasil scraping, cth. "sepatu_Subang_2026-10-05.xlsx"
 *  → kategori "Sepatu", kota "Subang". */
export function metaFromFileName(fileName: string): { kategori: string; kota: string } {
  const base = fileName.replace(/\.(xlsx|xls|csv)$/i, "").trim();
  const parts = base.split(/[_\s]+/).map((p) => p.trim()).filter(Boolean);
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  const generic = /^(job|master|hasil|data|export|laporan)$/i;
  const dateIdx = parts.findIndex((p) => /^\d{4}[-.]\d{2}[-.]\d{2}$/.test(p));
  if (dateIdx >= 1) {
    const kota = parts[dateIdx - 1];
    const kategori = dateIdx >= 2 && !generic.test(parts[dateIdx - 2]) ? parts[dateIdx - 2] : "";
    return { kategori: cap(kategori), kota: cap(kota) };
  }
  const named = parts.filter((p) => !generic.test(p) && !/^v\d+$/i.test(p));
  if (named.length >= 2) return { kategori: cap(named[0]), kota: cap(named[named.length - 1]) };
  if (named.length === 1) return { kategori: "", kota: cap(named[0]) };
  return { kategori: "", kota: "" };
}

/** Baca file spreadsheet → SheetSource. Libur memakai SheetJS (xlsx) yang
 *  dimuat dinamis agar tidak membebani bundle awal. */
export async function parseFileToSheet(file: File): Promise<SheetSource> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("File tidak berisi sheet data");
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  if (grid.length === 0) throw new Error("File tidak berisi baris data");

  // buang kolom tanpa judul di ujung kanan (sisa format) & baris kosong total
  const rawHeaders = grid[0].map((v) => String(v ?? "").trim());
  let width = rawHeaders.length;
  while (width > 1 && !rawHeaders[width - 1]) width--;
  const headers = rawHeaders.slice(0, width);
  const rows = grid
    .slice(1)
    .map((r) => headers.map((_, c) => String(r[c] ?? "")))
    .filter((r) => r.some((v) => v.trim() !== ""));
  if (rows.length === 0) throw new Error("File tidak berisi baris data");

  const phoneIdx = detectPhoneIndex(headers, rows);
  if (phoneIdx < 0) throw new Error('Kolom nomor telepon tidak ditemukan — pastikan ada kolom "Telepon"/"Phone"');
  const findIdx = (re: RegExp) => {
    const i = headers.findIndex((h, c) => c !== phoneIdx && re.test(h));
    return i;
  };
  const { kategori, kota } = metaFromFileName(file.name);
  return {
    fileName: file.name,
    headers,
    rows,
    phoneIdx,
    nameIdx: findIdx(/(bisnis|nama|name|usaha|tempat|outlet|toko)/i),
    webIdx: headers.findIndex((h) => /website|situs/i.test(h)),
    alamatIdx: headers.findIndex((h) => /alamat|address/i.test(h)),
    kategori,
    kota,
  };
}

/** Derivasi daftar penerima dari grid saat ini — dipanggil ulang setiap kali
 *  grid diedit agar jumlah "siap kirim" selalu mengikuti. */
export function buildRecipientsFromSheet(sheet: SheetSource): {
  recipients: Recipient[];
  empty: number;
  invalid: number;
  dup: number;
} {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let empty = 0, invalid = 0, dup = 0;
  for (const row of sheet.rows) {
    const digits = toDigits62(row[sheet.phoneIdx] ?? "");
    if (!digits) { empty++; continue; }
    if (digits.length < 8 || digits.length > 15) { invalid++; continue; }
    if (seen.has(digits)) { dup++; continue; }
    seen.add(digits);
    // judul kolom duplikat: nilai kemunculan pertama yang menang, konsisten
    // dgn daftar chip placeholder yang juga dedup
    const fields: Record<string, string> = {};
    sheet.headers.forEach((h, c) => {
      const key = h.trim();
      if (key && !(key in fields)) fields[key] = (row[c] ?? "").trim();
    });
    recipients.push({
      jobId: "", cid: "",
      name: sheet.nameIdx >= 0 ? (row[sheet.nameIdx] ?? "").trim() : "",
      phoneDigits: digits,
      kota: sheet.kota,
      kategori: sheet.kategori,
      alamat: sheet.alamatIdx >= 0 ? (row[sheet.alamatIdx] ?? "").trim() : "",
      website: sheet.webIdx >= 0 ? (row[sheet.webIdx] ?? "").trim() : "",
      fields,
    });
  }
  return { recipients, empty, invalid, dup };
}

/** Chip placeholder dinamis dari judul kolom file: {Bisnis}, {Review}, …
 *  Apa pun jumlah & nama kolomnya ikut tampil; kolom kosong/duplikat dilewati. */
export function tokensFromHeaders(headers: string[]): { token: string; label: string }[] {
  const seen = new Set<string>();
  const out: { token: string; label: string }[] = [];
  for (const h of headers) {
    const name = h.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ token: `{${name}}`, label: name });
  }
  return out;
}

/** Huruf kolom ala spreadsheet: 0→A, 1→B, … 25→Z, 26→AA. */
export function colLetter(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
