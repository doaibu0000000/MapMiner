// Cache persisten hasil scraping Google Maps — supaya pekerjaan berulang
// (kota & kata kunci yang sama, pola pemakaian khas) tidak mengulang scroll
// dan halaman detail yang mahal.
//   search : query+viewport → daftar Place        TTL 24 jam (daftar usaha berubah harian)
//   detail : placeId → Partial<Place>             TTL 7 hari (telepon/website/jam buka jarang berubah)
// Hanya hasil yang SEHAT yang disimpan (varian tidak diblokir & menemukan tempat).
import { mkdirSync } from "node:fs";
import path from "node:path";

const FILE = path.join(import.meta.dir, "cache", "maps-cache.json");
type Entry<T> = { d: T; t: number };
type Store = { search: Record<string, Entry<any[]>>; detail: Record<string, Entry<any>> };
let mem: Store | null = null;

const SEARCH_TTL = 72 * 3600_000; // 3 hari — daftar usaha jarang berubah drastis; run ulang tetap instan
const DETAIL_TTL = 7 * 86400_000;

async function load(): Promise<Store> {
  if (mem) return mem;
  try {
    const raw = await Bun.file(FILE).json();
    mem = { search: raw?.search ?? {}, detail: raw?.detail ?? {} };
  } catch {
    mem = { search: {}, detail: {} };
  }
  return mem;
}

async function save(): Promise<void> {
  if (!mem) return;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    await Bun.write(FILE, JSON.stringify(mem));
  } catch {}
}

/** Kunci cache pencarian: query + viewport (kuadran). */
export function mapsSearchKey(query: string, viewport?: { lat: number; lng: number; zoom: number }): string {
  if (!viewport) return `s|${query}`;
  return `s|${query}|${viewport.lat.toFixed(5)},${viewport.lng.toFixed(5)},${viewport.zoom}`;
}

/** Ambil hasil pencarian dari cache; null bila tidak ada / kadaluarsa.
 *  Setiap place DIKLONING dan waOk DIBUANG — cache tidak boleh membawa status
 *  WhatsApp basi dari job sebelumnya (penyebab "0 nomor diperiksa → semua
 *  terbuang" pada fasa Wajib WhatsApp). */
export async function mapsSearchGet(key: string): Promise<any[] | null> {
  const m = await load();
  const e = m.search[key];
  if (!e) return null;
  if (Date.now() - e.t > SEARCH_TTL) { delete m.search[key]; return null; }
  return e.d.map((p: any) => { const c = { ...p }; delete c.waOk; return c; });
}

export async function mapsSearchPut(key: string, places: any[]): Promise<void> {
  if (!places || places.length === 0) return; // jangan cache kegagalan
  const m = await load();
  m.search[key] = { d: places, t: Date.now() };
  // jaga ukuran: buang entri tertua bila lebih dari 400 varian
  const keys = Object.keys(m.search);
  if (keys.length > 400) {
    keys.sort((a, b) => m!.search[a].t - m!.search[b].t);
    for (const k of keys.slice(0, keys.length - 400)) delete m!.search[k];
  }
  await save();
}

/** Ambil detail tempat dari cache; null bila tidak ada / kadaluarsa. */
export async function mapsDetailGet(placeId: string): Promise<any | null> {
  const m = await load();
  const e = m.detail[placeId];
  if (!e) return null;
  if (Date.now() - e.t > DETAIL_TTL) { delete m.detail[placeId]; return null; }
  return e.d;
}

export async function mapsDetailPut(placeId: string, data: any): Promise<void> {
  if (!placeId || !data) return;
  const m = await load();
  m.detail[placeId] = { d: data, t: Date.now() };
  const keys = Object.keys(m.detail);
  if (keys.length > 5000) {
    keys.sort((a, b) => m!.detail[a].t - m!.detail[b].t);
    for (const k of keys.slice(0, keys.length - 5000)) delete m!.detail[k];
  }
  await save();
}
