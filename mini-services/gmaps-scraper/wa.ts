// Verifikasi nomor via REQUEST ke https://wa.me/<nomor> — tanpa sesi/pairing.
//
// Keterbatasan (teruji): halaman wa.me identik untuk nomor terdaftar maupun tidak
// (hanya nonce keamanan yang berbeda) — status registrasi memang tidak dibocorkan
// lewat request. Yang bisa disaring via request: nomor yang DITOLAK wa.me
// (format tidak valid → 404/gagal) vs nomor yang diterima (302 ke api.whatsapp.com).
// waOk: true = diterima wa.me, false = ditolak, null = belum dicek.

export type WaStatus = "ready";

/** 0812… → 62812… ; 812… → 62812… ; sudah 62 → tetap */
export function toWaDigits(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("8")) return "62" + d;
  return d;
}

// ---------------------------------------------------------------------------
// LAPIS CEPAT — cek berbasis REQUEST MURNI (tanpa browser).
// HTML awal api.whatsapp.com/send sudah memuat keadaan kontak dari sisi server
// (terbukti probe): nomor AKTIF → og:title = nama profil + og:image = pps.whatsapp.net;
// nomor MATI/privasi → og:title generik "Bagikan di WhatsApp" tanpa pps.
// ±0,5 dtk per nomor dengan konkurensi tinggi — ratusan nomor per menit,
// tanpa satu pun halaman browser. Browser hanya dipakai sebagai penyelamat
// untuk sebagian kecil yang ambigu (lihat waDeepCheckNumbers).
// ---------------------------------------------------------------------------

const WA_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// CACHE PERSISTEN — nomor yang sudah pernah dicek tidak dicek ulang selama
// masa berlaku verdict: aktif 7 hari, tidak-terdaftar 3 hari, ambigu 6 jam.
// Pekerjaan yang sama dijalankan ulang (pola pemakaian khas: kota & kata kunci
// yang sama) menjadi praktis instan — jawaban dibaca dari memori, tanpa request.
// ---------------------------------------------------------------------------
import { mkdirSync } from "node:fs";
import path from "node:path";

const CACHE_FILE = path.join(import.meta.dir, "cache", "wa-cache.json");
// v: 1 = aktif, 0 = tidak terdaftar, -1 = ambigu
type CacheEntry = { v: number; t: number };
let cacheMem: Record<string, CacheEntry> | null = null;

async function cacheLoad(): Promise<Record<string, CacheEntry>> {
  if (cacheMem) return cacheMem;
  try { cacheMem = await Bun.file(CACHE_FILE).json(); } catch { cacheMem = {}; }
  return cacheMem;
}

async function cacheSave(): Promise<void> {
  if (!cacheMem) return;
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    await Bun.write(CACHE_FILE, JSON.stringify(cacheMem));
  } catch {}
}

function cacheGet(e: CacheEntry | undefined): boolean | null | undefined {
  if (!e) return undefined;
  const ttl = e.v === 1 ? 7 * 86400_000 : e.v === 0 ? 3 * 86400_000 : 6 * 3600_000;
  if (Date.now() - e.t > ttl) return undefined; // kadaluarsa → periksa ulang
  return e.v === 1 ? true : e.v === 0 ? false : null;
}

function cachePut(mem: Record<string, CacheEntry>, digits: string, v: boolean | null): void {
  mem[digits] = { v: v === true ? 1 : v === false ? 0 : -1, t: Date.now() };
}

/** Simpan verdict dari jalur protokol resmi agar cache ikut segar. */
export async function waCacheStoreVerdicts(pairs: Iterable<[string, boolean | null]>): Promise<void> {
  const mem = await cacheLoad();
  for (const [raw, v] of pairs) {
    const d = toWaDigits(raw);
    if (d) cachePut(mem, d, v);
  }
  await cacheSave();
}

