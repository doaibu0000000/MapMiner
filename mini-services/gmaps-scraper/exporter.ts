// Ekspor hasil scraping ke XLSX / CSV
// Format v11.3 (permintaan pengguna):
//  - SATU sheet, 6 kolom: Bisnis | Review | Website | Instagram | Telepon | Link Google Maps
//  - URL Instagram yang tersimpan sbg "website" dipindah → kolom Instagram (username saja)
//  - Ekspor memuat SEMUA tempat yang terkumpul — jumlah baris = angka "tempat" di UI,
//    tidak ada baris yang dibuang diam-diam. Baris tanpa nomor telepon kolomnya "❌".
//  - Link Google Maps berupa hyperlink yang bisa diklik.

import type { ScrapeJob, Place } from "./types";
import { buildXlsx } from "./xlsx";

/** Tanda kolom tanpa data — sesuai contoh tabel pengguna */
const MISSING = "❌";

export const COLUMNS: { key: string; label: string; width: number }[] = [
  { key: "name", label: "Bisnis", width: 32 },
  { key: "reviewsCount", label: "Review", width: 10 },
  { key: "website", label: "Website", width: 34 },
  { key: "igUser", label: "Instagram", width: 24 },
  { key: "phoneDigits", label: "Telepon", width: 16 },
  { key: "wa", label: "WhatsApp", width: 13 },
  { key: "mapsUrl", label: "Link Google Maps", width: 48 },
];

/** Ekstrak username Instagram dari URL apa pun (TANPA @ — sesuai contoh pengguna).
 *  "https://www.instagram.com/vaxwijaya_kalijati/?hl=id" → "vaxwijaya_kalijati" */
const IG_JUNK_HANDLES = new Set(["whatsapp", "instagram", "facebook", "tiktok", "youtube", "google", "p", "reel", "reels", "explore", "stories", "tv", "accounts"]);
export function igHandle(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (!m) return null;
  const user = m[1].replace(/\.$/, "");
  if (IG_JUNK_HANDLES.has(user.toLowerCase())) return null;
  if (user.length < 2 || user.length > 40) return null;
  return user;
}

const isIgUrl = (u: string | undefined | null) => !!u && /instagram\.com\//i.test(u);

/** v11.3: ekspor memuat SEMUA tempat yang terkumpul — jumlah baris = angka "tempat"
 *  di UI, tidak ada yang dibuang diam-diam (dulu hanya baris ber-nomor telepon).
 *  Status WhatsApp tetap tersimpan di datanya untuk disaring sendiri bila perlu. */
export function exportablePlaces(places: Place[]): Place[] {
  return places;
}

function placeValue(place: Place, key: string): string | number | null {
  switch (key) {
    case "reviewsCount": return place.reviewsCount ?? MISSING;
    case "website": return isIgUrl(place.website) ? MISSING : (place.website || MISSING);
    case "igUser": return igHandle(place.instagram) ?? igHandle(place.website) ?? MISSING;
    case "phoneDigits": return place.phoneDigits || MISSING;
    case "wa":
      // status verifikasi WhatsApp terbaru: ✓ aktif / ✕ tidak terdaftar / ? belum pasti
      if (!place.phoneDigits) return MISSING;
      return place.waOk === true ? "✓ WA" : place.waOk === false ? "✕ Tidak" : "? Belum pasti";
    case "mapsUrl": return place.mapsUrl || null;
    default: {
      const v = (place as unknown as Record<string, unknown>)[key];
      return typeof v === "string" && v.length > 0 ? v : null;
    }
  }
}

function safeName(s: string): string {
  return s
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 40) || "hasil";
}

export function exportFilename(job: ScrapeJob, ext: string, subset = false): string {
  return `${safeName(job.keyword)}_${safeName(job.city)}_${new Date(job.createdAt).toISOString().slice(0, 10)}${subset ? "_terpilih" : ""}.${ext}`;
}

/** Baris data (header + tempat lolos filter, terurut nama) — dipakai XLSX & CSV */
function dataRows(job: ScrapeJob): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [COLUMNS.map((c) => c.label)];
  // salin sebelum sort — jangan mengubah urutan job.places yang tersimpan
  const sorted = [...exportablePlaces(job.places)].sort((a, b) => a.name.localeCompare(b.name, "id"));
  sorted.forEach((place) => {
    rows.push(COLUMNS.map((c) => placeValue(place, c.key)));
  });
  return rows;
}

export function buildJobXlsx(job: ScrapeJob): Buffer {
  return buildXlsx([{
    name: "Data",
    rows: dataRows(job),
    colWidths: COLUMNS.map((c) => c.width),
    headerRow: true,
    zebra: true,
  }]);
}

export function buildJobCsv(job: ScrapeJob): string {
  const lines: string[] = [];
  lines.push(COLUMNS.map((c) => c.label).join(","));
  for (const row of dataRows(job).slice(1)) {
    const vals = row.map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(vals.join(","));
  }
  return "\uFEFF" + lines.join("\r\n");
}

