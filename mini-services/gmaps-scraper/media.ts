// Engine "Unduh Media" — kumpulkan SEMUA foto (dan video bila mungkin) dari link
// Google Maps tempat bisnis, lalu kemas jadi satu arsip ZIP.
//
// Alur per link:
//   1. Buka halaman tempat (Playwright — link share maps.app.goo.gl ikut ter-resolve
//      lewat redirect bawaan browser).
//   2. Panen URL foto dari tiga sumber: APP_INITIALIZATION_STATE di HTML awal,
//      respons RPC photo/listentityphotos (daftar galeri lengkap), dan DOM galeri
//      saat dibuka + di-scroll (lightbox memuat foto bertahap).
//   3. Video ditangkap best-effort dari jejak jaringan (gps-proxy / .mp4) — tidak
//      dijamin; Google menyajikan video dengan pola yang sering berubah.
//   4. Unduh tiap foto via HTTP murni (CDN googleusercontent tidak butuh cookie),
//      variasi "=d" (asli) dulu, gagal → "=w1600-h1600-k-no".
//   5. Kemas folder hasil ke ZIP metode STORE (foto sudah terkompresi; tanpa
//      dependensi tambahan).

import { mkdirSync, readdirSync, rmSync, statSync, type Dirent } from "node:fs";
import path from "node:path";
import { USER_AGENT, type BrowserManager } from "./browser";
import { fetchDetailFast } from "./fast-detail";

const MEDIA_DIR = path.join(import.meta.dir, "media");

// batas pengaman
const MAX_LINKS = 20;
const MAX_PHOTOS_PER_PLACE = 200; // galeri patologis tidak boleh menggantung selamanya
const DISCOVERY_MAX_MS = 180_000; // batas waktu panen per tempat (jalan Next + sapuan)
const DOWNLOAD_CONCURRENCY = 4;

// Navigasi hanya ke domain Google yang sah — link dari pengguna tidak pernah
// dieksekusi sebagai perintah, hanya diparse URL lalu dinavigasi oleh Playwright.
const ALLOWED_NAV_HOSTS = [".google.com", ".goo.gl", ".g.co"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Validasi & normalisasi link input → href URL, atau null bila tidak sah. */
function normalizeLink(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_NAV_HOSTS.some((s) => host === s.slice(1) || host.endsWith(s))) return null;
  u.hash = "";
  return u.href;
}

// ---------- tipe ----------
type MediaStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface MediaItem {
  url: string;          // link input (ternormalisasi)
  name: string;         // nama tempat (dari judul halaman)
  slug: string;         // nama folder di dalam arsip
  photos: number;       // foto ditemukan
  videos: number;       // video ditemukan (best-effort)
  downloaded: number;
  failed: number;
  webp: number;         // berkas tersimpan sebagai WebP
  webpBytes: number;    // total byte akhir berkas WebP (utk rata-rata)
  savedBytes: number;   // penghematan byte dari konversi WebP
  error: string | null;
}

interface MediaJob {
  id: string;
  status: MediaStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  links: string[];
  webp: boolean;        // kompres gambar ke WebP
  preset: WebpPreset;   // preset kompresi (web/balanced/full)
  items: MediaItem[];
  logs: { t: number; level: "info" | "success" | "warn" | "error"; msg: string }[];
  cancelled: boolean;
  zipName: string | null;
  zipBytes: number;
}

// state singleton di globalThis agar aman terhadap bun --hot
interface MediaState {
  jobs: Map<string, MediaJob>;
  runningId: string | null;
  getBm: (() => BrowserManager) | null;
  // sesi cepat (HTTP murni): cookie+token dari satu muat halaman Maps —
  // token terbukti lintas-tempat, cukup sekali bootstrap per ±25 menit
  fastCookie: string | null;
  fastToken: string | null;
  fastBornAt: number;
}
const g = globalThis as any;
const mediaState: MediaState =
  g.__MEDIA_STATE__ ??
  (g.__MEDIA_STATE__ = { jobs: new Map<string, MediaJob>(), runningId: null, getBm: null, fastCookie: null, fastToken: null, fastBornAt: 0 });

export function mediaSetBrowser(getBm: () => BrowserManager) {
  mediaState.getBm = getBm;
}

function log(job: MediaJob, level: MediaJob["logs"][number]["level"], msg: string) {
  job.logs.push({ t: Date.now(), level, msg });
  if (job.logs.length > 400) job.logs.splice(0, job.logs.length - 400);
}

// ---------- util ----------
const PHOTO_RE = /https:\/\/lh\d+\.googleusercontent\.com\/(?:p|gps-cs-s|gps-cs)\/[A-Za-z0-9_-]{10,}/g;
const VIDEO_HINT = /googleusercontent\.com\/[^\s"'<>]*(?:gps-proxy|gps-video|\.mp4)/i;

function harvest(text: string | null | undefined, photos: Set<string>, videos: Set<string>) {
  if (!text) return;
  // dasar foto tanpa sufiks ukuran (=w203-h152…) — variasi resolusi ditempel saat unduh
  for (const m of text.matchAll(PHOTO_RE)) {
    photos.add(m[0]);
  }
}

function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "";
}