function waSendUrl(digits: string): URL {
  const url = new URL("https://api.whatsapp.com/send/");
  url.searchParams.set("phone", digits);
  url.searchParams.set("text", "");
  url.searchParams.set("type", "phone_number");
  url.searchParams.set("app_absent", "0");
  return url;
}

/** Klasifikasi HTML mentah halaman send → verdict + nama profil bila ada. */
export function classifyWaHtml(html: string): { verdict: boolean | null; profileName: string | null } {
  // og:title = nama profil untuk nomor aktif; generik utk mati/privasi
  const og = (html.match(/property="og:title" content="([^"]*)"/)?.[1] ?? "").trim();
  const hasPps = /pps\.whatsapp\.net|pps\.wrwhatsapp/.test(html);
  const genericOg = og === "" || /bagikan di whatsapp|share on whatsapp/i.test(og)
    || /^(ngobrol di whatsapp dengan|chat on whatsapp with)/i.test(og)
    || /^[\d\-\+ ()]+$/.test(og);
  const profileName = !genericOg && og.length >= 2 && og.length <= 60 && /[a-z]/i.test(og) ? og : null;
  if (hasPps || profileName) return { verdict: true, profileName };
  const notOnWa = /not on whatsapp|tidak ada di whatsapp|nomor tidak valid|phone number (shared via url )?is invalid/i.test(html.slice(0, 8000));
  if (notOnWa) return { verdict: false, profileName: null };
  return { verdict: null, profileName: null }; // generik = mati ATAU terdaftar-privasi
}

/** Cek satu nomor via HTTP murni. true/false bila HTML memutuskan; null bila
 *  ambigu (og generik) atau jaringan/limit gagal. */
export async function waHttpCheckOne(digits: string): Promise<boolean | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await fetch(waSendUrl(digits), {
        headers: { "User-Agent": WA_UA, "Accept-Language": "id,en;q=0.9" },
        redirect: "follow",
        signal: AbortSignal.timeout(12_000),
      });
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 + attempt * 2500));
        continue; // rate-limit/server sibuk — ulangi
      }
      return classifyWaHtml(await resp.text()).verdict;
    } catch {
      if (attempt === 1) return null;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  return null;
}

/** Cek cepat banyak nomor via HTTP murni — lapis pertama sebelum browser. */
export async function waHttpCheckNumbers(
  digitsList: string[],
  opts?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  const uniq: string[] = [];
  for (const raw of digitsList) {
    const d = toWaDigits(raw);
    if (!d) { result.set(raw, false); continue; } // tak bisa dinormalisasi → tidak valid
    if (!uniq.includes(d)) uniq.push(d);
  }
  const CONC = Math.max(1, opts?.concurrency ?? 8);
  let idx = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(CONC, Math.max(uniq.length, 1)) }, async () => {
    while (idx < uniq.length) {
      const d = uniq[idx++];
      const v = await waHttpCheckOne(d);
      for (const raw of digitsList) if (toWaDigits(raw) === d) result.set(raw, v);
      done++;
      opts?.onProgress?.(done, uniq.length);
      await new Promise((r) => setTimeout(r, 60 + Math.random() * 150)); // jeda sopan ringan
    }
  });
  await Promise.all(workers);
  for (const raw of digitsList) if (!result.has(raw)) result.set(raw, null);
  return result;
}

