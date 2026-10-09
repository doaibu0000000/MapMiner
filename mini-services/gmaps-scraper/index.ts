// MapMiner Scraper Service — mini-service port 3003
// Endpoint: health, jobs CRUD, export XLSX/CSV, stats
//
// PENTING: singleton disimpan di globalThis agar aman terhadap hot-reload
// (bun --hot membuat ulang modul; job yang sedang berjalan tetap utuh).

import { ScrapeEngine } from "./scraper";
import { JobStore } from "./store";
import { buildJobXlsx, buildJobCsv, exportFilename } from "./exporter";
import { waCheckNumbers } from "./wa";
import { waServiceStatus, waServicePair, waServiceUnpair } from "./wa-service";
import { mediaCreate, mediaList, mediaGet, mediaDelete, mediaZip, mediaSetBrowser } from "./media";

/** v10.3: isi waOk utk tempat yang belum dicek (cek berbasis request wa.me — selalu bisa).
 *  persist=true → simpan job ke disk (job asli); false → cek sementara (subset/master). */
async function ensureJobWaChecked(job: ScrapeJob, persist: boolean): Promise<void> {
  const pending = job.places.filter((p) => p.phoneDigits && p.waOk == null);
  if (pending.length === 0) return;
  const m = await waCheckNumbers(pending.map((p) => p.phoneDigits)).catch(() => null);
  if (!m) return;
  for (const p of pending) p.waOk = m.get(p.phoneDigits) ?? null;
  if (persist) store.save(job);
}
import { buildJobHtmlMap } from "./htmlmap";
import type { ScrapeJob, ServiceStats, Place, JobStats } from "./types";

const PORT = 3003;

/** Versi engine — naikkan setiap perubahan kode engine (scraper/parser/exporter).
 *  v13.4.1: /api/suggest diperketat — blocklist lokasi asing ("singapore", "johor",
 *  "lucky plaza", …) & junk non-tempat ("near me", "harga", "resep", "logo", …)
 *  agar saran sinonim sesuai yang dicari.
 *  v13.4.0 (permintaan pengguna): AMBIL SEMUA dulu — fase detail murni pengumpul
 *  data tanpa pembuangan di tengah jalan; penyaringan berjalan SETELAHNYA dalam
 *  satu rangkaian akhir: review minimal → filter telepon → WhatsApp → dedup
 *  nomor ganda (dedupPhoneEntries) → statistik. Dedup cid antar kata kunci tetap
 *  O(1) saat serapan (Set) — duplikat lintas kata kunci tetap tidak diambil ganda.
 *  v13.3.0: pipeline INLINE penuh — selama fase detail, tiap tempat langsung
 *  dipilah seketika: review minimal (null = 0) → filter telepon (tanpa nomor /
 *  darat dibuang) → dedup nomor → verifikasi WhatsApp paralel (tidak terdaftar
 *  dibuang seketika). Jumlah tempat di UI turun live; fase akhir tinggal
 *  statistik (fast-path WA + filter akhir jadi jaring pengaman no-op).
 *  v13.2.0: dedup INLINE — cid dicek via Set O(1) saat serapan hasil; nomor telepon
 *  ganda digabung+ dibuang seketika saat fase detail (absorbDuplicate); finalize()
 *  tinggal statistik (tidak ada lagi pemilahan duplikat di akhir job).
 *  v13.1.0: p-limit terpusat (google-guard, GOOGLE_CONCURRENCY=24) + backoff
 *  adaptif anti-blokir; paginasi pencarian per gelombang paralel; detail
 *  16 pekerja × 1-2 probe ringan; cache debounced-atomic (bukan tulis per tempat).
 *  Ditampilkan di /health & /api/stats agar UI bisa mendeteksi engine lama. */
const ENGINE_VERSION = "13.4.2";

type JobOpts = { skipSearch?: boolean; emailScan?: boolean; socialScan?: boolean };

interface ServiceState {
  store: JobStore;
  engine: ScrapeEngine;
  startedAt: number;
  queue: { job: ScrapeJob; opts?: JobOpts }[];
  runningJob: ScrapeJob | null;
  saverInterval: ReturnType<typeof setInterval> | null;
}

const g = globalThis as any;
const state: ServiceState =
  g.__GMAPS_SCRAPER_STATE__ ??
  (g.__GMAPS_SCRAPER_STATE__ = {
    store: new JobStore(),
    engine: new ScrapeEngine(),
    startedAt: Date.now(),
    queue: [] as { job: ScrapeJob; opts?: JobOpts }[],
    runningJob: null as ScrapeJob | null,
    saverInterval: null as ReturnType<typeof setInterval> | null,
  });

const { store, engine } = state;

// engine media memakai browser yang sama dengan scraper (satu instance Chromium)
mediaSetBrowser(() => (engine as any).bm);

// ---- job queue: satu job berjalan pada satu waktu ----
function enqueueJob(job: ScrapeJob, opts?: JobOpts) {
  state.queue.push({ job, opts });
  void pumpQueue();
}

async function pumpQueue() {
  if (state.runningJob) return;
  const next = state.queue.shift();
  if (!next) return;
  state.runningJob = next.job;
  try {
    await engine.runJob(next.job, next.opts);
  } finally {
    // job bisa saja dihapus user saat berjalan — jangan tulis ulang file-nya
    // (resurrect: hilang dari daftar tapi balik setelah service restart)
    if (store.has(next.job.id)) store.save(next.job);
    state.runningJob = null;
    void pumpQueue();
  }
}