/** Baca klaim jumlah foto dari teks tombol: "41 Photos" → 41, "457+ Foto" → 457,
 *  "1,2 rb Foto" → 1200. 0 bila tidak terbaca. */
function parseClaimed(txt: string): number {
  const m = txt.match(/([\d.,]+)\s*(rb|ribu|k)?\s*(foto|photos?)/i);
  if (!m) return 0;
  const num = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  if (!isFinite(num)) return 0;
  return m[2] ? Math.round(num * 1000) : Math.round(num);
}

function extFromType(type: string): string {
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("video/mp4") || type.includes("quicktime")) return "mp4";
  return "jpg";
}

async function resolveName(page: any): Promise<string> {
  try {
    const t = String(await page.title() ?? "").replace(/\s*[-–]\s*Google Maps\s*$/i, "").trim();
    if (t && t.toLowerCase() !== "google maps") return t.slice(0, 120);
  } catch {}
  try {
    const h1 = await page.locator("h1").first().innerText({ timeout: 2000 });
    if (h1?.trim()) return h1.trim().slice(0, 120);
  } catch {}
  return "";
}

// pembuka galeri: aria-label "Foto <nama>" (ID), "Photo of <nama>" / "Photos …" (EN),
// atau tombol berteks "<n> Foto/Photos" (cth "457+ Foto", "41 Photos") — JANGAN
// "Tambahkan foto & video" / "Add photos & videos"
const GALLERY_SELECTORS = [
  'button[aria-label^="Foto "]',
  'button[aria-label^="Photo "]',
  'button[aria-label^="Photos "]',
  'button[aria-label="Foto"]',
  'button[aria-label*="Lihat semua foto"]',
  'button[aria-label*="See all photos"]',
];
const GALLERY_TEXT_RE = /^\d[\d.,]*\s*(\+|rb|ribu|k)?\s*(foto|photos?)(\/video)?\s*$/i;

// ---------- MODE CEPAT (HTTP murni, hasil reverse-engineering RPC hspqX) ----------
// Protokol (terbukti via eksperimen matriks):
//   1. SATU muat halaman Maps di browser → cookie konteks + token sesi dari DOM
//      (token terbukti LINTAS-TEMPAT: satu bootstrap cukup untuk semua link)
//   2. POST batchexecute rpcids=hspqX dgn payload JSON 15-elemen → daftar URL foto
//      lengkap (20/halaman, paginasi) — 0,3 dtk/halaman, tanpa browser
//   3. Gagal/diubah Google → fallback otomatis ke panen browser (jalan Next)
const FAST_SESSION_TTL_MS = 25 * 60_000;
const FAST_MAX_PAGES = 12;
const HSPQX_URL = "https://www.google.com/maps/_/MapsWizUi/data/batchexecute?rpcids=hspqX&hl=en&authuser=0&_reqid=1001&rt=c";

/** Bootstrap sesi cepat: priming cookie (ctx.request — HTTP, tanpa render) → satu
 *  muat halaman → token sesi dari DOM + cookie penuh (__Secure-ENID wajib). */