/** Cek satu nomor lewat request wa.me — true bila diterima, false bila ditolak */
async function checkOne(digits: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // host dikunci wa.me (https) — digits sudah murni angka
      const resp = await fetch(`https://wa.me/${digits}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36" },
      });
      if (resp.status === 302 || resp.status === 301) return true;  // diterima → redirect ke api.whatsapp.com
      if (resp.status === 404) return false;                        // ditolak wa.me
      if (resp.status >= 500) throw new Error(`server ${resp.status}`);
      return resp.status === 200;
    } catch (e) {
      if (attempt === 1) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  return false; // tidak terjangkau
}

/**
 * Cek daftar nomor (digit apa pun) via request wa.me.
 * Return Map digit-asli → true (diterima) / false (ditolak wa.me) / null (jaringan gagal).
 */
export async function waCheckNumbers(rawList: string[]): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  const uniq: string[] = [];
  for (const raw of rawList) {
    const d = toWaDigits(raw);
    if (!d) continue;
    if (result.has(raw)) continue;
    result.set(raw, null);
    if (!uniq.includes(d)) uniq.push(d);
  }

  const CONCURRENCY = 8;
  let idx = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, uniq.length) }, async () => {
    while (idx < uniq.length) {
      const d = uniq[idx++];
      try {
        const ok = await checkOne(d);
        for (const [raw, cur] of result) {
          if (cur === null && toWaDigits(raw) === d) result.set(raw, ok);
        }
      } catch {
        // jaringan gagal — biarkan null
      }
    }
  });
  await Promise.all(workers);
  return result;
}

/** Selalu siap — cek berbasis request tidak butuh sesi */
export function waReady(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// Cek MENDALAM: render api.whatsapp.com di browser — satu-satunya cara akurat
// membedakan nomor aktif vs mati (terbukti lewat probe probe-wa2.ts):
//   nomor AKTIF  → tampil NAMA PROFIL (dan/atau foto dari pps.whatsapp.net)
//   nomor MATI   → hanya heading "Ngobrol di WhatsApp dengan <nomor>" tanpa profil
// v11.3: sinyal dicari dengan POLLING (bukan tunggu tetap) agar render lambat tidak
// salah masuk keranjang "tidak pasti", plus sinyal nama-profil utk nomor valid
// yang tidak memasang foto.
// ---------------------------------------------------------------------------

/** Klasifikasi isi halaman WhatsApp → sinyal kebenaran nomor.
 *
 *  ATURAN NAMA PROFIL (pelajaran bug 43/43-aktif): konteks browser engine
 *  (viewport lebar) me-render NAVBAR situs — "Fitur | Privacy | Blog | Apps |
 *  Help Center | Log In | Download | …" — di atas interstitial. Teks navbar
 *  selalu bisa lolos dari daftar boilerplate apa pun, jadi nama profil TIDAK
 *  boleh dicari dari awal halaman: hanya SETELAH jangkar "Unduh"/"Download"
 *  (baris terakhir navbar / awal area interstitial). Tanpa jangkar → tanpa
 *  nama (andalkan avatar saja). Ini mematikan kelas false-positive "nomor
 *  mati terbaca aktif karena teks UI". */
function classifyWaPage(): { hasAvatar: boolean; numberHeading: boolean; notOnWa: boolean; profileName: string | null; blank: boolean } {
  const hasAvatar = !!document.querySelector('img[src*="pps.whatsapp.net"], img[src*="pps.wrwhatsapp"]');
  const lines = (document.body?.innerText ?? "")
    .split("\n").map((s) => s.trim()).filter(Boolean);
  const BOILER = new Set([
    // Indonesia
    "unduh", "buka aplikasi", "lanjutkan ke whatsapp web", "tidak punya aplikasinya?",
    "unduh sekarang", "yang kami lakukan", "fitur", "blog", "keamanan", "untuk bisnis",
    "siapa kami", "tentang kami", "karier", "pusat merek", "privasi", "gunakan whatsapp",
    "seluler", "desktop", "tablet", "whatsapp web", "meta", "syarat & privasi",
    "sepertinya anda belum menginstal whatsapp.",
    // Inggris
    "download", "open app", "continue to whatsapp web", "don't have whatsapp yet?",
    "download now", "what we do", "features", "security", "for business", "business",
    "who we are", "about us", "careers", "brand center", "privacy", "use whatsapp",
    "mobile", "help", "terms & privacy", "terms & privacy policy", "download whatsapp",
    "looks like you don't have whatsapp installed.",
    // Navbar situs (varian desktop, bahasa campuran) — lapis kedua setelah jangkar
    "apps", "app", "help center", "log in", "login", "sign in", "sign up", "join us",
    "android", "iphone", "ipad", "mac", "windows", "web", "company", "news", "faq",
    "contact", "contact us", "developers", "legal", "cookies", "accessibility",
  ]);
  const numberHeading = lines.some((l) =>
    /^(ngobrol di whatsapp dengan|chat on whatsapp with)\s*\+?[\d\- ]+$/i.test(l));
  const notOnWa = /not on whatsapp|tidak ada di whatsapp|nomor tidak valid|phone number (shared via url )?is invalid|number is not on whatsapp/i.test(lines.join(" ").slice(0, 600));

  const anchorIdx = lines.findIndex((l) => /^(unduh|download)$/i.test(l));
  let profileName: string | null = null;
  if (anchorIdx >= 0) {
    for (const l of lines.slice(anchorIdx + 1, anchorIdx + 9)) {
      const ll = l.toLowerCase();
      if (BOILER.has(ll)) continue;
      if (/^(ngobrol di whatsapp dengan|chat on whatsapp with)/i.test(l)) continue;
      if (/^(sepertinya|looks like)\b/i.test(l)) continue; // interstitial aplikasi, bukan nama
      if (/^[\d\-\+ ()]+$/.test(l)) continue;           // baris nomor telepon polos
      if (/whatsapp/i.test(l)) continue;                // teks UI situs, bukan nama usaha
      if (l.length < 2 || l.length > 60) continue;
      if (!/[a-z]/i.test(l)) continue;                  // harus memuat huruf
      profileName = l;
      break;
    }
  }
  return { hasAvatar, numberHeading, notOnWa, profileName, blank: lines.length < 3 };
}

/** Cek satu nomor via render halaman WhatsApp.
 *  true  = profil tampil (nama/foto) → PASTI aktif
 *  false = penanda EKSPLISIT "tidak ada di WhatsApp" → pasti mati
 *  null  = heading generik ("Ngobrol di WhatsApp dengan <nomor>") → TIDAK BISA
 *          dibedakan dari web: bisa nomor mati, bisa juga terdaftar-yang-privasi
 *          (foto/nama disembunyikan). Terbukti lewat probe: nomor terdaftar milik
 *          user tampil generik. Yang generik TIDAK BOLEH dianggap mati.
 *  Sinyal dipoll tiap 700ms (maks ±11 dtk) — render SPA kadang lambat. */
export async function waDeepCheckOne(newPage: () => Promise<any>, digits: string): Promise<boolean | null> {
  let page: any = null;
  try {
    page = await newPage();
    let r = { hasAvatar: false, numberHeading: false, notOnWa: false, profileName: null as string | null, blank: true };
    // jadwal cepat: 10 × 500ms (maks ±5 dtk) — sinyal profil selalu muncul lebih
    // awal bila ada; heading generik yang terlihat jelas tak perlu ditunggu lama.
    for (let round = 0; round < 2; round++) {          // putaran ke-2 hanya bila halaman blank
      await page.goto(`https://api.whatsapp.com/send/?phone=${digits}&text&type=phone_number&app_absent=0`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 500));
        r = await page.evaluate(classifyWaPage);
        if (r.hasAvatar || r.profileName) break;         // sinyal positif → selesai
        if (r.notOnWa && !r.numberHeading) break;        // penanda eksplisit mati
      }
      if (r.hasAvatar || r.profileName) break;           // putaran cukup — sudah pasti
      if (!r.blank) break;                               // konten terbaca tapi ambigu — tak perlu ulang
    }
    if (r.hasAvatar || r.profileName) return true;   // profil tampil = nomor aktif
    if (r.notOnWa) return false;                     // penanda eksplisit tidak terdaftar
    return null; // heading generik → tak pasti
  } catch {
    return null;
  } finally {
    try { await page?.close(); } catch {}
  }
}