// persist berkala saat job berjalan (tiap 3 dtk) — sekali saja lintas reload
if (!state.saverInterval) {
  state.saverInterval = setInterval(() => {
    if (state.runningJob && store.has(state.runningJob.id)) state.store.save(state.runningJob);
  }, 3000);
}

// ---- helpers ----
const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });

function jobSummary(job: ScrapeJob) {
  return {
    id: job.id,
    keyword: job.keyword,
    city: job.city,
    keywords: job.keywords ?? undefined,
    deepMode: job.deepMode,
    minReviews: job.minReviews ?? null,
    requireWa: job.requireWa ?? false,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    progress: job.progress,
    stats: { ...job.stats, total: job.stats.total || job.places.length },
    resolvedArea: job.resolvedArea,
    placesCount: job.places.length,
    error: job.error,
  };
}

function jobFull(job: ScrapeJob) {
  return { ...jobSummary(job), logs: job.logs.slice(-120), variants: job.variants, places: job.places };
}

const newId = () =>
  `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Parse string kata kunci (boleh dipisah koma/titik-koma) → daftar kata kunci batch.
 *  v11.2: tanpa batas jumlah — sebanyak apa pun kata kuncinya dijalankan semua
 *  (durasi job & deadline fase sudah diskalakan mengikuti jumlah kata kunci). */
function parseKeywords(raw: string): string[] {
  return [...new Set(
    raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 80))
  )];
}

/** Hitung ulang statistik dari daftar tempat */
function computeStats(places: Place[]): JobStats {
  const ratings = places.filter((p) => p.rating != null).map((p) => p.rating!);
  return {
    total: places.length,
    withPhone: places.filter((p) => p.phoneDigits).length,
    withWebsite: places.filter((p) => p.website).length,
    withEmail: places.filter((p) => p.email).length,
    withSocial: places.filter((p) => p.instagram || p.facebook || p.tiktok).length,
    withRating: places.filter((p) => p.rating != null).length,
    avgRating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null,
    withHours: places.filter((p) => p.hours.length > 0).length,
    quadrants: 0,
    variantsRun: 0,
  };
}

/** Pilih versi place terbaik saat merge (prospek > detail ok > kelengkapan data) */
function betterPlace(a: Place, b: Place): Place {
  const q = (p: Place) =>
    (p.leadStatus && p.leadStatus !== "baru" ? 4 : 0) +
    (p.detailStatus === "ok" ? 2 : 0) +
    (p.phone ? 1 : 0) +
    (p.website ? 1 : 0) +
    (p.email ? 1 : 0) +
    (p.instagram || p.facebook || p.tiktok ? 1 : 0);
  const qa = q(a);
  const qb = q(b);
  if (qa !== qb) return qa > qb ? a : b;
  return (b.leadUpdatedAt ?? 0) >= (a.leadUpdatedAt ?? 0) ? b : a;
}

/** Bangun "Basis Data Master": gabungan seluruh job selesai, dedup by cid.
 *  Job sintetis berguna agar seluruh pipeline export (xlsx/csv/json/html) bisa dipakai ulang.
 *  from/to (epoch ms, opsional): batasi ke job yang DIBUAT dalam rentang tanggal tsb —
 *  utk export/analisis "data bulan ini" dsb.
 *  city (opsional, v10): batasi ke tempat di kota/kabupaten tsb (cocokkan normalisasi prefiks). */
function buildMaster(from?: number | null, to?: number | null, city?: string | null): { job: ScrapeJob; sources: number; dupRemoved: number; phoneDupRemoved: number; lastUpdate: number | null } {
  const completed = store.list().filter((j) => j.status === "completed" && j.places.length > 0
    && (from == null || j.createdAt >= from)
    && (to == null || j.createdAt <= to));
  const cityKey = city ? normalizeCityKey(city) : null;
  const byCid = new Map<string, Place>();
  for (const src of completed) {
    for (const p of src.places) {
      if (cityKey && normalizeCityKey(p.kabupaten || p.kecamatan || "") !== cityKey) continue;
      const cur = byCid.get(p.cid);
      byCid.set(p.cid, cur ? betterPlace(cur, p) : p);
    }
  }
  // dedup nomor telepon lintas job: listing ganda usaha yang sama (cid beda, nomor sama)
  // tidak boleh muncul dua kali di basis data master — simpan satu versi terbaik per nomor.
  const byPhone = new Map<string, Place>();
  let phoneDupRemoved = 0;
  const places: Place[] = [];
  for (const p of byCid.values()) {
    if (!p.phoneDigits) { places.push(p); continue; }
    const cur = byPhone.get(p.phoneDigits);
    if (!cur) { byPhone.set(p.phoneDigits, p); places.push(p); continue; }
    phoneDupRemoved++;
    const better = betterPlace(cur, p);
    if (better !== cur) {
      byPhone.set(p.phoneDigits, better);
      const idx = places.indexOf(cur);
      if (idx >= 0) places[idx] = better;
    }
  }
  const totalRaw = completed.reduce((a, j) => a + j.places.length, 0);
  const lastUpdate = completed.reduce<number | null>((m, j) => (j.finishedAt && (!m || j.finishedAt > m) ? j.finishedAt : m), null);
  const now = Date.now();
  const job: ScrapeJob = {
    id: "master",
    keyword: "Basis Data Master",
    city: city ?? "Semua Kota",
    deepMode: true,
    status: "completed",
    createdAt: lastUpdate ?? now,
    startedAt: null,
    finishedAt: null,
    error: null,
    progress: { phase: "Selesai (gabungan)", percent: 100, searchDone: 0, searchTotal: 0, detailsDone: places.length, detailsTotal: places.length },
    variants: [],
    logs: [],
    places,
    stats: { ...computeStats(places), variantsRun: 0 },
    resolvedArea: city ?? null,
  };
  return { job, sources: completed.length, dupRemoved: totalRaw - places.length, phoneDupRemoved, lastUpdate };
}

/** Normalisasi nama area utk agregasi kota: buang prefiks administrasi agar
 *  "Kabupaten Subang" / "Kec. Subang" / "Subang" terhitung sebagai satu kota yang sama.
 *  Label ditampilkan dari varian asli yang paling sering muncul. */
function normalizeCityKey(name: string): string {
  return name
    .replace(/^(kabupaten|kota administrasi|kecamatan|kota|kec|kab)\s*[\.\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Respons ringkas /api/master (tanpa places — cukup agregat utk UI) */
function masterSummary(from?: number | null, to?: number | null, city?: string | null) {
  const { job, sources, dupRemoved, phoneDupRemoved, lastUpdate } = buildMaster(from, to, city);
  const places = job.places;
  const byCity = new Map<string, { count: number; label: string }>();
  for (const p of places) {
    const raw = p.kabupaten || p.kecamatan || "(tanpa area)";
    const key = normalizeCityKey(raw);
    const cur = byCity.get(key);
    if (cur) cur.count++;
    else byCity.set(key, { count: 1, label: raw });
  }
  const byCategory = new Map<string, number>();
  for (const p of places) {
    const k = p.categories[0] || "(tanpa kategori)";
    byCategory.set(k, (byCategory.get(k) ?? 0) + 1);
  }
  const leadCounts: Record<string, number> = { baru: 0, dihubungi: 0, prospek: 0, deal: 0, "tidak-tertarik": 0 };
  for (const p of places) leadCounts[p.leadStatus ?? "baru"] = (leadCounts[p.leadStatus ?? "baru"] ?? 0) + 1;
  return {
    totalUnique: places.length,
    dupRemoved,
    phoneDupRemoved,
    sources,
    lastUpdate,
    stats: job.stats,
    leadCounts,
    byCity: [...byCity.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12).map(([name, v]) => ({ name: v.label, count: v.count })),
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
  };
}

// ---- routing ----
/** Parse from/to (YYYY-MM-DD) dari query string → epoch ms.
 *  from = awal hari (00:00), to = akhir hari (23:59:59.999) — waktu lokal mesin (Asia/Jakarta). */
function parseDateRange(url: URL): { from: number | null; to: number | null } {
  const read = (k: string): number | null => {
    const v = url.searchParams.get(k);
    if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v + "T00:00:00");
    if (isNaN(d.getTime())) return null;
    return d.getTime();
  };
  const from = read("from");
  let to = read("to");
  if (to != null) to += 24 * 60 * 60 * 1000 - 1; // s/d akhir hari
  return { from, to };
}

/** v10: baca filter kota dari query string (maks 80 karakter, tanpa karakter kontrol). */
function parseCityFilter(url: URL): string | null {
  const v = url.searchParams.get("city");
  if (!v) return null;
  const clean = v.slice(0, 80).replace(/[\u0000-\u001f<>"']/g, "").trim();
  return clean || null;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });

    // ---- health ----
    if (path === "/health") {
      return json({ ok: true, service: "gmaps-scraper", version: ENGINE_VERSION, uptime: Date.now() - state.startedAt, running: !!state.runningJob, queued: state.queue.length });
    }

    // ---- saran kata kunci dari Google Suggest (apa yang benar-benar dicari orang) ----    // GET /api/suggest?q=sekolah+smp&city=Subang → { ok, suggestions, source:"google-suggest" }
    if (path === "/api/suggest" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
      const city = (url.searchParams.get("city") ?? "").trim().slice(0, 60);
      if (q.length < 2) return json({ ok: false, error: "parameter q wajib (≥2 huruf)" }, 400);

      const queries = city && !q.toLowerCase().includes(city.toLowerCase()) ? [q, `${q} ${city}`] : [q];
      const results = await Promise.allSettled(
        queries.map((query) =>
          fetch(
            `https://suggestqueries.google.com/complete/search?client=firefox&hl=id&q=${encodeURIComponent(query)}`,
            { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
          ).then((r) => r.json())
        )
      );

      const cityLow = city.toLowerCase();
      // kota bisa memuat karakter khusus regex (cth. "cirebon(") — di-escape agar
      // new RegExp tidak melempar SyntaxError yang meruntuhkan endpoint ini
      const cityRe = cityLow
        ? new RegExp(cityLow.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig")
        : null;
      // saran hanya relevan bila SEMUA kata pencarian (≥3 huruf) ada sebagai kata utuh —
      // menyaring noise autocomplete Google ("sma" → "smallpdf/smartwatch")
      const qWords = q.toLowerCase().split(" ").filter((w) => w.length >= 3);
      const allWordsHit = (low: string) => {
        if (qWords.length === 0) return true;
        const words = new Set(low.split(" "));
        return qWords.every((w) => words.has(w));
      };
      // saran yang tak berguna utk scraping tempat: pertanyaan/logo/penjelasan/produk,
      // atau yang menunjuk lokasi lain — kota besar Indonesia (METROS) & luar negeri
      // (ASING: "laundry singapore", "bakso johor bahru", "bakso lucky plaza", dst).
      // v13.4.2: pencocokan KATA-UTUH (bukan substring) — "bag" memblokir "laundry bag"
      // tanpa mengenai "bagus"; "malang" tidak mengenai "pemalang".
      const JUNK = [
        "dari lokasi saya", "bahasa", "artinya", "arti", "adalah", "apa itu", "kenapa", "mengapa", "cara", "tutorial",
        "logo", "png", "vektor", "vector", "kartun", "gambar", "foto", "wallpaper", "ucapan", "prediksi", "contoh",
        "lirik", "chord", "wikipedia", "tiktok", "instagram", "facebook", "lowongan", "rekrutmen", "gaji",
        "near me", "harga", "jadwal", "resep", "kata kata", "puisi", "pantun", "lucu", "bio",
        "terbaik di dunia", "paling bagus",
        // produk non-tempat yang kerap muncul di autocomplete ("laundry bag", "deterjen laundry") — kata utuh
        "bag", "detergen", "detergent", "deterjen", "hamper", "basket", "simbol", "symbol", "parfum", "pewangi", "sabun", "cairan",
      ];
      const ASING = [
        "singapore", "singapura", "johor", "malaysia", "kuala lumpur", "penang", "batam", "brunei", "bangkok",
        "dubai", "hongkong", "hong kong", "manila", "lucky plaza", "outram", "sembawang", "jurong", "bedok",
        "tampines", "woodlands", "yishun", "chinatown", "little india", "orchard road",
      ];
      const METROS = ["jakarta", "surabaya", "bandung", "medan", "semarang", "makassar", "palembang", "tangerang", "depok", "bogor", "bekasi", "malang", "yogyakarta", "jogja", "surakarta", "cirebon", "cimahi", "karawang", "purwakarta", "denpasar", "balikpapan", "manado", "jawa barat", "jawa tengah", "jawa timur", "banten", "sumatera", "kalimantan", "sulawesi", "kabupaten", "kecamatan"];
      // saran dinormalkan lalu di-pad spasi → frasa/kata dicocokkan sebagai KATA UTUH
      const normWords = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim()} `;
      const wordHitList = (padded: string, list: string[]) => list.some((p) => padded.includes(` ${p} `));
      const out: string[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const list = Array.isArray(r.value?.[1]) ? r.value[1] : [];
        for (const item of list) {
          if (typeof item !== "string") continue;
          let s = item.trim().slice(0, 60);
          // buang saran berisi angka (alamat/nomor) & sebutan kota (engine menambahkan kota otomatis)
          if (/\d/.test(s)) continue;
          if (cityRe && s.toLowerCase().includes(cityLow)) s = s.replace(cityRe, "").replace(/\s{2,}/g, " ").trim();
          const low = s.toLowerCase();
          const padded = normWords(s);
          if (s.length < 3) continue;
          if (low === q.toLowerCase()) continue;
          if (wordHitList(padded, JUNK)) continue;
          if (wordHitList(padded, ASING)) continue;
          if (wordHitList(padded, METROS.filter((m) => m !== cityLow))) continue;
          if (!allWordsHit(low)) continue;
          s = s.replace(/\s+(di|dari|dan|untuk|ke|yang)$/i, "").trim();
          if (s.length < 3) continue;
          if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
        }
      }
      return json({ ok: true, suggestions: out.slice(0, 12), source: "google-suggest" });
    }

    // ---- stats layanan ----
    if (path === "/api/stats" && method === "GET") {
      const jobs = store.list();
      const stats: ServiceStats = {
        jobsTotal: jobs.length,
        jobsCompleted: jobs.filter((j) => j.status === "completed").length,
        placesScraped: jobs.reduce((a, j) => a + j.places.length, 0),
        browserPages: (engine as any)?.bm?.pagesCreated ?? 0,
        uptime: Date.now() - state.startedAt,
        version: ENGINE_VERSION,
      };
      return json({ ok: true, stats, running: state.runningJob ? jobSummary(state.runningJob) : null, queued: state.queue.length });
    }

    // ---- WhatsApp: status sesi protokol resmi (layanan wa-checker) + pairing + putuskan ----
    if (path === "/api/wa/status" && method === "GET") {
      const s = await waServiceStatus();
      if (!s) return json({ ok: false, error: "Layanan WhatsApp tidak merespons" }, 502);
      return json({ ok: true, wa: { ...s } });
    }
    if (path === "/api/wa/pair" && method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      try {
        const code = await waServicePair(String(body?.phone ?? ""));
        return json({ ok: true, code });
      } catch (e: any) {
        return json({ ok: false, error: e?.message ?? String(e) }, 500);
      }
    }
    if (path === "/api/wa/unpair" && method === "POST") {
      await waServiceUnpair();
      return json({ ok: true });
    }

    // ---- unduh media tempat (tab Unduh Media): panen foto/video dari link Maps → arsip ZIP ----
    if (path === "/api/media" && method === "GET") {
      return json({ ok: true, jobs: mediaList() });
    }
    if (path === "/api/media" && method === "POST") {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: "Body JSON tidak valid" }, 400); }
      const links: string[] = Array.isArray(body?.links) ? body.links.map((x: any) => String(x)) : [];
      const r = mediaCreate(links, { webp: body?.webp !== false, preset: body?.preset });
      if (!r.ok) return json({ ok: false, error: r.error }, r.status);
      return json({ ok: true, job: r.job }, 201);
    }
    const mediaMatch = path.match(/^\/api\/media\/([^/]+)$/);
    if (mediaMatch) {
      const id = mediaMatch[1];
      if (method === "GET") {
        const job = mediaGet(id);
        return job ? json({ ok: true, job }) : json({ ok: false, error: "Job media tidak ditemukan" }, 404);
      }
      if (method === "DELETE") {
        return mediaDelete(id) ? json({ ok: true }) : json({ ok: false, error: "Job media tidak ditemukan" }, 404);
      }
    }
    const mediaZipMatch = path.match(/^\/api\/media\/([^/]+)\/zip$/);
    if (mediaZipMatch && method === "GET") {
      const f = mediaZip(mediaZipMatch[1]);
      if (!f) return json({ ok: false, error: "Arsip belum tersedia (job belum selesai / sudah dihapus)" }, 404);
      const cd = `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`;
      return new Response(Bun.file(f.path), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": cd,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ---- daftar & buat job ----
    if (path === "/api/jobs") {
      if (method === "GET") {
        return json({ ok: true, jobs: store.list().map(jobSummary), running: state.runningJob ? jobSummary(state.runningJob) : null, queued: state.queue.length });
      }
      if (method === "POST") {
        let body: any;
        try {
          body = await req.json();
        } catch {
          return json({ ok: false, error: "Body JSON tidak valid" }, 400);
        }
        const keyword = String(body.keyword ?? "").trim();
        const city = String(body.city ?? "").trim();
        const deepMode = Boolean(body.deepMode ?? true);
        // filter review minimal (default 10): tempat ber-ulasan di bawah nilai ini tidak diambil
        const minReviewsRaw = Number(body.minReviews ?? 10);
        const minReviews = Number.isFinite(minReviewsRaw) ? Math.max(0, Math.min(100000, Math.floor(minReviewsRaw))) : 10;
        // wajib WhatsApp (default aktif): hanya simpan tempat dengan nomor WhatsApp terverifikasi aktif
        const requireWa = body.requireWa === undefined ? true : Boolean(body.requireWa);
        if (!keyword || !city) {
          return json({ ok: false, error: "Kata kunci dan kota wajib diisi" }, 400);
        }
        // batch: kata kunci dipisah koma → dicari bergantian dalam satu job
        const keywords = parseKeywords(keyword);
        if (keywords.length === 0) {
          return json({ ok: false, error: "Kata kunci tidak valid" }, 400);
        }
        if (state.queue.length >= 5) {
          return json({ ok: false, error: "Antrian penuh (maks 5). Tunggu job selesai." }, 429);
        }
        const job: ScrapeJob = {
          id: newId(),
          keyword: keywords.length > 1 ? keywords.join(", ") : keywords[0],
          city,
          keywords: keywords.length > 1 ? keywords : undefined,
          deepMode,
          minReviews,
          requireWa,
          status: "queued",
          createdAt: Date.now(),
          startedAt: null,
          finishedAt: null,
          error: null,
          progress: { phase: "Dalam antrian…", percent: 0, searchDone: 0, searchTotal: 0, detailsDone: 0, detailsTotal: 0 },
          variants: [],
          logs: [],
          places: [],
          stats: { total: 0, withPhone: 0, withWebsite: 0, withEmail: 0, withSocial: 0, withRating: 0, avgRating: null, withHours: 0, quadrants: 0, variantsRun: 0 },
          resolvedArea: null,
        };
        store.create(job);
        enqueueJob(job);
        return json({ ok: true, job: jobSummary(job) }, 201);
      }
    }

    // ---- basis data master: agregat seluruh job selesai ----
    // from/to (YYYY-MM-DD, opsional): batasi ke job yang dibuat dalam rentang tanggal
    // city (opsional, v10): batasi ke tempat di kota/kabupaten terpilih
    if (path === "/api/master" && method === "GET") {
      const range = parseDateRange(url);
      const city = parseCityFilter(url);
      return json({ ok: true, master: masterSummary(range.from, range.to, city) });
    }

    // ---- export basis data master ----
    if (path === "/api/master/export" && method === "GET") {
      const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
      const range = parseDateRange(url);
      const city = parseCityFilter(url);
      const { job } = buildMaster(range.from, range.to, city);
      if (job.places.length === 0) return json({ ok: false, error: "Belum ada job selesai untuk digabung" }, 400);
      await ensureJobWaChecked(job, false);
      const fileHeaders = (filename: string, type: string) => ({
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Access-Control-Allow-Origin": "*",
      });
      if (format === "html") {
        return new Response(buildJobHtmlMap(job), { headers: fileHeaders(exportFilename(job, "html"), "text/html; charset=utf-8") });
      }
      if (format === "json") {
        return new Response(JSON.stringify({ job: jobSummary(job), places: job.places }, null, 2), { headers: fileHeaders(exportFilename(job, "json"), "application/json; charset=utf-8") });
      }
      if (format === "csv") {
        return new Response(buildJobCsv(job), { headers: fileHeaders(exportFilename(job, "csv"), "text/csv; charset=utf-8") });
      }
      return new Response(buildJobXlsx(job), {
        headers: fileHeaders(exportFilename(job, "xlsx"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      });
    }

    // ---- gabungkan beberapa job jadi satu (dedup by cid) ----
    // PENTING: harus dicek SEBELUM route /api/jobs/:id agar "merge" tidak tertangkap sebagai id
    if (path === "/api/jobs/merge" && method === "POST") {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: "Body JSON tidak valid" }, 400); }
      const ids: string[] = Array.isArray(body.jobIds) ? body.jobIds.map((x: any) => String(x)) : [];
      if (ids.length < 2) return json({ ok: false, error: "Pilih minimal 2 job untuk digabungkan" }, 400);
      if (ids.length > 10) return json({ ok: false, error: "Maksimal 10 job digabung sekaligus" }, 400);
      const uniqueIds = [...new Set(ids)];
      const sources = uniqueIds.map((id) => store.get(id)).filter((j): j is ScrapeJob => !!j);
      if (sources.length !== uniqueIds.length) return json({ ok: false, error: "Ada job yang tidak ditemukan" }, 404);
      if (sources.some((j) => j.status === "running" || j.status === "queued")) {
        return json({ ok: false, error: "Tunggu job yang sedang berjalan selesai dulu" }, 400);
      }
      const totalRaw = sources.reduce((a, j) => a + j.places.length, 0);
      if (totalRaw === 0) return json({ ok: false, error: "Job terpilih belum memiliki data tempat" }, 400);

      // merge places: dedup by cid — pilih versi terbaik (prospek > detail ok > kelengkapan)
      const byCid = new Map<string, Place>();
      for (const src of sources) {
        for (const p of src.places) {
          const cur = byCid.get(p.cid);
          byCid.set(p.cid, cur ? betterPlace(cur, p) : p);
        }
      }
      const places = [...byCid.values()];
      const dupRemoved = totalRaw - places.length;

      // gabung metadata
      const keywordSet = [...new Set(sources.flatMap((j) => j.keywords ?? [j.keyword]))];
      const citySet = [...new Set(sources.map((j) => j.city))];
      const variantKeys = new Set<string>();
      const variants = sources.flatMap((j) =>
        j.variants.filter((v) => {
          const k = `${v.query}@${v.zoomLevel ?? ""}`;
          if (variantKeys.has(k)) return false;
          variantKeys.add(k);
          return true;
        })
      );
      // area dominan
      const areaCounts = new Map<string, number>();
      for (const j of sources) {
        if (j.resolvedArea) areaCounts.set(j.resolvedArea, (areaCounts.get(j.resolvedArea) ?? 0) + j.places.length);
      }
      const resolvedArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      const now = Date.now();
      const merged: ScrapeJob = {
        id: newId(),
        keyword: keywordSet.join(" + "),
        city: citySet.join(" + "),
        keywords: keywordSet.length > 1 ? keywordSet : undefined,
        deepMode: true,
        status: "completed",
        createdAt: now,
        startedAt: now,
        finishedAt: now,
        error: null,
        progress: { phase: "Selesai (gabungan)", percent: 100, searchDone: 0, searchTotal: 0, detailsDone: places.length, detailsTotal: places.length },
        variants,
        logs: [
          { t: now, level: "info", msg: `Job gabungan dari ${sources.length} job: ${sources.map((j) => `"${j.keyword}" (${j.places.length})`).join(", ")}.` },
          ...(dupRemoved > 0
            ? [{ t: now, level: "success" as const, msg: `${totalRaw} tempat digabung → ${places.length} unik (${dupRemoved} duplikat dihapus, status prospek & catatan terpelihara).` }]
            : [{ t: now, level: "success" as const, msg: `${places.length} tempat digabung — tidak ada duplikat.` }]),
        ],
        places,
        stats: { ...computeStats(places), variantsRun: variants.length },
        resolvedArea,
      };
      store.create(merged);
      return json({ ok: true, job: jobSummary(merged) }, 201);
    }

    // ---- periksa ulang nomor WhatsApp sebuah job selesai (tanpa scraping ulang) ----
    // PENTING: jawab SEGERA dan jalankan di latar belakang — pekerjaan browser yang
    // menggantung di dalam handler HTTP terbukti membuat koneksi mati.
    const wacheckMatch = path.match(/^\/api\/jobs\/([^/]+)\/wacheck$/);
    if (wacheckMatch && method === "POST") {
      const job = store.get(wacheckMatch[1]);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      if (job.status !== "completed") return json({ ok: false, error: "Job belum selesai — tunggu sampai tuntas" }, 400);
      if (g.__WA_RECHECK_RUNNING__) return json({ ok: false, error: "Periksa ulang lain sedang berjalan — tunggu sebentar" }, 409);
      g.__WA_RECHECK_RUNNING__ = true;
      void engine.recheckWa(job)
        .then((r) => {
          store.save(job);
          console.log(`[wacheck ${job.id}] selesai (${r.layer}): ${r.aktif} aktif · ${r.tidakTerdaftar} tidak terdaftar · ${r.takPasti} belum pasti · ${r.dibuang} dibuang`);
        })
        .catch((e: any) => console.log(`[wacheck ${job.id}] gagal: ${e?.message ?? e}`))
        .finally(() => { g.__WA_RECHECK_RUNNING__ = false; });
      return json({ ok: true, started: true });
    }

    // ---- detail / hapus job ----
    const jobMatch = path.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const id = jobMatch[1];
      const job = store.get(id);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      if (method === "GET") {
        const full = url.searchParams.get("full") === "1";
        return json({ ok: true, job: full ? jobFull(job) : jobSummary(job) });
      }
      if (method === "DELETE") {
        // batalkan bila sedang berjalan / antri
        const qIdx = state.queue.findIndex((q) => q.job.id === id);
        if (qIdx >= 0) state.queue.splice(qIdx, 1);
        if (job.status === "queued" || job.status === "running") {
          job.status = "cancelled";
          job.finishedAt = Date.now();
          job.progress.phase = "Dibatalkan";
          store.save(job);
        }
        store.delete(id);
        return json({ ok: true });
      }
    }

    // ---- aksi massal: ubah status prospek banyak tempat sekaligus ----
    // PENTING: harus dicek SEBELUM placeMatch agar "bulk" tidak tertangkap sebagai cid
    const bulkMatch = path.match(/^\/api\/jobs\/([^/]+)\/places\/bulk$/);
    if (bulkMatch && method === "PATCH") {
      const job = store.get(bulkMatch[1]);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: "Body JSON tidak valid" }, 400); }
      const cids: string[] = Array.isArray(body.cids) ? body.cids.map((x: any) => String(x)).filter(Boolean).slice(0, 2000) : [];
      const ALLOWED: string[] = ["baru", "dihubungi", "prospek", "deal", "tidak-tertarik"];
      if (cids.length === 0) return json({ ok: false, error: "Daftar tempat kosong" }, 400);
      if (typeof body.leadStatus !== "string" || !ALLOWED.includes(body.leadStatus)) {
        return json({ ok: false, error: "Status prospek tidak valid" }, 400);
      }
      const cidSet = new Set(cids);
      let updated = 0;
      for (const place of job.places) {
        if (cidSet.has(place.cid)) {
          place.leadStatus = body.leadStatus as Place["leadStatus"];
          place.leadUpdatedAt = Date.now();
          updated++;
        }
      }
      if (updated === 0) return json({ ok: false, error: "Tidak ada tempat yang cocok" }, 404);
      store.save(job);
      return json({ ok: true, updated, leadStatus: body.leadStatus });
    }

    // ---- perbarui status prospek / catatan satu tempat (lead management) ----
    const placeMatch = path.match(/^\/api\/jobs\/([^/]+)\/places\/([^/]+)$/);
    if (placeMatch && method === "PATCH") {
      const job = store.get(placeMatch[1]);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      const cid = decodeURIComponent(placeMatch[2]);
      const place = job.places.find((p) => p.cid === cid);
      if (!place) return json({ ok: false, error: "Tempat tidak ditemukan" }, 404);
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: "Body JSON tidak valid" }, 400); }
      const ALLOWED: string[] = ["baru", "dihubungi", "prospek", "deal", "tidak-tertarik"];
      let changed = false;
      if (typeof body.leadStatus === "string" && ALLOWED.includes(body.leadStatus)) {
        place.leadStatus = body.leadStatus;
        changed = true;
      }
      if (typeof body.leadNote === "string") {
        place.leadNote = body.leadNote.slice(0, 500);
        changed = true;
      }
      if (changed) {
        place.leadUpdatedAt = Date.now();
        store.save(job);
        return json({ ok: true, place: { cid: place.cid, leadStatus: place.leadStatus, leadNote: place.leadNote, leadUpdatedAt: place.leadUpdatedAt } });
      }
      return json({ ok: false, error: "Tidak ada perubahan valid" }, 400);
    }

    // ---- cari email kontak dari website (job selesai) ----
    const emailMatch = path.match(/^\/api\/jobs\/([^/]+)\/emails$/);
    if (emailMatch && method === "POST") {
      const id = emailMatch[1];
      const job = store.get(id);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      if (job.status === "running" || job.status === "queued") {
        return json({ ok: false, error: "Job sedang berjalan" }, 400);
      }
      const scanTargets = job.places.filter((p) => p.website && !p.email && (p.emailStatus === "none" || p.emailStatus === "pending"));
      if (scanTargets.length === 0) {
        return json({ ok: false, error: "Tidak ada website baru untuk dipindai (semua sudah dipindai / tanpa website)" }, 400);
      }
      if (state.queue.length >= 5) return json({ ok: false, error: "Antrian penuh" }, 429);
      job.status = "running";
      job.error = null;
      job.finishedAt = null;
      job.startedAt = Date.now();
      job.progress = { phase: "Mencari email dari website…", percent: 45, searchDone: 0, searchTotal: 0, detailsDone: 0, detailsTotal: scanTargets.length };
      job.logs.push({ t: Date.now(), level: "info", msg: `Mencari email dari ${scanTargets.length} website…` });
      store.save(job);
      enqueueJob(job, { emailScan: true });
      return json({ ok: true, job: jobSummary(job) });
    }

    // ---- cari link sosmed (IG/FB/TikTok) dari website (job selesai) ----
    const socialMatch = path.match(/^\/api\/jobs\/([^/]+)\/socials$/);
    if (socialMatch && method === "POST") {
      const id = socialMatch[1];
      const job = store.get(id);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      if (job.status === "running" || job.status === "queued") {
        return json({ ok: false, error: "Job sedang berjalan" }, 400);
      }
      const scanTargets = job.places.filter(
        (p) => p.website && p.socialStatus !== "found" && (!p.socialStatus || p.socialStatus === "none" || p.socialStatus === "pending")
      );
      if (scanTargets.length === 0) {
        return json({ ok: false, error: "Tidak ada website baru untuk dipindai sosmed (semua sudah dipindai / tanpa website)" }, 400);
      }
      if (state.queue.length >= 5) return json({ ok: false, error: "Antrian penuh" }, 429);
      job.status = "running";
      job.error = null;
      job.finishedAt = null;
      job.startedAt = Date.now();
      job.progress = { phase: "Mencari sosmed dari website…", percent: 45, searchDone: 0, searchTotal: 0, detailsDone: 0, detailsTotal: scanTargets.length };
      job.logs.push({ t: Date.now(), level: "info", msg: `Mencari sosmed (IG/FB/TikTok) dari ${scanTargets.length} website…` });
      store.save(job);
      enqueueJob(job, { socialScan: true });
      return json({ ok: true, job: jobSummary(job) });
    }

    // ---- perbarui detail job selesai (enrich ulang) ----
    const enrichMatch = path.match(/^\/api\/jobs\/([^/]+)\/enrich$/);
    if (enrichMatch && method === "POST") {
      const id = enrichMatch[1];
      const job = store.get(id);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      if (job.status === "running" || job.status === "queued") {
        return json({ ok: false, error: "Job sedang berjalan" }, 400);
      }
      if (state.queue.length >= 5) return json({ ok: false, error: "Antrian penuh" }, 429);
      // reset detail + status running lagi (hanya fase detail)
      for (const place of job.places) place.detailStatus = "pending";
      job.status = "running";
      job.error = null;
      job.finishedAt = null;
      job.startedAt = Date.now();
      job.progress = { phase: "Memperbarui detail tempat…", percent: 45, searchDone: 0, searchTotal: 0, detailsDone: 0, detailsTotal: job.places.length };
      job.logs.push({ t: Date.now(), level: "info", msg: "Memperbarui detail semua tempat…" });
      store.save(job);
      enqueueJob(job, { skipSearch: true });
      return json({ ok: true, job: jobSummary(job) });
    }

    // ---- export job ----
    const exportMatch = path.match(/^\/api\/jobs\/([^/]+)\/export$/);
    if (exportMatch && method === "GET") {
      const id = exportMatch[1];
      const job = store.get(id);
      if (!job) return json({ ok: false, error: "Job tidak ditemukan" }, 404);
      const format = (url.searchParams.get("format") ?? "xlsx").toLowerCase();
      if (job.places.length === 0) return json({ ok: false, error: "Belum ada data untuk diekspor" }, 400);
      // v10.3: pastikan verifikasi WhatsApp terisi sebelum ekspor (bila sesi terhubung)
      await ensureJobWaChecked(job, true);
      // filter tempat terpilih (cids dipisah koma) — subset presisi utk aksi penjualan
      const cidsParam = url.searchParams.get("cids");
      let exportJob = job;
      if (cidsParam) {
        const cidSet = new Set(cidsParam.split(",").map((s) => s.trim()).filter(Boolean));
        const places = job.places.filter((p) => cidSet.has(p.cid));
        if (places.length === 0) return json({ ok: false, error: "Tidak ada tempat terpilih untuk diekspor" }, 400);
        exportJob = { ...job, places, stats: { ...computeStats(places), quadrants: job.stats.quadrants, variantsRun: job.stats.variantsRun } };
        await ensureJobWaChecked(exportJob, false);
      }
      const isSubset = exportJob !== job;
      if (format === "html") {
        const html = buildJobHtmlMap(exportJob);
        const filename = exportFilename(exportJob, "html", isSubset);
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (format === "json") {
        const payload = {
          job: jobSummary(exportJob),
          places: exportJob.places,
        };
        const filename = exportFilename(exportJob, "json", isSubset);
        return new Response(JSON.stringify(payload, null, 2), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      if (format === "csv") {
        const csv = buildJobCsv(exportJob);
        const filename = exportFilename(exportJob, "csv", isSubset);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
      const xlsx = buildJobXlsx(exportJob);
      const filename = exportFilename(exportJob, "xlsx", isSubset);
      return new Response(xlsx, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return json({ ok: false, error: "Endpoint tidak ditemukan" }, 404);
  },
});

console.log(`✅ gmaps-scraper service berjalan di http://localhost:${PORT}`);

process.on("SIGINT", async () => {
  await engine.shutdown();
  process.exit(0);
});