async function ensureFastSession(bm: BrowserManager, bootstrapLink: string, force = false): Promise<{ cookie: string; token: string } | null> {
  if (!force && mediaState.fastToken && Date.now() - mediaState.fastBornAt < FAST_SESSION_TTL_MS) {
    return { cookie: mediaState.fastCookie!, token: mediaState.fastToken };
  }
  const page = await bm.newPage();
  try {
    // priming: minta halaman via HTTP murni dulu — Set-Cookie (__Secure-ENID dsb.)
    // masuk ke konteks browser; tanpa ini token yang ada di DOM tidak sah utk hspqX
    const ctx = await bm.getContext();
    await ctx.request.get(bootstrapLink, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,id;q=0.9" } }).catch(() => {});
    await page.goto(bootstrapLink, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2500);
    const html = await page.content().catch(() => "");
    // pola slot sesi di APP_INITIALIZATION_STATE: [\"TOKEN\",null,null,null,null,null,81,…]
    const m = html.replace(/\\\//g, "/").match(/\[\\?"?([A-Za-z0-9_-]{20,28})\\?"?,null,null,null,null,null,81/);
    if (!m) {
      console.log(`[media-fast] token TIDAK ditemukan | html ${html.length} | pola81: ${(html.match(/null,null,null,null,null,81/g) ?? []).length}`);
      return null;
    }
    const cookie = (await ctx.cookies("https://www.google.com")).map((c: any) => `${c.name}=${c.value}`).join("; ");
    if (!cookie) {
      console.log("[media-fast] cookie konteks kosong");
      return null;
    }
    console.log(`[media-fast] sesi OK: token ${m[1]} | cookie ${(cookie.match(/=/g) ?? []).length} pasang`);
    mediaState.fastCookie = cookie;
    mediaState.fastToken = m[1];
    mediaState.fastBornAt = Date.now();
    return { cookie, token: m[1] };
  } catch {
    return null;
  } finally {
    try { await page.close(); } catch {}
  }
}

/** Ikuti redirect link (goo.gl dsb.) → CID + KGID + petunjuk nama.
 *  Link google.com diparse langsung (CID/KGID ada di blob datanya) tanpa fetch. */
async function resolvePlaceRef(link: string): Promise<{ cid: string | null; kgid: string | null; nameHint: string | null }> {
  let finalUrl = link;
  if (/goo\.gl|(^|\.|\b)g\.co\//i.test(link)) {
    try {
      const resp = await fetch(link, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,id;q=0.9" }, redirect: "follow" });
      finalUrl = resp.url || link;
      if (/goo\.gl|g\.co/.test(new URL(finalUrl).hostname)) {
        const body = await resp.text().catch(() => "");
        const href = body.match(/https:\/\/www\.google\.com\/maps\/[^"'<>\\]+/)?.[0]
          ?? body.match(/href="(https:\/\/[^"]*maps[^"]*)"/)?.[1];
        if (href) finalUrl = href.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
      } else {
        try { await resp.body?.cancel(); } catch {}
      }
    } catch {}
  }
  const u = decodeURIComponent(finalUrl);
  let cid = u.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/)?.[1]
    ?? u.match(/place_id:(ChIJ[A-Za-z0-9_-]+)/)?.[1]
    ?? u.match(/!19s(ChIJ[A-Za-z0-9_-]+)/)?.[1]
    ?? null;
  // hspqX hanya menerima bentuk CID (0x…:0x…); ChIJ harus di-resolve dulu lewat
  // shell halaman — server merender CID tempat di APP_INITIALIZATION_STATE (HTTP murni).
  if (cid && !cid.startsWith("0x")) {
    try {
      const shell = await (await fetch(finalUrl, { headers: { "User-Agent": USER_AGENT, "Accept-Language": "en,id;q=0.9" }, redirect: "follow" })).text();
      cid = shell.match(/0x[0-9a-f]{10,}:0x[0-9a-f]{8,}/)?.[0] ?? cid;
    } catch {}
  }
  const kgRaw = u.match(/!16s(?:%2F|\/)g(?:%2F|\/)([A-Za-z0-9_-]+)/)?.[1];
  // nama hanya dari segmen path yang sah (bukan "?q=place_id:…" / "@koordinat")
  const nameM = u.match(/\/maps\/place\/([^/?@][^/]*)/);
  const nameHint = nameM ? decodeURIComponent(nameM[1]).replace(/\+/g, " ").trim() || null : null;
  return {
    cid,
    kgid: kgRaw ? `/g/${kgRaw}` : null,
    nameHint,
  };
}

/** Panggil hspqX satu halaman → set URL foto dasar. Respons pendek = tawaran sesi (usang). */
async function hspqxPage(sess: { cookie: string; token: string }, cid: string, kgid: string | null, page: number, pageSize = 20): Promise<Set<string>> {
  // payload verbatim hasil bedah tangkapan (root 16 elemen; sesi di root[5] 15 elemen).
  // Slot KGID tetap berbentuk pembungkus [[null,null,null,X]] walau X null —
  // bentuk null polos ditolak server utk tempat place_id (terbukti via uji matriks).
  const cidSlot: any[] = [cid, null, null, null, null, null, null, null, 0, null, null, null, null, null, [[null, null, null, kgid ?? null]]];
  const pagSlot: any[] = [null, [203, 100], [null, pageSize, null, null, page], null, null, null,
    [[[1, 0, 3], [2, 1, 2], [2, 0, 3], [8, 0, 3], [10, 0, 3], [10, 1, 2], [10, 0, 4], [9, 1, 2]], 1],
    null, 0, null, null, null, null, null, [[[[[[2]]], [195, 195], 20]]]];
  const sessSlot: any[] = [sess.token, null, null, null, null, null, 81, null, null, null, null, null, null, null, 16698];
  const inner = JSON.stringify([2, null, cidSlot, null, pagSlot, sessSlot, null, null, null, null, null, null, null, null, null, [null, 1, null, 1]]);
  const resp = await fetch(HSPQX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT, Cookie: sess.cookie,
      Origin: "https://www.google.com", Referer: "https://www.google.com/",
    },
    body: new URLSearchParams({ "f.req": JSON.stringify([[["hspqX", inner, null, "generic"]]]) }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await resp.text();
  const urls = new Set<string>();
  // unescape benar: \/ → / dan \u003d (=) → = — strip-backslash-menyelurah merusak
  // token (menempelkan sufiks "u003dw203…" ke base URL → 400 dari CDN)
  harvest(body.replace(/\\\//g, "/").replace(/\\u003d/gi, "="), urls, new Set());
  if (urls.size === 0) console.log(`[media-fast] hspqX hal.${page}: respons ${body.length} byte, 0 foto (sesi ditolak?) | cid=${cid.slice(0, 22)}…`);
  return urls;
}

/** Panen cepat satu link: resolve → hspqX (permintaan besar 100 + paginasi 20,
 *  keduanya digabung utk cakupan maksimal) → URL foto (nama dari URL/RPC detail). */
async function collectFast(bm: BrowserManager, sess: { cookie: string; token: string }, link: string, isCancelled?: () => boolean): Promise<{ name: string; photos: string[]; videos: string[] } | null> {
  const ref = await resolvePlaceRef(link);
  if (!ref.cid) return null;
  const photos = new Set<string>();
  const cancelled = () => isCancelled?.() ?? false;

  // 1) satu permintaan ukuran 100 — biasanya memuat seluruh galeri sekaligus
  const big = await hspqxPage(sess, ref.cid!, ref.kgid, 1, 100).catch(() => new Set<string>());
  for (const u of big) photos.add(u);

  // 2) paginasi 20/halaman digabung — menjangkau entri yang tak ikut batch besar
  for (let p = 1; p <= FAST_MAX_PAGES && !cancelled; p++) {
    const got = await hspqxPage(sess, ref.cid!, ref.kgid, p).catch(() => new Set<string>());
    const before = photos.size;
    for (const u of got) photos.add(u);
    if (got.size === 0 || photos.size === before) break; // halaman habis / sesi usang
  }
  if (photos.size === 0) return null;
  // nama: petunjuk path URL → RPC detail (HTTP murni) → kosong
  let name = ref.nameHint ?? "";
  if (!name) {
    try {
      // v13: fetch global dulu; context browser hanya dibuat bila diperlukan
      const d = await fetchDetailFast(() => bm.getContext(), ref.cid!.includes(":") ? ref.cid : undefined, 8000);
      name = (d as any)?.name ?? "";
    } catch {}
  }
  return { name, photos: [...photos], videos: [] };
}

/** Skrip langkah gulir: maju ±550px di semua wadah scrollable besar — tile yang
 *  masuk viewport memuat background-nya; lompatan langsung ke bawah melewati tile tengah. */
const STEP_SCROLL_JS = `(() => {
  let moved = false, allBottom = true;
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) {
      const max = el.scrollHeight - el.clientHeight;
      if (el.scrollTop < max - 10) { el.scrollTop = Math.min(el.scrollTop + 550, max); moved = true; allBottom = false; }
    }
  }
  return moved ? 'moved' : (allBottom ? 'bottom' : 'none');
})()`;
const RESET_TOP_JS = `(() => {
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300) el.scrollTop = 0;
  }
})()`;

/** Buka satu link tempat & kumpulkan URL dasar semua foto (dan video bila terlihat).
 *  isCancelled: dipanggil berkala — job yang dihapus berhenti membuang waktu. */
async function collectPlaceMedia(bm: BrowserManager, link: string, isCancelled?: () => boolean): Promise<{ name: string; photos: string[]; videos: string[] }> {
  const cancelled = () => isCancelled?.() ?? false;
  const page = await bm.newPage();
  const photos = new Set<string>();
  const videos = new Set<string>();
  const deadline = Date.now() + DISCOVERY_MAX_MS;

  const onResponse = (resp: any) => {
    const u = String(resp?.url?.() ?? "");
    // RPC daftar galeri — body-nya memuat daftar panjang URL foto (bila dipakai Maps)
    if (u.includes("listentityphotos") || u.includes("/maps/rpc/photo")) {
      resp.text().then((b: string) => harvest(String(b).replace(/\\\//g, "/"), photos, videos)).catch(() => {});
    }
    if (VIDEO_HINT.test(u)) videos.add(u);
    if (/lh\d+\.googleusercontent\.com\/(?:p|gps-cs-s|gps-cs)\//.test(u)) harvest(u, photos, videos);
  };
  page.on("response", onResponse);

  let name = "";
  try {
    await page.goto(link, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2200);
    name = await resolveName(page);
    const countPhotos = async () => {
      harvest(await page.content().catch(() => ""), photos, videos);
      return photos.size;
    };
    await countPhotos();

    // buka galeri (grid foto) — klik berulang sampai terverifikasi jumlah URL naik
    // (hydrasi Maps lambat: tombol "457+ Foto" bisa muncul belakangan)
    const before = await countPhotos();
    let claimed = 0; // jumlah foto yang diklaim Maps (dari teks tombol "41 Photos")
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened && Date.now() < deadline && !cancelled(); attempt++) {
      for (const sel of GALLERY_SELECTORS) {
        try {
          await page.locator(sel).first().click({ timeout: 1500 });
        } catch { continue; }
        await sleep(1600);
        if ((await countPhotos()) > before) { opened = true; break; }
      }
      if (opened || Date.now() > deadline) break;
      // strategi teks: cari tombol "<n> Foto/Photos" — sekalian baca klaim jumlahnya
      try {
        const btns = page.locator('button:has-text("Foto"), button:has-text("Photo")');
        const n = Math.min(await btns.count(), 15);
        for (let bi = 0; bi < n; bi++) {
          const txt = String(await btns.nth(bi).innerText({ timeout: 800 }).catch(() => "")).trim();
          if (!GALLERY_TEXT_RE.test(txt)) continue;
          claimed = parseClaimed(txt);
          await btns.nth(bi).click({ timeout: 1500 });
          await sleep(1600);
          if ((await countPhotos()) > before) { opened = true; break; }
        }
      } catch {}
      if (!opened) await sleep(1500);
    }

    // JALAN NEXT: tombol Next pada galeri memajukan foto satu per satu dan tiap
    // klik memuat foto berikutnya (teruji: 41 foto Groomix termuat 39-41). Google
    // kadang lambat memuat batch (apalagi saat 2 tab paralel) — kesabaran 12 klik
    // kosong wajib, plus putaran kedua bila klaim Maps belum tercapai.
    const NEXT_SEL = 'button[aria-label*="Next" i], button[aria-label*="erikutnya"]';
    const complete = () => claimed > 0 && photos.size >= claimed;
    const walk = async () => {
      let stable = 0;
      while (stable < 12 && !complete() && photos.size < MAX_PHOTOS_PER_PLACE && Date.now() < deadline && !cancelled()) {
        const prev = photos.size;
        try { await page.locator(NEXT_SEL).first().click({ timeout: 1500 }); } catch {
          try { await page.keyboard.press("ArrowRight"); } catch {}
        }
        await sleep(480);
        harvest(await page.content().catch(() => ""), photos, videos);
        if (photos.size > prev) stable = 0; else stable++;
      }
    };
    await walk();

    // SAPUAN BERTAHAP (cadangan) + jalan kedua — hanya bila klaim Maps belum tercapai.
    if (!complete() && !cancelled()) {
      try { await page.evaluate(RESET_TOP_JS); } catch {}
      await sleep(400);
      let idle = 0;
      while (idle < 5 && photos.size < MAX_PHOTOS_PER_PLACE && Date.now() < deadline && !cancelled()) {
        const prev = photos.size;
        let state = "none";
        try { state = String(await page.evaluate(STEP_SCROLL_JS)); } catch {}
        await sleep(400);
        harvest(await page.content().catch(() => ""), photos, videos);
        if (photos.size > prev) idle = 0;
        else if (state !== "moved") idle++;
      }
      if (!complete() && photos.size < MAX_PHOTOS_PER_PLACE && Date.now() < deadline) await walk();
    }
  } finally {
    try { await page.off("response", onResponse); } catch {}
    try { await page.close(); } catch {}
  }
  return { name, photos: [...photos], videos: [...videos] };
}

// ---------- unduh file ----------
/** Varian ukuran URL CDN sesuai preset — unduhan langsung pas ukuran (web: 1280px
 *  ≈ 100–200KB vs original 1–2MB), bukan original lalu dibuang saat konversi. */
function variantsFor(preset: WebpPreset, isVideo: boolean): string[] {
  if (isVideo) return [""];
  if (preset === "web") return ["=w1280-h1280-k-no", "=w1600-h1600-k-no"];
  if (preset === "balanced") return ["=w1920-h1920-k-no", "=d"];
  return ["=d", "=w1600-h1600-k-no"];
}

async function downloadMedia(url: string, isVideo: boolean, variants: string[]): Promise<{ buf: Uint8Array; ext: string } | null> {
  for (const v of variants) {
    try {
      const resp = await fetch(url + v, {
        headers: { "User-Agent": USER_AGENT, Referer: "https://www.google.com/", Accept: "image/*,video/*,*/*;q=0.8" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) {
        console.log(`[media-dl] ${resp.status} ${v || "(asli)"}`);
        continue;
      }
      const type = resp.headers.get("content-type") ?? "";
      if (!type.startsWith("image/") && !type.startsWith("video/")) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.byteLength < 1500) continue; // respons error kecil berpakaian 200
      return { buf, ext: extFromType(type) };
    } catch {}
  }
  return null;
}

// ---------- konversi WebP ----------
// sharp dimuat malas: bila modul tak tersedia, layanan tetap jalan dan berkas
// disimpan dalam format aslinya.
let sharpMod: any | null | undefined; // undefined = belum dicoba, null = tak tersedia
async function getSharp(): Promise<any | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    const mod = await import("sharp");
    sharpMod = (mod as any).default ?? mod;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

export type WebpPreset = "web" | "balanced" | "full";
const WEBP_PRESETS: Record<WebpPreset, { maxDim: number | null; quality: number; effort: number }> = {
  // "web": resolusi disesuaikan kebutuhan tampilan website — terlihat sama di layar,
  // berkas jauh lebih kecil (foto Maps aslinya 3000-4000px, website cuma butuh ≤1280px)
  web: { maxDim: 1280, quality: 72, effort: 6 },
  balanced: { maxDim: 1920, quality: 80, effort: 5 },
  full: { maxDim: null, quality: 82, effort: 6 },
};

/** Kompres gambar ke WebP sesuai preset. Null bila sebaiknya memakai asli:
 *  modul tak ada, format tak didukung, atau hasil malah lebih besar. */
async function toWebp(buf: Uint8Array, ext: string, preset: WebpPreset): Promise<{ buf: Uint8Array; ext: string } | null> {
  if (ext === "webp" && preset === "full") return { buf, ext: "webp" }; // sudah WebP penuh — apa adanya
  if (ext === "gif") return null; // bisa animasi — biarkan
  const sharp = await getSharp();
  if (!sharp) return null;
  const cfg = WEBP_PRESETS[preset] ?? WEBP_PRESETS.web;
  try {
    let img = sharp(Buffer.from(buf), { failOn: "none" });
    if (cfg.maxDim) {
      // sisi terpanjang dibatasi maxDim; tidak pernah memperbesar
      img = img.resize({ width: cfg.maxDim, height: cfg.maxDim, fit: "inside", withoutEnlargement: true });
    }
    const out = await img.webp({ quality: cfg.quality, effort: cfg.effort }).toBuffer({ resolveWithObject: true });
    const data: Buffer = out?.data;
    if (!data || data.length < 500 || data.length >= buf.length) return null;
    return { buf: new Uint8Array(data), ext: "webp" };
  } catch {
    return null;
  }
}

// ---------- penulis ZIP (metode STORE, tanpa dependensi) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xffff,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

function walkFiles(dir: string, base = ""): { rel: string; abs: string; mtime: Date }[] {
  const out: { rel: string; abs: string; mtime: Date }[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (e.isFile()) {
      try { out.push({ rel, abs, mtime: new Date(statSync(abs).mtimeMs) }); } catch {}
    }
  }
  return out;
}

/** Kemas seluruh isi folder menjadi ZIP (STORE). Mengembalikan ukuran arsip byte. */
async function buildZip(dir: string, zipPath: string): Promise<number> {
  const files = walkFiles(dir).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const sink = Bun.file(zipPath).writer();
  const central: Uint8Array[] = [];
  let offset = 0;
  try {
    for (const f of files) {
      const data = new Uint8Array(await Bun.file(f.abs).arrayBuffer());
      const crc = crc32(data);
      const nameBuf = Buffer.from(f.rel, "utf8");
      const { time, date } = dosDateTime(f.mtime);
      const lh = Buffer.alloc(30);
      lh.write("PK\x03\x04", 0, "binary");
      lh.writeUInt16LE(20, 4);          // version needed
      lh.writeUInt16LE(0x0800, 6);      // flag: nama UTF-8
      lh.writeUInt16LE(0, 8);           // method STORE
      lh.writeUInt16LE(time, 10);
      lh.writeUInt16LE(date, 12);
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(data.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      await sink.write(lh);
      await sink.write(nameBuf);
      await sink.write(data);

      const ch = Buffer.alloc(46);
      ch.write("PK\x01\x02", 0, "binary");
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(time, 12);
      ch.writeUInt16LE(date, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(data.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt16LE(0, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);          // external attrs
      ch.writeUInt32LE(offset, 42);     // offset local header (byte 42, bukan 38/40)
      central.push(Buffer.concat([ch, nameBuf]));

      offset += 30 + nameBuf.length + data.length;
    }
    const cdStart = offset;
    for (const c of central) {
      await sink.write(c);
      offset += c.length;
    }
    const eocd = Buffer.alloc(22);
    eocd.write("PK\x05\x06", 0, "binary");
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(offset - cdStart, 12);
    eocd.writeUInt32LE(cdStart, 16);
    eocd.writeUInt16LE(0, 20);
    await sink.write(eocd);
  } finally {
    try { await sink.end(); } catch {}
  }
  return offset + 22;
}

// ---------- ringkasan utk API ----------
function countTotals(job: MediaJob) {
  const t = { photos: 0, videos: 0, downloaded: 0, failed: 0, webp: 0, saved: 0, webpBytes: 0 };
  for (const it of job.items) {
    t.photos += it.photos;
    t.videos += it.videos;
    t.downloaded += it.downloaded;
    t.failed += it.failed;
    t.webp += it.webp;
    t.saved += it.savedBytes;
    t.webpBytes += it.webpBytes;
  }
  return t;
}

function percentOf(job: MediaJob): number {
  if (job.status === "completed" || job.status === "cancelled") return 100;
  if (job.items.length === 0) return job.status === "running" ? 2 : 0;
  let acc = 0;
  for (const it of job.items) {
    const total = it.photos + it.videos;
    // bobot per link: panen 25%, unduh 75%
    acc += (total > 0 ? 25 : it.error ? 25 : 12) + (total > 0 ? 75 * ((it.downloaded + it.failed) / total) : 0);
  }
  return Math.min(99, Math.round(acc / job.links.length));
}

function mediaSummary(job: MediaJob) {
  const t = countTotals(job);
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    linkCount: job.links.length,
    links: job.links,
    items: job.items,
    logs: job.logs.slice(-200),
    cancelled: job.cancelled,
    zipReady: !!job.zipName,
    zipBytes: job.zipBytes,
    percent: percentOf(job),
    totals: t,
  };
}

type MediaType = { ok: true; job: ReturnType<typeof mediaSummary> } | { ok: false; error: string; status: number };

export function mediaCreate(links: string[], opts?: { webp?: boolean; preset?: string }): MediaType {
  const clean: string[] = [];
  for (const raw of links) {
    const href = normalizeLink(raw);
    if (!href) continue;
    if (clean.includes(href)) continue;
    clean.push(href);
    if (clean.length >= MAX_LINKS) break;
  }
  if (clean.length === 0) {
    return { ok: false, error: "Tidak ada link Google Maps yang valid (wajib domain google.com / goo.gl / g.co)", status: 400 };
  }
  if (mediaState.runningId) {
    return { ok: false, error: "Ada job unduh media yang sedang berjalan — tunggu selesai atau batalkan dulu", status: 429 };
  }
  const preset: WebpPreset = opts?.preset === "balanced" || opts?.preset === "full" ? opts.preset : "web";
  const webpOn = opts?.webp !== false;
  const job: MediaJob = {
    id: `media_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    status: "queued",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    links: clean,
    webp: webpOn,
    preset,
    items: [],
    logs: [
      { t: Date.now(), level: "info", msg: `Job dibuat — ${clean.length} link tempat akan diunduh medianya${webpOn ? ` (kompres WebP aktif, preset ${preset})` : " (format asli)"}.` },
    ],
    cancelled: false,
    zipName: null,
    zipBytes: 0,
  };
  mediaState.jobs.set(job.id, job);
  void runMediaJob(job);
  return { ok: true, job: mediaSummary(job) };
}

export function mediaList() {
  return [...mediaState.jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(mediaSummary);
}

export function mediaGet(id: string) {
  const job = mediaState.jobs.get(id);
  return job ? mediaSummary(job) : null;
}

export function mediaDelete(id: string): boolean {
  const job = mediaState.jobs.get(id);
  if (!job) return false;
  if (job.status === "running" || job.status === "queued") job.cancelled = true;
  job.status = "cancelled";
  job.finishedAt = Date.now();
  mediaState.jobs.delete(id);
  // bersihkan berkas di disk (folder job + zip)
  try { rmSync(path.join(MEDIA_DIR, job.id), { recursive: true, force: true }); } catch {}
  if (job.zipName) { try { rmSync(path.join(MEDIA_DIR, job.zipName), { force: true }); } catch {} }
  return true;
}

export function mediaZip(id: string): { path: string; filename: string } | null {
  const job = mediaState.jobs.get(id);
  if (!job?.zipName) return null;
  const p = path.join(MEDIA_DIR, job.zipName);
  const first = job.items.find((i) => i.slug)?.slug ?? "maps";
  const d = new Date(job.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return { path: p, filename: `klienflow-media-${first}-${stamp}.zip` };
}

// ---------- pelaksana job ----------
/** Fase 1: panen referensi foto → siapkan folder. Null bila gagal/tanpa media.
 *  Mode cepat (HTTP murni hspqX) dicoba lebih dulu; browser jalan-Next hanya fallback. */
async function discoverLink(job: MediaJob, bm: BrowserManager, jobDir: string, li: number, item: MediaItem): Promise<{ list: { u: string; isVideo: boolean }[]; dir: string } | null> {
  const link = job.links[li];
  log(job, "info", `[${li + 1}/${job.links.length}] Memeriksa ${link.slice(0, 80)}…`);
  let found: { name: string; photos: string[]; videos: string[] } | null = null;

  // --- mode cepat: satu bootstrap sesi per ±25 mnt, lalu semua link via HTTP murni ---
  const sess = await ensureFastSession(bm, link);
  if (sess && !job.cancelled) {
    const fast = await collectFast(bm, sess, link, () => job.cancelled).catch(() => null);
    if (fast && fast.photos.length > 0) {
      found = fast;
      log(job, "info", `[${li + 1}] Mode cepat (HTTP): ${fast.photos.length} foto.`);
    } else {
      // sesi bisa usang tepat setelah TTL — segarkan sekali lalu ulangi
      const fresh = await ensureFastSession(bm, link, true);
      if (fresh) {
        const retry = await collectFast(bm, fresh, link, () => job.cancelled).catch(() => null);
        if (retry && retry.photos.length > 0) {
          found = retry;
          log(job, "info", `[${li + 1}] Mode cepat (HTTP, sesi segar): ${retry.photos.length} foto.`);
        }
      }
    }
  }

  // --- fallback: panen galeri via browser (jalan Next + sapuan) ---
  if (!found && !job.cancelled) {
    log(job, "info", `[${li + 1}] Mode cepat tidak tersedia — memakai browser (lebih lambat).`);
    found = await collectPlaceMedia(bm, link, () => job.cancelled);
  }
  if (!found || job.cancelled) return null;

  try {
    item.name = found.name || `Tempat ${li + 1}`;
    // folder unik bila dua tempat menghasilkan slug sama
    const baseSlug = slugify(found.name) || `tempat-${li + 1}`;
    let dir = path.join(jobDir, baseSlug);
    let n = 2;
    while (readdirSync(jobDir, { withFileTypes: true }).some((e) => e.name === path.basename(dir))) {
      dir = path.join(jobDir, `${baseSlug}-${n}`);
      n++;
    }
    item.slug = path.basename(dir);
    mkdirSync(dir, { recursive: true });
    item.photos = found.photos.length;
    item.videos = found.videos.length;
    const total = item.photos + item.videos;
    if (total === 0) {
      item.error = "Tidak ada foto/video terdeteksi — pastikan link membuka halaman tempat (bukan hasil pencarian)";
      log(job, "warn", `[${li + 1}] ${item.name}: tidak ada media ditemukan.`);
      return null;
    }
    log(job, "success", `[${li + 1}] ${item.name}: ${item.photos} foto${item.videos ? ` + ${item.videos} video` : ""} ditemukan — mengunduh…`);
    return {
      list: [...found.photos.map((u) => ({ u, isVideo: false })), ...found.videos.map((u) => ({ u, isVideo: true }))],
      dir,
    };
  } catch (e: any) {
    item.error = e?.message ?? String(e);
    log(job, "error", `[${li + 1}] Gagal: ${item.error}`);
    return null;
  }
}

/** Fase 2 (HTTP murni — tanpa browser): unduh + konversi WebP + tulis berkas. */
async function downloadLink(job: MediaJob, item: MediaItem, list: { u: string; isVideo: boolean }[], dir: string): Promise<void> {
  let idx = 0;
  const worker = async () => {
    while (idx < list.length && !job.cancelled) {
      const i = idx++;
      const it = list[i];
        const r = await downloadMedia(it.u, it.isVideo, variantsFor(job.preset, it.isVideo));
      if (r) {
        let ext = r.ext;
        let data = r.buf;
        if (!it.isVideo && job.webp) {
          const w = await toWebp(data, ext, job.preset);
          if (w) {
            item.savedBytes += data.length - w.buf.length;
            item.webpBytes += w.buf.length;
            item.webp++;
            data = w.buf;
            ext = w.ext;
          }
        }
        const fname = `${String(i + 1).padStart(3, "0")}${it.isVideo ? "-video" : ""}.${ext}`;
        try {
          await Bun.write(path.join(dir, fname), data);
          item.downloaded++;
        } catch {
          item.failed++;
        }
      } else item.failed++;
    }
  };
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, () => worker()));

  if (job.cancelled) return;
  const webpInfo = item.webp > 0
    ? ` · ${item.webp} WebP @ rata-rata ${Math.round(item.webpBytes / item.webp / 1024)} KB (hemat ${(item.savedBytes / 1024 / 1024).toFixed(1)} MB)`
    : "";
  log(job, item.failed > 0 ? "warn" : "success", `[${job.items.indexOf(item) + 1}] ${item.name}: ${item.downloaded} berhasil${item.failed ? `, ${item.failed} gagal` : ""}${webpInfo}.`);
}

async function runMediaJob(job: MediaJob) {
  mediaState.runningId = job.id;
  job.status = "running";
  job.startedAt = Date.now();
  const jobDir = path.join(MEDIA_DIR, job.id);
  mkdirSync(jobDir, { recursive: true });
  try {
    const bm = mediaState.getBm?.();
    if (!bm) throw new Error("Browser tidak tersedia");
    log(job, "info", `Mulai memproses ${job.links.length} link…`);

    // item dibuat urut sejak awal — UI selalu menampilkan urutan link input
    for (let li = 0; li < job.links.length; li++) {
      job.items.push({ url: job.links[li], name: "", slug: "", photos: 0, videos: 0, downloaded: 0, failed: 0, webp: 0, webpBytes: 0, savedBytes: 0, error: null });
    }
    // PIPELINE: panen link berikutnya di browser SELAGI unduhan+WebP link sebelumnya
    // berjalan via HTTP murni. Satu galeri aktif pada satu waktu (kelengkapan
    // terjamin — 2 galeri bersaing membuat Google membatasi muatan per sesi).
    const pending: Promise<void>[] = [];
    for (let li = 0; li < job.links.length && !job.cancelled; li++) {
      const item = job.items[li];
      const d = await discoverLink(job, bm, jobDir, li, item);
      if (d && !job.cancelled) pending.push(downloadLink(job, item, d.list, d.dir).catch(() => {}));
    }
    await Promise.all(pending);

    job.status = job.cancelled ? "cancelled" : "completed";
    // kemas arsip (termasuk hasil parsial saat dibatalkan — tetap berguna)
    const fileCount = walkFiles(jobDir).length;
    if (fileCount > 0) {
      log(job, "info", `Mengemas ${fileCount} berkas ke arsip ZIP…`);
      const zipPath = path.join(MEDIA_DIR, `${job.id}.zip`);
      job.zipBytes = await buildZip(jobDir, zipPath);
      job.zipName = `${job.id}.zip`;
      log(job, "success", `Arsip siap (${(job.zipBytes / 1024 / 1024).toFixed(1)} MB).`);
    } else {
      log(job, "warn", "Tidak ada berkas yang berhasil diunduh — arsip tidak dibuat.");
      job.error = job.error ?? "Tidak ada media yang berhasil diunduh";
    }
  } catch (e: any) {
    job.status = "failed";
    job.error = e?.message ?? String(e);
    log(job, "error", `Job gagal: ${job.error}`);
  } finally {
    job.finishedAt = Date.now();
    if (mediaState.runningId === job.id) mediaState.runningId = null;
  }
}