/**
 * Cek mendalam banyak nomor (dinormalisasi ke 62…) — BERLAPIS demi kecepatan:
 *   LAPIS 1 (HTTP murni, konkurensi 8): mayoritas nomor selesai di sini ±0,5 dtk
 *           per nomor — aktif terbaca langsung dari og:title/og:image HTML awal.
 *   LAPIS 2 (browser, hanya untuk yang masih null): pengecekan ulang cepat
 *           (maks ±5 dtk/nomor) untuk yang HTTP-nya diblokir/ambigu/halaman aneh.
 * Return Map digit-asli → true (pasti aktif) / false (penanda eksplisit mati) /
 * null (tak pasti — heading generik: bisa mati, bisa terdaftar-yang-privasi).
 * Apa yang terjadi pada null ditentukan PEMANGGIL: mode ketat (requireWa /
 * periksa ulang) membuang yang tak terverifikasi; mode normal hanya menandai.
 */
export async function waDeepCheckNumbers(
  newPage: () => Promise<any>,
  digitsList: string[],
  opts?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
): Promise<Map<string, boolean | null>> {
  const result = new Map<string, boolean | null>();
  const uniq: string[] = [];
  for (const raw of digitsList) {
    const d = toWaDigits(raw);
    if (!d) { result.set(raw, false); continue; } // tak bisa dinormalisasi → tidak valid
    if (!uniq.includes(d)) uniq.push(d);
  }
  const mem = await cacheLoad();

  // LAPIS 0 — cache: nomor yang masih berlaku verdict-nya = instan (mikrodetik).
  const need: string[] = [];
  for (const d of uniq) {
    const c = cacheGet(mem[d]);
    if (c === undefined) { need.push(d); continue; }
    for (const raw of digitsList) if (toWaDigits(raw) === d) result.set(raw, c);
  }

  if (need.length > 0) {
    // LAPIS 1 — HTTP murni (tanpa browser), konkurensi 24: ±ratusan milidetik/nomor.
    const http = await waHttpCheckNumbers(need, {
      concurrency: 24,
      onProgress: opts?.onProgress,
    });
    for (const d of need) {
      const v = http.get(d) ?? null;
      cachePut(mem, d, v);
      for (const raw of digitsList) if (toWaDigits(raw) === d) result.set(raw, v);
    }

    // PENGAMAN ANTI MASS-NULL: bila hampir semua hasil ambigu (indikasi kuat
    // WhatsApp sedang membatasi IP), beri jeda lalu periksa ulang sekali —
    // supaya verdict tidak bohong hanya karena layer yang sedang di-throttle.
    const nulls1 = need.filter((d) => (http.get(d) ?? null) === null);
    if (need.length >= 10 && nulls1.length / need.length >= 0.8) {
      await new Promise((r) => setTimeout(r, 15_000));
      const retry = await waHttpCheckNumbers(nulls1, { concurrency: 8 });
      for (const d of nulls1) {
        const v = retry.get(d) ?? null;
        if (v !== null) cachePut(mem, d, v);
        for (const raw of digitsList) if (toWaDigits(raw) === d && (result.get(raw) ?? null) === null) result.set(raw, v);
      }
    }

    // LAPIS 2 — browser hanya untuk nomor yang HTTP-nya ambigu (null).
    const ambigu = need.filter((d) => (http.get(d) ?? null) === null);
    if (ambigu.length > 0) {
      const CONC = Math.max(1, Math.min(opts?.concurrency ?? 6, ambigu.length));
      let idx = 0;
      const workers = Array.from({ length: CONC }, async () => {
        while (idx < ambigu.length) {
          const d = ambigu[idx++];
          const ok = await waDeepCheckOne(newPage, d); // jadwal cepat di dalamnya
          if (ok !== null) cachePut(mem, d, ok);
          for (const raw of digitsList) {
            if (toWaDigits(raw) === d && (result.get(raw) ?? null) === null) result.set(raw, ok);
          }
          await new Promise((r) => setTimeout(r, 300 + Math.random() * 600)); // jeda sopan
        }
      });
      await Promise.all(workers);
    }
  }
  await cacheSave();

  for (const raw of digitsList) if (!result.has(raw)) result.set(raw, null);
  return result;
}
