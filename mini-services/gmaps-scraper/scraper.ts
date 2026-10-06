// Engine scraping Google Maps:
// 1) Load halaman search Google Maps (JS Google melakukan paginasi sendiri saat scroll)
// 2) Intercept respons RPC tbm=map → parse semua place
// 3) Quadrant-split otomatis jika hasil mendekati batas ~120/query
// 4) Ambil detail tiap place (telepon, website, jam buka) via navigasi place_id
// 5) Gabungkan + dedupe berdasar cid

import type { ScrapeJob, Place, JobLog } from "./types";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BrowserManager } from "./browser";
import { extractPlacesFromListBody, parsePlaceDetail } from "./parser";
import { findEmailsForWebsite, findSocialsForWebsite, scanEmails, isSocialLink, hasSocial, socialFromUrl, type SocialLinks } from "./email";
import { waCheckNumbers, waDeepCheckNumbers, toWaDigits, waCacheStoreVerdicts } from "./wa";
import { mapsSearchKey, mapsSearchGet, mapsSearchPut, mapsDetailGet, mapsDetailPut } from "./maps-cache";
import { waServiceConnected, waServiceCheck } from "./wa-service";
import { fetchDetailFast } from "./fast-detail";

const MAX_SCROLL_ROUNDS = 45;
const END_MARKERS = ["akhir daftar", "end of the list", "anda telah melihat semua"];
const CAP_THRESHOLD = 110;      // >= hasil ini → quadrant split
const MAX_PLACES = 3000;        // pengaman absolut
const MAX_QUADRANT_DEPTH = 2;   // zoom+2 maksimum
// v11.6: detail kini diambil via HTTP langsung (tanpa tab browser) — 8 pekerja
// paralel aman karena tiap permintaan cuma satu GET ringan, bukan render halaman.
const DETAIL_CONCURRENCY = 8;   // jumlah pekerja paralel saat ambil detail
const EMAIL_CONCURRENCY = 10;   // fetch website paralel saat cari email (fetch ringan, bukan browser)

// ---- pengaman anti-hang (v10): job tidak boleh menggantung selamanya ----
const EVAL_TIMEOUT = 60_000;             // page.evaluate maks 60 dtk — page mati → fallback, bukan hang
const SEARCH_PHASE_MAX_MS = 15 * 60_000; // fase pencarian (semua kata kunci + kuadran) maks 15 menit
const DETAIL_ITEM_MAX_MS = 150_000;      // pengaman per tempat saat ambil detail
const JOB_MAX_MS = 45 * 60_000;          // durasi total job maks 45 menit → selesai parsial, bukan menggantung

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

export class ScrapeEngine {
  private bm = new BrowserManager();

  /** Cek apakah suatu job masih boleh berjalan */
  private alive(job: ScrapeJob): boolean {
    return job.status === "running";
  }

  private log(job: ScrapeJob, level: JobLog["level"], msg: string) {
    job.logs.push({ t: Date.now(), level, msg });
    if (job.logs.length > 500) job.logs.splice(0, job.logs.length - 500);
    console.log(`[${job.id}] ${level}: ${msg}`);
  }

  /** v10: page.evaluate dengan pengaman timeout — bila page basi/mati (browser crash,
   *  zombie page), kembalikan nilai fallback alih-alih menggantung selamanya. */
  private async safeEval<T>(page: any, fn: (arg?: any) => T, fallback: T, arg?: any, timeoutMs = EVAL_TIMEOUT): Promise<T> {
    try {
      return await Promise.race([
        arg !== undefined ? page.evaluate(fn, arg) : page.evaluate(fn),
        new Promise<T>((resolve) => {
          const t = setTimeout(() => resolve(fallback), timeoutMs);
          (t as any)?.unref?.();
        }),
      ]);
    } catch {
      return fallback;
    }
  }

  /** Hitung zoom level dari span viewport (meter) untuk tinggi 900px */
  private spanToZoom(d: number, lat: number): number {
    const metersPerPixel = d / 900;
    const zoom = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / metersPerPixel);
    return Math.min(21, Math.max(3, zoom));
  }

  /** URL search dengan viewport eksplisit */
  private searchUrl(query: string, lat?: number, lng?: number, zoom?: number): string {
    const q = encodeURIComponent(query);
    const at = lat !== undefined && lng !== undefined && zoom !== undefined
      ? `/@${lat},${lng},${zoom.toFixed(1)}z`
      : "";
    return `https://www.google.com/maps/search/${q}${at}?hl=id&gl=id`;
  }

  /**
   * Jalankan satu varian pencarian: buka halaman, scroll sampai habis,
   * intercept semua respons RPC, merge places by cid.
   * Return: { placesBaru, viewport, blocked }
   */
  private async runSearchVariant(
    job: ScrapeJob,
    query: string,
    viewport?: { lat: number; lng: number; zoom: number },
    kwCollector?: Place[],
  ): Promise<{ newPlaces: number; totalInFeed: number; viewport: [number, number, number] | null; blocked: boolean; cached: boolean }> {
    // CACHE: hasil pencarian yang sama (query + viewport) dalam 72 jam dipakai
    // langsung — scroll halaman pencarian dilewati seluruhnya.
    const cacheKey = mapsSearchKey(query, viewport);
    const cachedPlaces = await mapsSearchGet(cacheKey);
    if (cachedPlaces && cachedPlaces.length > 0) {
      const minReviews = job.minReviews ?? 0;
      let added = 0;
      for (const place of cachedPlaces) {
        // v12.6: masuk kolektor kata kunci TANPA filter — bbox kuadran harus
        // deterministik antar run (hasil varian yang sama → pusat kuadran sama →
        // kuadran pun kena cache di run berikutnya)
        kwCollector?.push(place);
        if (minReviews > 0 && place.reviewsCount != null && place.reviewsCount < minReviews) continue;
        if (job.places.some((p) => p.cid === place.cid)) continue;
        job.places.push(place);
        added++;
      }
      this.log(job, "info", `"${query}" → ${cachedPlaces.length} tempat dari cache (baru +${added}) — scroll halaman pencarian dilewati.`);
      return { newPlaces: added, totalInFeed: cachedPlaces.length, viewport: null, blocked: false, cached: true };
    }

    const page = await this.bm.newPage();
    const capturedBodies: string[] = [];
    let lastViewport: [number, number, number] | null = null;

    const onResponse = async (resp: any) => {
      const url = resp.url();
      if (url.includes("tbm=map") && resp.request().method() === "GET") {
        try {
          const body = await resp.text();
          if (body && body.length > 800) capturedBodies.push(body);
        } catch {}
      }
    };
    page.on("response", onResponse);

    const url = this.searchUrl(query, viewport?.lat, viewport?.lng, viewport?.zoom);
    let blocked = false;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await sleep(rnd(1500, 2500));

      // v10.2: halaman persetujuan cookie Google (consent.google.com) — klik otomatis
      // bila cookie SOCS/CONSENT belum cukup; tanpa ini feed hasil tidak akan muncul.
      if (/consent\.google\.com/i.test(page.url())) {
        try {
          const btn = page
            .locator('button:has-text("Terima semua"), button:has-text("Accept all"), button:has-text("Tolak semua"), button:has-text("Reject all"), form[action*="consent"] button')
            .first();
          await btn.click({ timeout: 6000 });
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
          await sleep(rnd(1500, 2500));
          this.log(job, "info", "Halaman persetujuan cookie Google disetujui otomatis.");
        } catch {}
      }

      // tunggu feed hasil muncul
      let feedReady = false;
      for (let i = 0; i < 10; i++) {
        feedReady = await this.safeEval(page, () => !!document.querySelector('div[role="feed"]'), false);
        if (feedReady) break;
        await sleep(700);
      }

      // deteksi halaman blokir / captcha
      const bodyText: string = await this.safeEval(page, () => document.body?.innerText?.slice(0, 3000) ?? "", "");
      if (/unusual traffic|tidak wajar|captcha/i.test(bodyText)) {
        blocked = true;
      }

      if (feedReady && !blocked) {
        // scroll sampai semua hasil termuat
        let prevCount = 0;
        let stableRounds = 0;
        for (let i = 0; i < MAX_SCROLL_ROUNDS; i++) {
          await this.safeEval(page, () => {
            const f = document.querySelector('div[role="feed"]') as HTMLElement | null;
            if (f) f.scrollTop = f.scrollHeight;
          }, undefined);
          await sleep(rnd(550, 850));
          const count: number = await this.safeEval<number>(page, () => {
            const f = document.querySelector('div[role="feed"]');
            return f ? f.querySelectorAll('a[href*="/maps/place/"]').length : 0;
          }, -1);
          // v10: page tidak merespons (timeout) → lanjut dengan hasil yang sudah terkumpul
          if (count < 0) {
            this.log(job, "warn", `Halaman tidak merespons saat scroll (putaran ${i + 1}) — melanjutkan dengan ${job.places.length} hasil yang sudah terintercept.`);
            break;
          }
          // v12.7 SHORT-CIRCUIT VARIAN DUPLIKAT — bila SEMUA kartu di feed sudah
          // ada di kumpulan cid job (hasil varian/keyword lain yang tumpang tindih),
          // scroll lanjutan murni sia-sia: tidak ada tempat baru yang mungkin
          // muncul. Berhenti sekarang = hemat 5-10 dtk per varian duplikat DAN
          // lebih sedikit request ke Google (makin cepat justru makin aman).
          const cardCheck = await this.safeEval<{ total: number; known: number; allKnown: boolean }>(page, (cids: string[]) => {
            const f = document.querySelector('div[role="feed"]');
            if (!f) return { total: 0, known: 0, allKnown: false };
            const set = new Set(cids);
            const cards = f.querySelectorAll('a[href*="/maps/place/"]');
            let total = 0;
            let known = 0;
            for (const a of Array.from(cards)) {
              const m = (a as HTMLAnchorElement).href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
              if (!m) return { total, known, allKnown: false };
              total++;
              if (set.has(m[1])) known++;
            }
            return { total, known, allKnown: total > 0 && known === total };
          }, { total: 0, known: 0, allKnown: false }, job.places.map((p) => p.cid).filter(Boolean) as string[]);
          if (cardCheck.allKnown) {
            this.log(job, "info", `Scroll ${i + 1}: semua ${cardCheck.total} kartu sudah dikenal (varian tumpang tindih) — scroll dihentikan lebih awal.`);
            break;
          }
          const endText: string = await this.safeEval(page, () => document.body?.innerText ?? "", "");
          if (i < 3 || count !== prevCount) {
            this.log(job, "info", `Scroll ${i + 1}: ${count} kartu termuat${endText.toLowerCase().includes("akhir daftar") ? " (akhir)" : ""} [rpc: ${capturedBodies.length}]`);
          }
          if (END_MARKERS.some((m) => endText.toLowerCase().includes(m))) {
            break;
          }
          if (count === prevCount) {
            stableRounds++;
            if (stableRounds >= 4) break;
          } else {
            stableRounds = 0;
          }
          prevCount = count;
          if (!this.alive(job)) break;
        }
      }
    } catch (e: any) {
      this.log(job, "warn", `Gagal memuat halaman pencarian (${query}): ${e?.message ?? e}`);
    }

    // parse semua respons yang terintercept — dedup cid + filter review minimal.
    // PENTING: di sini HANYA buang tempat yang jumlah ulasannya SUDAH PASTI (terbaca
    // dari daftar hasil) di bawah ambang. Tempat yang belum membawa angka ulasan
    // (null — sangat umum dari respons daftar) TIDAK boleh dibuang: angkanya baru
    // lengkap setelah fase detail. Filter final dijalankan applyReviewFilter().
    let newPlaces = 0;
    let skippedReviews = 0;
    const minReviews = job.minReviews ?? 0;
    const collected: Place[] = []; // utk cache hasil varian ini — NETRAL tanpa filter
    const addPlace = (place: Place): boolean => {
      // kloning: cache TIDAK boleh memegang referensi objek hidup — mutasi fase
      // selanjutnya (waOk, detailStatus) akan bocor ke job-job berikutnya.
      // v12.6: cache diisi TANPA filter review (netral) — filter minReviews
      // diterapkan saat membaca cache, jadi run dgn ambang beda tetap data lengkap.
      if (!collected.some((p) => p.cid === place.cid)) collected.push({ ...place });
      // v12.6: masuk kolektor kata kunci TANPA filter dedup global — bbox kuadran
      // harus deterministik antar run agar pusat kuadran sama → kuadran kena cache
      kwCollector?.push(place);
      if (minReviews > 0 && place.reviewsCount != null && place.reviewsCount < minReviews) { skippedReviews++; return false; }
      if (job.places.some((p) => p.cid === place.cid)) return false;
      job.places.push(place);
      newPlaces++;
      return true;
    };
    for (const body of capturedBodies) {
      try {
        const { places, viewport } = extractPlacesFromListBody(body, query);
        if (viewport) lastViewport = viewport;
        for (const place of places) {
          addPlace(place);
          if (job.places.length >= MAX_PLACES) break;
        }
      } catch {}
      if (job.places.length >= MAX_PLACES) break;
    }

    // FALLBACK DOM: kartu yang mungkin terlewat dari capture RPC
    try {
      const domPlaces = await this.extractPlacesFromDom(page, query);
      for (const dp of domPlaces) {
        if (dp.cid) addPlace(dp);
      }
    } catch {}
    if (skippedReviews > 0) {
      this.log(job, "info", `${skippedReviews} tempat dilewati — ulasannya sudah jelas di bawah ${minReviews} sejak daftar hasil. Tempat yang belum jelas jumlah ulasannya tetap dikumpulkan (difilter setelah fase detail).`);
    }

    const totalInFeed: number = await this.safeEval<number>(page, () => {
      const f = document.querySelector('div[role="feed"]');
      return f ? f.querySelectorAll('a[href*="/maps/place/"]').length : 0;
    }, 0);

    try { await page.close(); } catch {}
    // simpan hasil varian ini ke cache — hanya bila sehat (tidak diblokir & ada hasil)
    if (!blocked && collected.length > 0) {
      await mapsSearchPut(cacheKey, collected).catch(() => {});
    }
    return { newPlaces, totalInFeed, viewport: lastViewport, blocked, cached: false };
  }

  /** Fallback: ekstrak place dari DOM feed (href berisi cid/koordinat/placeId) */
  private async extractPlacesFromDom(page: any, query: string): Promise<Place[]> {
    const cards = await this.safeEval<{ href: string; text: string }[]>(page, () => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return [];
      const out: { href: string; text: string }[] = [];
      for (const a of feed.querySelectorAll('a[href*="/maps/place/"]')) {
        const href = (a as HTMLAnchorElement).href || "";
        const art = (a as HTMLElement).closest('div[role="article"]');
        out.push({ href, text: art ? (art as HTMLElement).innerText.slice(0, 500) : "" });
      }
      return out;
    }, []);
    const places: Place[] = [];
    const seen = new Set<string>();
    for (const c of cards as { href: string; text: string }[]) {
      try {
        const cid = c.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)!/)?.[1];
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        const lat = parseFloat(c.href.match(/!8m2!3d(-?[\d.]+)!/)?.[1] ?? "");
        const lng = parseFloat(c.href.match(/!8m2!3d-?[\d.]+!4d(-?[\d.]+)!/)?.[1] ?? "");
        const placeId = decodeURIComponent(c.href.match(/!19s([^!?]+)/)?.[1] ?? "");
        const kgid = decodeURIComponent(c.href.match(/!16s([^!?]+)/)?.[1] ?? "");
        const lines = c.text.split("\n").map((s: string) => s.trim()).filter(Boolean);
        const name = lines[0] ?? "";
        // rating "4,9" → 4.9; ulasan "1.839 ulasan"
        let rating: number | null = null;
        let reviewsCount: number | null = null;
        for (const line of lines) {
          const rm = line.match(/^(\d+([.,]\d+)?)$/);
          if (rm && rating === null) { rating = parseFloat(rm[1].replace(",", ".")); continue; }
          const vm = line.match(/^([\d.,]+)\s*(?:ulasan|reviews)/i);
          if (vm) { reviewsCount = parseInt(vm[1].replace(/[.,]/g, "")) || null; }
        }
        // kategori · alamat
        let categories: string[] = [];
        let fullAddress = "";
        const catLine = lines.find((l: string) => l.includes("·"));
        if (catLine) {
          const parts = catLine.split("·").map((x: string) => x.trim()).filter(Boolean);
          categories = parts.filter((x: string) => !/^Jl\.|^Jalan/i.test(x));
          fullAddress = parts.find((x: string) => /^Jl\.|^Jalan/i.test(x)) ?? "";
        }
        if (!name) continue;
        places.push({
          cid, placeId, kgid, name,
          categories,
          fullAddress,
          shortAddress: fullAddress,
          desa: "", kecamatan: "", kabupaten: "", provinsi: "", postalCode: "",
          plusCode: "", area: "",
          phone: "", phoneIntl: "", phoneDigits: "", website: "",
          email: "", emailStatus: "none",
          instagram: "", facebook: "", tiktok: "", socialStatus: "none",
          rating,
          reviewsCount,
          hours: [], hoursText: "",
          lat: isFinite(lat) ? lat : null,
          lng: isFinite(lng) ? lng : null,
          mapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : c.href.split("?")[0],
          businessStatus: /tutup permanen/i.test(c.text) ? "Tutup Permanen" : "",
          timezone: "",
          detailStatus: "pending",
          sourceQuery: query,
          foundAt: new Date().toISOString(),
          leadStatus: "baru",
          leadNote: "",
          leadUpdatedAt: null,
        });
      } catch {}
    }
    return places;
  }

  /** Ambil detail satu place via navigasi place_id + intercept preview/place */
  private async fetchPlaceDetail(place: Place): Promise<Partial<Place> | null> {
    if (!place.placeId) return null;
    // CACHE: detail tempat yang sama dalam 7 hari dipakai langsung — halaman
    // detail dilewati (telepon/website/jam buka jarang berubah).
    const cachedDetail = await mapsDetailGet(place.placeId);
    if (cachedDetail) return cachedDetail;

    // v11.6 JALUR CEPAT: RPC /maps/preview/place dipanggil LANGSUNG via HTTP
    // (tanpa tab browser) — ±0,2-0,8 dtk vs 2-4+ dtk render halaman. Google acak
    // mengirim varian respons tanpa blok jumlah ulasan, jadi bila angka ulasan
    // belum terbaca diulang (maks 3) — filter review minimal butuh angka itu.
    const ctx = await this.bm.getContext();
    const fast = await fetchDetailFast(ctx, place.cid);
    if (fast && fast.reviewsCount != null) {
      await mapsDetailPut(place.placeId, fast).catch(() => {});
      return fast;
    }

    const page = await this.bm.newPage();
    let detailBody: string | null = null;
    let detailUrl: string | null = null;

    const onResponse = async (resp: any) => {
      const url = resp.url();
      if (url.includes("/maps/preview/place") && !detailBody) {
        try {
          const body = await resp.text();
          if (body && body.length > 2000) { detailBody = body; detailUrl = url; }
        } catch {}
      }
    };
    page.on("response", onResponse);

    try {
      await page.goto(`https://www.google.com/maps/place/?q=place_id:${place.placeId}&hl=id&gl=id`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      // tunggu respons detail (max 14 dtk)
      for (let i = 0; i < 28; i++) {
        if (detailBody) break;
        await sleep(500);
      }
      let result: Partial<Place> | null = null;
      if (detailBody) {
        result = parsePlaceDetail(detailBody);
      }
      // fallback: cek status bisnis dari teks DOM
      if (result && !result.businessStatus) {
        const txt = await this.safeEval(page, () => document.body?.innerText ?? "", "");
        if (/tutup permanen/i.test(txt)) result.businessStatus = "Tutup Permanen";
      }
      if (result) await mapsDetailPut(place.placeId, result).catch(() => {});
      // dump diagnostik (DUMP_RPC=1): URL + potongan body RPC detail
      if (process.env.DUMP_RPC === "1" && detailUrl) {
        try {
          mkdirSync(path.join(import.meta.dir, "debug"), { recursive: true });
          await Bun.write(path.join(import.meta.dir, "debug", "detail-rpc.json"), JSON.stringify({
            placeId: place.placeId, url: detailUrl, body: (detailBody ?? "").slice(0, 12000),
          }, null, 2));
        } catch {}
      }
      // jalur cepat menghasilkan data (tanpa angka ulasan) → tetap terpakai bila
      // fallback halaman browser gagal total
      return result ?? fast;
    } catch {
      return fast;
    } finally {
      try { await page.close(); } catch {}
    }
  }

  /** Fase pencarian: mendukung batch multi-kata-kunci (dicari bergantian, dedup global by cid) */
  private async searchPhase(job: ScrapeJob): Promise<void> {
    const keywords = job.keywords?.length ? job.keywords : [job.keyword];
    if (keywords.length > 1) {
      this.log(job, "info", `Mode batch: ${keywords.length} kata kunci akan dicari bergantian — ${keywords.map((k) => `"${k}"`).join(", ")} — hasil digabung & didedup otomatis.`);
    }
    job.progress.searchTotal = 0;
    // v10: batas waktu fase pencarian — job tidak boleh menggantung selamanya.
    // v10.1: skala dengan jumlah kata kunci (2 mnt/kata kunci, minimum 15 mnt) agar
    // batch sinonim lengkap (mis. 15 istilah barbershop) tidak terpotong di tengah.
    const searchMaxMs = Math.max(SEARCH_PHASE_MAX_MS, keywords.length * 2 * 60_000);
    const deadline = Date.now() + searchMaxMs;

    // PARALEL 3 (v12.7): kata kunci dicari tiga bersamaan (tab terpisah, pola
    // wajar ala manusia banyak-tab) — batch multi-kata kunci dingin ±3× lebih
    // cepat. Dedup cid antar hasil tetap aman (operasi sinkron). Indikasi blokir
    // memicu jeda 30 dtk per varian (pengaman sudah ada).
    let blockedAll = true;
    let ki = 0;
    const kwWorker = async () => {
      while (this.alive(job) && job.places.length < MAX_PLACES) {
        if (Date.now() > deadline) return;
        const i = ki++;
        if (i >= keywords.length) return;
        const blocked = await this.searchSingleKeyword(job, keywords[i], deadline);
        if (!blocked) blockedAll = false;
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, keywords.length) }, () => kwWorker()));
    if (Date.now() > deadline) {
      this.log(job, "warn", `Batas waktu fase pencarian (${searchMaxMs / 60000} mnt) tercapai — melanjutkan dengan ${job.places.length} tempat yang sudah ditemukan.`);
    }

    // simpan area yang dikenali
    if (job.places.length > 0) {
      const sample = job.places[0];
      job.resolvedArea = sample.kabupaten || sample.kecamatan || sample.area || job.city;
    }

    if (blockedAll && job.places.length === 0) {
      throw new Error("Google membatasi akses (bot detection). Coba lagi dalam beberapa menit.");
    }
    if (job.places.length === 0) {
      this.log(job, "warn", "Tidak ada tempat ditemukan. Coba kata kunci atau nama kota yang lebih spesifik.");
    } else {
      this.log(job, "success", `Total ${job.places.length} tempat unik ditemukan${keywords.length > 1 ? ` dari ${keywords.length} kata kunci` : ""}. Lanjut mengambil detail…`);
    }
  }

  /** Pencarian satu kata kunci: varian frasa + quadrant split otomatis. Return true bila semua varian diblokir. */
  private async searchSingleKeyword(job: ScrapeJob, keyword: string, deadline = Date.now() + SEARCH_PHASE_MAX_MS): Promise<boolean> {
    const { city } = job;
    const variants: { query: string; viewport?: { lat: number; lng: number; zoom: number } }[] = [];

    // varian frasa — dua pola umum bahasa Indonesia
    const q1 = `${keyword} di ${city}`;
    const q2 = `${keyword} ${city}`;
    variants.push({ query: q1 });
    if (q2 !== q1) variants.push({ query: q2 });

    job.progress.searchTotal += variants.length;
    job.progress.phase = "Mencari tempat di Google Maps…";
    if (job.progress.percent < 2) job.progress.percent = 2;

    let blockedCount = 0;
    // v12.6: kolektor hasil kata kunci INI — tidak tercampur kata kunci lain yang
    // berjalan paralel. Isinya deterministik antar run (cache menyimpan hasil yang
    // sama persis), sehingga bbox-nya stabil → pusat kuadran stabil → kuadran
    // kena cache di run berikutnya.
    const kwCollector: Place[] = [];

    // varian utama
    for (const v of variants) {
      if (!this.alive(job)) return blockedCount > 0;
      if (Date.now() > deadline) {
        this.log(job, "warn", `Batas waktu fase pencarian tercapai saat "${v.query}" — lanjut ke fase detail.`);
        return blockedCount > 0;
      }
      job.progress.phase = `Mencari: "${v.query}"…`;
      const res = await this.runSearchVariant(job, v.query, undefined, kwCollector);
      job.variants.push({
        query: v.query,
        url: this.searchUrl(v.query, v.viewport?.lat, v.viewport?.lng, v.viewport?.zoom),
        zoomLevel: v.viewport?.zoom ?? null,
        placesFound: res.newPlaces,
        isQuadrant: false,
      });
      job.progress.searchDone++;
      job.progress.percent = Math.min(25, 5 + job.progress.searchDone * 8);
      if (res.blocked) {
        blockedCount++;
        this.log(job, "warn", `Terindikasi pembatasan akses saat mencari "${v.query}". Jeda 30 dtk lalu lanjut…`);
        await sleep(30000);
      } else {
        this.log(job, "success", `"${v.query}" → ${res.newPlaces} tempat baru (total unik: ${job.places.length})`);
      }
      if (job.places.length >= MAX_PLACES) break;
      // v12.7: varian cache tidak menyentuh Google sama sekali — jeda bisa pendek;
      // varian scroll sungguhan tetap jeda acak (anti pola mesin)
      await sleep(res.cached ? rnd(150, 350) : rnd(900, 1500));
    }

    // v12.6: kwFound dihitung dari hasil unik kata kunci ini sendiri (dulu: selisih
    // job.places yang bisa tercemar kata kunci paralel lain)
    const kwFound = new Set(kwCollector.map((p) => p.cid)).size;

    // quadrant split bila kata kunci ini mendekati batas Google (~120 hasil/query)
    if (job.deepMode && this.alive(job) && kwFound >= CAP_THRESHOLD && job.places.length < MAX_PLACES) {
      this.log(job, "info", `"${keyword}": ${kwFound} hasil mendekati batas per pencarian — memecah wilayah menjadi 4 kuadran agar tidak ada yang terlewat…`);
      job.progress.phase = `Mode mendalam: memecah wilayah untuk "${keyword}"…`;

      // v12.6: viewport utama dari hasil kata kunci INI (stabil antar run), bukan
      // gabungan seluruh job yang bergeser tiap run → cache kuadran kini efektif
      const lats = kwCollector.filter((p) => p.lat != null).map((p) => p.lat!);
      const lngs = kwCollector.filter((p) => p.lng != null).map((p) => p.lng!);
      if (lats.length > 0 && lngs.length > 0) {
        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
        const spanLat = Math.max(...lats) - Math.min(...lats) || 0.05;
        const spanLng = Math.max(...lngs) - Math.min(...lngs) || 0.05;

        for (let depth = 1; depth <= MAX_QUADRANT_DEPTH; depth++) {
          if (!this.alive(job) || job.places.length >= MAX_PLACES) break;
          const zoom = 12 + depth + 1; // zoom quadrant
          const halfLat = spanLat / Math.pow(2, depth) / 2;
          const halfLng = spanLng / Math.pow(2, depth) / 2;
          const quadrantAreas: { lat: number; lng: number }[] = [];
          for (let i = -1; i <= 1; i += 2) {
            for (let j = -1; j <= 1; j += 2) {
              quadrantAreas.push({ lat: centerLat + i * halfLat, lng: centerLng + j * halfLng });
            }
          }
          job.progress.searchTotal += quadrantAreas.length;
          this.log(job, "info", `Kuadran level ${depth}: ${quadrantAreas.length} area, zoom ${zoom}…`);

          let newFromQuadrants = 0;
          for (const q of quadrantAreas) {
            if (!this.alive(job)) break;
            if (Date.now() > deadline) {
              this.log(job, "warn", "Batas waktu fase pencarian tercapai di tengah kuadran — lanjut ke fase detail.");
              break;
            }
            job.progress.phase = `Kuadran ${q.lat.toFixed(3)}, ${q.lng.toFixed(3)}…`;
            const res = await this.runSearchVariant(job, `${keyword} di ${city}`, { lat: q.lat, lng: q.lng, zoom }, kwCollector);
            job.variants.push({
              query: `${keyword} di ${city}`,
              url: this.searchUrl(`${keyword} di ${city}`, q.lat, q.lng, zoom),
              zoomLevel: zoom,
              placesFound: res.newPlaces,
              isQuadrant: true,
            });
            newFromQuadrants += res.newPlaces;
            job.progress.searchDone++;
            job.progress.percent = Math.min(45, 25 + (job.progress.searchDone / job.progress.searchTotal) * 20);
            if (res.blocked) { await sleep(30000); }
            await sleep(res.cached ? rnd(150, 350) : rnd(800, 1300));
          }
          job.stats.quadrants += quadrantAreas.length;
          this.log(job, "success", `Kuadran level ${depth} selesai: +${newFromQuadrants} tempat baru (total: ${job.places.length})`);
          // v12.6: lanjut lebih dalam hanya bila level ini masih produktif —
          // rata-rata >= 12 tempat baru per pencarian kuadran. Level yang menipis
          // berarti area sudah tercakup penuh; level berikutnya hampir pasti
          // sia-sia (terbukti: level 2 "barbershop" Subang +0 setelah 60 dtk scroll)
          if (newFromQuadrants < quadrantAreas.length * 12 || depth >= MAX_QUADRANT_DEPTH) break;
        }
      }
    }

    return blockedCount > 0 && kwFound === 0;
  }

  /** v10: pengaman per tempat — fetchPlaceDetail tak boleh lebih dari DETAIL_ITEM_MAX_MS */
  private async watchDetail(place: Place): Promise<Partial<Place> | null> {
    try {
      return await Promise.race([
        this.fetchPlaceDetail(place),
        new Promise<Partial<Place> | null>((resolve) => {
          const t = setTimeout(() => resolve(null), DETAIL_ITEM_MAX_MS);
          (t as any)?.unref?.();
        }),
      ]);
    } catch {
      return null;
    }
  }

  /** Fase detail: telepon, website, jam buka untuk tiap place — paralel (2 worker) */
  private async detailsPhase(job: ScrapeJob): Promise<void> {
    const targets = job.places.filter((p) => p.detailStatus === "pending" && p.placeId);
    // v11.6: filter review minimal berjalan DINAMIS selama detail — angka ulasan
    // yang terbukti di bawah ambang langsung membuang tempatnya (tanpa menunggu).
    const minReviews = job.minReviews ?? 0;
    let droppedReviews = 0;
    job.progress.detailsTotal = targets.length;
    job.progress.detailsDone = 0;
    job.progress.phase = `Mengambil detail tempat (telepon, website, jam buka)${DETAIL_CONCURRENCY > 1 ? ` — ${DETAIL_CONCURRENCY} pekerja paralel` : ""}…`;
    job.progress.percent = 45;
    if (DETAIL_CONCURRENCY > 1 && targets.length > 4) {
      // v11.6: jalur HTTP langsung ±0,5 dtk/tempat/pekerja (fallback browser lebih lama)
      this.log(job, "info", `Mengambil detail dengan ${DETAIL_CONCURRENCY} pekerja paralel — durasi ± ${Math.max(1, Math.round((targets.length * 0.8) / DETAIL_CONCURRENCY / 60))} menit untuk ${targets.length} tempat.`);
    }

    let failed = 0;
    let idx = 0;
    // v10: batas waktu total job — lewat batas → selesai parsial (bukan menggantung).
    // v11.2: skala dengan jumlah kata kunci — batch besar mencari lebih lama, jadi
    // deadline total = budget pencarian (kw × 2 mnt) + 30 mnt utk detail/WA, minimal 45 mnt.
    const kwCount = job.keywords?.length ?? 1;
    const totalMaxMs = Math.max(JOB_MAX_MS, kwCount * 2 * 60_000 + 30 * 60_000);
    const jobDeadline = (job.startedAt ?? Date.now()) + totalMaxMs;
    let deadlineHit = false;

    const mergeDetail = (place: Place, detail: Partial<Place>) => {
      // merge: hanya isi field yang kosong / belum ada
      if (detail.phone && !place.phone) { place.phone = detail.phone; if (detail.phoneIntl) place.phoneIntl = detail.phoneIntl; if (detail.phoneDigits) place.phoneDigits = detail.phoneDigits; }
      if (detail.website && !place.website) place.website = detail.website;
      if (detail.hours?.length) { place.hours = detail.hours; if (detail.hoursText) place.hoursText = detail.hoursText; }
      if (detail.fullAddress && !place.fullAddress) place.fullAddress = detail.fullAddress;
      if (detail.shortAddress && !place.shortAddress) place.shortAddress = detail.shortAddress;
      if (detail.desa && !place.desa) place.desa = detail.desa;
      if (detail.kecamatan && !place.kecamatan) place.kecamatan = detail.kecamatan;
      if (detail.kabupaten && !place.kabupaten) place.kabupaten = detail.kabupaten;
      if (detail.provinsi && !place.provinsi) place.provinsi = detail.provinsi;
      if (detail.postalCode && !place.postalCode) place.postalCode = detail.postalCode;
      if (detail.plusCode && !place.plusCode) place.plusCode = detail.plusCode;
      if (detail.rating != null && place.rating == null) place.rating = detail.rating;
      if (detail.reviewsCount != null && place.reviewsCount == null) place.reviewsCount = detail.reviewsCount;
      if (detail.businessStatus) place.businessStatus = detail.businessStatus;
      if (detail.timezone && !place.timezone) place.timezone = detail.timezone;
    };

    const worker = async (workerId: number) => {
      // jeda awal antar worker agar tidak dua request persis bersamaan
      if (workerId > 0) await sleep(600 * workerId);
      let failStreak = 0; // gagal berurutan → indikasi pembatasan Google → jeda darurat
      while (this.alive(job)) {
        if (Date.now() > jobDeadline) {
          if (!deadlineHit) {
            deadlineHit = true;
            this.log(job, "warn", `Batas waktu job (${Math.round(totalMaxMs / 60000)} mnt) tercapai — menyelesaikan dengan data yang sudah terkumpul.`);
          }
          return;
        }
        const i = idx++;
        if (i >= targets.length) return;
        const place = targets[i];
        let detail = await this.watchDetail(place);
        if (!detail) {
          await sleep(1000);
          detail = await this.watchDetail(place); // retry sekali
        }
        if (detail) {
          mergeDetail(place, detail);
          place.detailStatus = "ok";
          failStreak = 0;
          // v11.6: PENERAPAN REVIEW MINIMAL INSTAN — begitu jumlah ulasan terbaca
          // dan terbukti di bawah ambang, tempat dibuang detik itu juga. Keputusan
          // filter review minimal selesai bersamaan dengan detail terakhir.
          if (minReviews > 0 && place.reviewsCount != null && place.reviewsCount < minReviews) {
            const ix = job.places.indexOf(place);
            if (ix >= 0) job.places.splice(ix, 1);
            droppedReviews++;
          }
        } else {
          place.detailStatus = "failed";
          failed++;
          failStreak++;
          if (failStreak >= 3) {
            this.log(job, "warn", `${failStreak} detail gagal berurutan — jeda darurat 15 dtk (aman dari pembatasan Google)…`);
            await sleep(15000);
            failStreak = 0;
          }
        }
        job.progress.detailsDone++;
        const base = 45;
        const frac = job.progress.detailsTotal > 0 ? job.progress.detailsDone / job.progress.detailsTotal : 1;
        job.progress.percent = Math.min(98, base + frac * 53);
        if (job.progress.detailsDone % 10 === 0 || job.progress.detailsDone === job.progress.detailsTotal) {
          job.progress.phase = `Detail ${job.progress.detailsDone}/${job.progress.detailsTotal} tempat…`;
        }
        await sleep(rnd(200, 500));
      }
    };

    await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, (_, w) => worker(w)));

    if (droppedReviews > 0) {
      this.log(job, "info", `Filter review minimal ${minReviews} (cepat, sambil detail): ${droppedReviews} tempat dibuang — ulasannya terbukti di bawah ambang.`);
    }
    if (failed > 0) {
      this.log(job, "warn", `${failed} tempat tidak bisa diambil detailnya (data dasar tetap disimpan).`);
    }
  }

  /** Fase email: buka website tiap tempat (fetch ringan) → cari email kontak + link sosmed */
  private async emailPhase(job: ScrapeJob): Promise<void> {
    const targets = job.places.filter((p) => p.website && !p.email && (p.emailStatus === "none" || p.emailStatus === "pending"));
    const social = targets.filter((p) => isSocialLink(p.website));
    const fetchTargets = targets.filter((p) => !isSocialLink(p.website));

    job.progress.phase = `Mencari email & sosmed dari website (0/${fetchTargets.length})…`;
    job.progress.percent = 45;
    this.log(job, "info", `Memindai ${fetchTargets.length} website untuk mencari email kontak & sosmed${social.length ? ` (${social.length} link sosial/ marketplace dilewati)` : ""}…`);

    for (const p of social) {
      p.emailStatus = "skipped";
      // link sosial SEBAGAI website (umum di UMKM): langsung petakan IG/FB/TikTok tanpa fetch
      const direct = socialFromUrl(p.website);
      if (hasSocial(direct)) this.applySocials(p, direct);
    }

    let done = 0;
    let found = 0;
    let failed = 0;

    await scanEmails(fetchTargets, EMAIL_CONCURRENCY, async (place) => {
      const { emails, socials, skipped } = await findEmailsForWebsite(place.website);
      if (skipped) {
        place.emailStatus = "skipped";
      } else if (emails.length > 0) {
        place.email = emails.join("; ");
        place.emailStatus = "found";
        found++;
      } else {
        place.emailStatus = "not-found";
        failed++;
      }
      if (hasSocial(socials)) this.applySocials(place, socials);
      else if (!place.socialStatus || place.socialStatus === "none") place.socialStatus = "not-found";
      done++;
      job.progress.percent = Math.min(97, 45 + (done / Math.max(fetchTargets.length, 1)) * 52);
      if (done % 5 === 0 || done === fetchTargets.length) {
        job.progress.phase = `Mencari email & sosmed dari website (${done}/${fetchTargets.length}) — ${found} email ditemukan…`;
      }
    });

    const totalEmail = job.places.filter((p) => p.email).length;
    const totalSocial = job.places.filter((p) => p.instagram || p.facebook || p.tiktok).length;
    this.log(job, "success", `Pencarian email selesai: ${totalEmail} tempat punya email (${found} baru ditemukan, ${failed} website tanpa email) · ${totalSocial} punya sosmed.`);
  }

  /** Terapkan hasil ekstraksi sosmed ke place */
  private applySocials(place: Place, s: SocialLinks) {
    if (s.instagram) place.instagram = s.instagram;
    if (s.facebook) place.facebook = s.facebook;
    if (s.tiktok) place.tiktok = s.tiktok;
    place.socialStatus = "found";
  }

  /** Fase sosmed: pindai website utk link Instagram/Facebook/TikTok (budget minim, terpisah dari email) */
  private async socialPhase(job: ScrapeJob): Promise<void> {
    const targets = job.places.filter((p) => p.website && p.socialStatus !== "found" && (!p.socialStatus || p.socialStatus === "none" || p.socialStatus === "pending"));
    job.progress.phase = `Mencari sosmed dari website (0/${targets.length})…`;
    job.progress.percent = 45;
    this.log(job, "info", `Memindai ${targets.length} website untuk mencari link Instagram/Facebook/TikTok…`);

    let done = 0;
    let found = 0;
    let skipped = 0;

    await scanEmails(targets, EMAIL_CONCURRENCY, async (place) => {
      const { socials, skipped: sk } = await findSocialsForWebsite(place.website);
      if (sk) {
        place.socialStatus = "skipped";
        skipped++;
      } else if (hasSocial(socials)) {
        this.applySocials(place, socials);
        found++;
      } else {
        place.socialStatus = "not-found";
      }
      done++;
      job.progress.percent = Math.min(97, 45 + (done / Math.max(targets.length, 1)) * 52);
      if (done % 5 === 0 || done === targets.length) {
        job.progress.phase = `Mencari sosmed dari website (${done}/${targets.length}) — ${found} ditemukan…`;
      }
    });

    const totalSocial = job.places.filter((p) => p.instagram || p.facebook || p.tiktok).length;
    this.log(job, "success", `Pencarian sosmed selesai: ${totalSocial} tempat punya IG/FB/TikTok (${found} baru ditemukan${skipped ? `, ${skipped} link marketplace dilewati` : ""}).`);
  }

  /** Jalankan job lengkap */
  async runJob(job: ScrapeJob, opts?: { skipSearch?: boolean; emailScan?: boolean; socialScan?: boolean }): Promise<void> {
    job.status = "running";
    job.startedAt = Date.now();

    // mode khusus: hanya scan sosmed (job selesai dipindai ulang utk cari IG/FB/TikTok)
    if (opts?.socialScan) {
      job.progress.phase = "Mencari sosmed dari website…";
      this.log(job, "info", `Mencari link Instagram/Facebook/TikTok dari website — "${job.keyword}" di "${job.city}"…`);
      try {
        await this.socialPhase(job);
        if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
        this.finalize(job);
      } catch (e: any) {
        job.status = "failed";
        job.error = e?.message ?? String(e);
        job.finishedAt = Date.now();
        job.progress.phase = "Gagal";
        this.log(job, "error", `Pencarian sosmed gagal: ${job.error}`);
      }
      return;
    }

    // mode khusus: hanya scan email (job selesai dipindai ulang utk cari email)
    if (opts?.emailScan) {
      job.progress.phase = "Mencari email dari website…";
      this.log(job, "info", `Mencari email kontak dari website — "${job.keyword}" di "${job.city}"…`);
      try {
        await this.bm.getBrowser(); // warm-up browser (konsistensi perilaku, tak dipakai utk fetch)
        await this.emailPhase(job);
        if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
        this.finalize(job);
      } catch (e: any) {
        job.status = "failed";
        job.error = e?.message ?? String(e);
        job.finishedAt = Date.now();
        job.progress.phase = "Gagal";
        this.log(job, "error", `Pencarian email gagal: ${job.error}`);
      }
      return;
    }

    job.progress.phase = "Menyiapkan browser…";
    const kwCount = job.keywords?.length ?? 1;
    this.log(job, "info", opts?.skipSearch
      ? `Memperbarui detail "${job.keyword}" di "${job.city}"`
      : `Mulai scraping "${job.keyword}" di "${job.city}"${kwCount > 1 ? ` — mode batch ${kwCount} kata kunci` : ""}${job.deepMode ? " (mode mendalam)" : ""}`);
    if (!opts?.skipSearch && kwCount > 1) {
      this.log(job, "info", `Tip: kata kunci sinonim (cth "laundry, binatu") menghasilkan tempat berbeda di Google — batch memastikan tidak ada yang terlewat.`);
    }

    try {
      await this.bm.getBrowser();
      if (!opts?.skipSearch) {
        await this.searchPhase(job);
        if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
      }
      await this.detailsPhase(job);
      if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
      this.applyReviewFilter(job);
      if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
      this.applyPhoneFilter(job);
      if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
      await this.whatsappPhase(job);
      if (!this.alive(job)) { job.progress.phase = "Dibatalkan"; return; }
      this.finalize(job);
    } catch (e: any) {
      job.status = "failed";
      job.error = e?.message ?? String(e);
      job.finishedAt = Date.now();
      job.progress.phase = "Gagal";
      this.log(job, "error", `Job gagal: ${job.error}`);
    }
  }

  /** Filter review minimal SAPU FINAL — penerapan utama kini DINAMIS selama fase
   *  detail (detailsPhase membuang tempat begitu angka ulasannya terbaca di bawah
   *  ambang). Sisa di sini: tempat yang angkanya tetap tak terbaca (detail gagal)
   *  diperlakukan 0 — kebijakan final tetap: yang tidak terbukti memenuhi ambang
   *  tidak lolos. Bonus: fase WhatsApp hanya memeriksa tempat yang lolos review. */
  private applyReviewFilter(job: ScrapeJob): void {
    const min = job.minReviews ?? 0;
    if (min <= 0) return;
    const before = job.places.length;
    const kept = job.places.filter((p) => (p.reviewsCount ?? 0) >= min);
    const dropped = before - kept.length;
    if (dropped > 0) {
      job.places = kept;
      this.log(job, "info", `Filter review minimal ${min} (setelah detail): ${dropped} tempat dibuang — ulasannya terbukti di bawah ${min}. ${kept.length} tempat lolos.`);
    }
  }

  /** Filter nomor telepon FINAL — permintaan pengguna (v11.4):
   *  (1) tempat TANPA nomor telepon tidak disimpan;
   *  (2) nomor darat / kode layanan pendek (021…, 022…, 1500959, dst.) juga dibuang —
   *      hanya NOMOR PONSEL yang bisa punya WhatsApp yang disimpan
   *      (Indonesia: 08… / 628…, panjang wajar 10-14 digit).
   *  Dijalankan setelah fase detail karena nomor baru lengkap di fase tsb; sekaligus
   *  menjamin angka "tempat" di UI = isi ekspor. */
  private applyPhoneFilter(job: ScrapeJob): void {
    const before = job.places.length;
    const kept = job.places.filter((p) => {
      if (!p.phoneDigits) return false;
      const n = toWaDigits(p.phoneDigits);
      if (!n) return false;
      if (n.startsWith("628")) return n.length >= 10 && n.length <= 14; // ponsel Indonesia
      if (!n.startsWith("62")) return n.length >= 8 && n.length <= 15; // internasional lain — diserahkan ke cek WA
      return false; // 62… tapi bukan 628 = telepon rumah/kantor Indonesia → buang
    });
    const dropped = before - kept.length;
    if (dropped > 0) {
      job.places = kept;
      this.log(job, "info", `Filter telepon: ${dropped} tempat dibuang — tanpa nomor / nomor darat-kode layanan (bukan ponsel). ${kept.length} tempat ber-nomor ponsel tersimpan.`);
    }
  }

  /** Tunggu sesi WhatsApp (layanan wa-checker) terhubung — polling tiap 5 dtk.
   *  Fase job diperbarui agar UI menjelaskan mengapa proses menunggu.
   *  Return true bila sesi terhubung sebelum tenggat, false bila habis. */
  private async waitForWaSession(job: ScrapeJob, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await waServiceConnected()) return true;
      const sisa = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      job.progress.phase = `Menunggu sesi WhatsApp terhubung — pasang pairing lewat ikon WhatsApp di header (maks ${sisa} dtk)…`;
      await new Promise((r) => setTimeout(r, 5000));
    }
    return await waServiceConnected();
  }

  /** Periksa ulang nomor WhatsApp sebuah job SELESAI — tanpa scraping ulang.
   *  KEBIJAKAN KETAT (permintaan pengguna): nomor yang tidak bisa di-chat JANGAN
   *  dipertahankan — hanya yang terverifikasi yang tersisa.
   *  LAPIS 1: protokol resmi (Baileys, sesi terhubung) — jawaban definitif;
   *           yang terbukti tidak terdaftar DIBUANG. Sesi belum terhubung →
   *           ditunggu maks 2 menit agar pemeriksaan memakai protokol resmi.
   *  LAPIS 2 (sesi tetap tak ada): halaman web, mode ketat — web tidak bisa
   *           memastikan nomor terdaftar-yang-privasi, jadi hanya nomor dengan
   *           bukti profil (nama/foto tampil) yang disimpan; sisanya dibuang. */
  async recheckWa(job: ScrapeJob): Promise<{ layer: string; aktif: number; tidakTerdaftar: number; takPasti: number; dibuang: number }> {
    const targets = job.places.filter((p) => p.phoneDigits);
    let aktif = 0, tidakTerdaftar = 0, takPasti = 0;
    let layer = "halaman web (ketat)";
    let map: Map<string, boolean | null> | null = null;
    if (targets.length === 0) {
      return { layer, aktif: 0, tidakTerdaftar: 0, takPasti: 0, dibuang: 0 };
    }
    if (await waServiceConnected()) {
      layer = "protokol resmi";
      this.log(job, "info", `Periksa ulang WhatsApp via protokol resmi: ${targets.length} nomor…`);
      map = await waServiceCheck(targets.map((p) => p.phoneDigits));
      if (map) await waCacheStoreVerdicts([...map.entries()].filter(([, v]) => v !== null)).catch(() => {});
      // PENGAMAN: sesi baru kadang belum siap menerima queri — hasil mass-null
      // tidak boleh dipakai membuang; turunkan ke lapis HTTP cepat.
      if (map) {
        const nullCount = targets.filter((p) => (map!.get(p.phoneDigits) ?? null) === null).length;
        if (targets.length >= 10 && nullCount / targets.length >= 0.8) {
          this.log(job, "warn", `Protokol resmi belum siap menerima queri (${nullCount}/${targets.length} belum pasti) — memakai lapis HTTP cepat…`);
          layer = "halaman web (ketat)";
          map = null;
        }
      }
    } else {
      this.log(job, "warn", "Sesi WhatsApp belum terhubung — menunggu pairing maks 30 dtk (ikon WhatsApp di header); setelah itu pemilahan memakai lapis HTTP cepat yang ketat…");
      if (await this.waitForWaSession(job, 30_000)) {
        layer = "protokol resmi";
        this.log(job, "success", `Sesi WhatsApp terhubung — periksa ulang via protokol resmi: ${targets.length} nomor…`);
        map = await waServiceCheck(targets.map((p) => p.phoneDigits));
      }
    }
    if (!map) {
      this.log(job, "warn", "Sesi WhatsApp tidak tersedia — mode ketat via halaman web: hanya nomor yang terbukti aktif (profil tampil) yang dipertahankan…");
      map = await waDeepCheckNumbers(() => this.bm.newPage(), targets.map((p) => p.phoneDigits), {
        concurrency: 6,
      });
    }
    const ketatWeb = layer.startsWith("halaman web");
    // PENGAMAN: bila lapis web-laat mengambang massal (≥80% ambigu, indikasi
    // WhatsApp membatasi IP) — JANGAN buang buta; simpan yang belum pasti dan
    // minta pengguna memeriksa ulang nanti.
    const nullCount = targets.filter((p) => (map?.get(p.phoneDigits) ?? null) === null).length;
    const layerTidakStabil = ketatWeb && targets.length >= 10 && nullCount / targets.length >= 0.8;
    const keep: Place[] = [];
    for (const p of job.places) {
      if (!p.phoneDigits) { takPasti++; keep.push(p); continue; }
      const v = map?.get(p.phoneDigits) ?? null;
      p.waOk = v;
      if (v === true) { aktif++; keep.push(p); }
      else if (v === false) { tidakTerdaftar++; continue; } // definitif tidak terdaftar → dibuang
      else if (ketatWeb && !layerTidakStabil) { continue; } // web tak bisa memastikan → dibuang (ketat)
      else { takPasti++; keep.push(p); }                    // protokol gagal queri / layer tak stabil → disimpan
    }
    if (layerTidakStabil) {
      this.log(job, "warn", `Hasil pemeriksaan tidak stabil (${nullCount}/${targets.length} ambigu — indikasi dibatasi WhatsApp). Nomor belum-pasti TIDAK dibuang — jalankan Periksa ulang WhatsApp lagi nanti.`);
    }
    const dibuang = job.places.length - keep.length;
    if (dibuang > 0) job.places = keep;
    this.log(job, "success", `Periksa ulang WhatsApp (${layer}): ${aktif} aktif disimpan · ${tidakTerdaftar} tidak terdaftar dibuang · ${takPasti} belum pasti${layerTidakStabil ? " disimpan (layer tak stabil)" : ketatWeb ? " dibuang (ketat: hanya terverifikasi aktif yang disimpan)" : " tetap disimpan"}${dibuang > 0 ? ` · total ${dibuang} dibuang` : ""}.`);
    return { layer, aktif, tidakTerdaftar, takPasti, dibuang };
  }

  /** Verifikasi WhatsApp — KEBIJAKAN KETAT (v12): hanya nomor yang TERBUKTI bisa
   *  di-chat yang disimpan; sisanya dibuang, tanpa kecuali.
   *  LAPIS 1 (utama): protokol WhatsApp resmi via Baileys (layanan wa-checker) —
   *          jawaban "terdaftar/tidak" definitif, sama seperti aplikasi di ponsel.
   *          Sesi belum terhubung → ditunggu maks 5 menit agar pairing selesai.
   *  LAPIS 2 (cadangan, sesi tetap tak ada): render halaman WhatsApp mode ketat —
   *          hanya nomor dengan bukti profil (nama/foto tampil) yang disimpan.
   *  Mode requireWa: ini jalur yang membuang; mode normal hanya menandai. */
  private async whatsappPhase(job: ScrapeJob): Promise<void> {
    const withPhone = job.places.filter((p) => p.phoneDigits && p.waOk == null);

    // ---- mode wajib WhatsApp (requireWa) ----
    if (job.requireWa) {
      const total = withPhone.length;
      const noPhone = job.places.length - job.places.filter((p) => p.phoneDigits).length;
      job.progress.phase = `Memeriksa ${total} nomor WhatsApp…`;

      // LAPIS 1: protokol WhatsApp resmi (bila sesi terhubung via layanan wa-checker).
      // Sesi belum terhubung tidak lagi langsung jatuh ke web — ditunggu dulu,
      // karena jawaban protokol satu-satunya yang pasti.
      let map: Map<string, boolean | null> | null = null;
      if (await waServiceConnected()) {
        this.log(job, "info", `Cek WhatsApp via protokol resmi (sesi terhubung): ${total} nomor…`);
        map = await waServiceCheck(withPhone.map((p) => p.phoneDigits));
      } else {
        this.log(job, "warn", "Sesi WhatsApp belum terhubung — menunggu pairing maks 30 dtk (ikon WhatsApp di header); setelah itu pemilahan memakai lapis HTTP cepat yang ketat…");
        if (await this.waitForWaSession(job, 30_000)) {
          this.log(job, "success", `Sesi WhatsApp terhubung — pemilahan via protokol resmi: ${total} nomor…`);
          map = await waServiceCheck(withPhone.map((p) => p.phoneDigits));
        }
      }
      if (map) {
        // ulangi sekali nomor yang gagal diperiksa (null) — kegagalan queri sesaat
        await waCacheStoreVerdicts([...map.entries()].filter(([, v]) => v !== null)).catch(() => {});
        const ulang = withPhone.filter((p) => (map!.get(p.phoneDigits) ?? null) === null).map((p) => p.phoneDigits);
        if (ulang.length > 0) {
          await new Promise((r) => setTimeout(r, 2000));
          const map2 = await waServiceCheck(ulang);
          if (map2) for (const [k, v] of map2) map!.set(k, v);
        }
        // PENGAMAN: sesi yang BARU terpasang kadang belum siap menerima queri —
        // hasil hampir semua null. Jangan percai untuk membuang: jatuh ke lapis
        // HTTP cepat yang punya pengaman sendiri.
        const nullCount = withPhone.filter((p) => (map!.get(p.phoneDigits) ?? null) === null).length;
        if (withPhone.length >= 10 && nullCount / withPhone.length >= 0.8) {
          this.log(job, "warn", `Protokol resmi belum siap menerima queri (${nullCount}/${withPhone.length} belum pasti) — memakai lapis HTTP cepat…`);
          map = null;
        }
      }
      if (map) {
        let aktif = 0, mati = 0, takVerif = 0;
        const keep: Place[] = [];
        for (const p of job.places) {
          if (!p.phoneDigits) continue;
          const v = map.get(p.phoneDigits) ?? null;
          p.waOk = v;
          if (v === true) { aktif++; keep.push(p); }
          else if (v === false) mati++; // jawaban definitif dari protokol WhatsApp
          else takVerif++;              // tak terverifikasi → dibuang (ketat)
        }
        const dropped = job.places.length - keep.length;
        job.places = keep;
        job.progress.detailsTotal = keep.length;
        this.log(job, "success", `Filter WhatsApp (protokol resmi): ${aktif} aktif disimpan · ${mati} dibuang (tidak terdaftar) · ${takVerif} dibuang (tak terverifikasi) · ${noPhone} dibuang (tanpa nomor).`);
        return;
      }

      // LAPIS 2: render halaman WhatsApp (sesi tetap tidak terhubung) — mode ketat.
      // Web tidak bisa membedakan "nomor mati" dan "terdaftar tapi privasi", jadi
      // hanya nomor dengan bukti profil (nama/foto tampil) yang disimpan.
      this.log(job, "warn", "Sesi WhatsApp tetap tidak terhubung — mode ketat via halaman web: hanya nomor yang terbukti aktif yang disimpan…");
      const mapWeb = await waDeepCheckNumbers(() => this.bm.newPage(), withPhone.map((p) => p.phoneDigits), {
        concurrency: 6,
        onProgress: (done, t) => { job.progress.phase = `Memeriksa nomor WhatsApp (${done}/${t})…`; },
      });
      let aktif = 0, buang = 0, ragu = 0;
      const keep: Place[] = [];
      // PENGAMAN: hasil ambigu massal (≥80%) = layer sedang dibatasi WhatsApp —
      // jangan buang buta; simpan yang belum pasti agar tidak ada penghapusan diam-diam.
      const nullCount = withPhone.filter((p) => (mapWeb.get(p.phoneDigits) ?? null) === null).length;
      const layerTidakStabil = withPhone.length >= 10 && nullCount / withPhone.length >= 0.8;
      for (const p of job.places) {
        if (!p.phoneDigits) continue; // tanpa nomor = tak mungkin dihubungi via WhatsApp
        const v = mapWeb.get(p.phoneDigits) ?? null;
        p.waOk = v;
        if (v === true) { aktif++; keep.push(p); } // profil tampil = pasti bisa di-chat
        else if (layerTidakStabil) { ragu++; keep.push(p); } // layer tak stabil → disimpan, jangan buang
        else buang++;                              // tidak terverifikasi aktif → dibuang (ketat)
      }
      const dropped = job.places.length - keep.length;
      job.places = keep;
      job.progress.detailsTotal = keep.length;
      if (layerTidakStabil) {
        this.log(job, "warn", `Hasil pemeriksaan tidak stabil (${nullCount}/${withPhone.length} ambigu — indikasi dibatasi WhatsApp). Nomor belum-pasti TIDAK dibuang — jalankan Periksa ulang WhatsApp lagi nanti.`);
      }
      this.log(job, "success", `Filter WhatsApp (halaman web, ketat): ${aktif} aktif terkonfirmasi disimpan · ${buang} dibuang (tidak terverifikasi aktif)${layerTidakStabil ? ` · ${ragu} belum-pasti disimpan (layer tak stabil)` : ""} · ${noPhone} dibuang (tanpa nomor). Pasang sesi WhatsApp (ikon header) agar pemilahan memakai protokol resmi yang pasti.`);
      return;
    }

    // ---- mode normal: cek ringan wa.me (semua tempat tetap disimpan, waOk jadi penanda) ----
    if (withPhone.length === 0) return;
    job.progress.phase = `Cek WhatsApp ${withPhone.length} nomor…`;
    this.log(job, "info", `Memeriksa ${withPhone.length} nomor telepon via wa.me…`);
    const waOkMap = await waCheckNumbers(withPhone.map((p) => p.phoneDigits)).catch(() => null);
    if (!waOkMap) {
      this.log(job, "warn", "Pemeriksaan WhatsApp gagal — nomor ditandai belum dicek.");
      return;
    }
    let ok = 0, no = 0;
    for (const p of withPhone) {
      const v = waOkMap.get(p.phoneDigits) ?? null;
      p.waOk = v;
      if (v === true) ok++; else if (v === false) no++;
    }
    this.log(job, "success", `Cek WhatsApp selesai: ${ok} nomor diterima wa.me, ${no} ditolak, ${withPhone.length - ok - no} tidak pasti.`);
  }

  /** finalisasi statistik + status selesai */
  private finalize(job: ScrapeJob) {
    // dedup nomor telepon: entri cid berbeda tapi nomor sama = listing ganda usaha yang
    // sama (muncul berulang di hasil Google) — simpan satu entri terbaik per nomor.
    const bestByPhone = new Map<string, Place>();
    for (const p of job.places) {
      if (!p.phoneDigits) continue;
      const cur = bestByPhone.get(p.phoneDigits);
      if (!cur || (p.reviewsCount ?? 0) > (cur.reviewsCount ?? 0)) bestByPhone.set(p.phoneDigits, p);
    }
    const seenPhone = new Set<string>();
    const deduped: Place[] = [];
    let dupPhone = 0;
    for (const p of job.places) {
      if (!p.phoneDigits) { deduped.push(p); continue; }
      const keeper = bestByPhone.get(p.phoneDigits)!;
      if (keeper !== p) {
        dupPhone++;
        // status prospek / data pelengkap dari entri yang dibuang pindah ke yang disimpan
        if (p.leadStatus && p.leadStatus !== "baru" && (keeper.leadStatus === "baru" || !keeper.leadStatus)) {
          keeper.leadStatus = p.leadStatus;
          keeper.leadNote = p.leadNote;
          keeper.leadUpdatedAt = p.leadUpdatedAt;
        }
        if (p.waOk != null && keeper.waOk == null) keeper.waOk = p.waOk;
        if (p.email && !keeper.email) keeper.email = p.email;
        if (p.website && !keeper.website) keeper.website = p.website;
        if (p.instagram && !keeper.instagram) keeper.instagram = p.instagram;
        if (p.facebook && !keeper.facebook) keeper.facebook = p.facebook;
        if (p.tiktok && !keeper.tiktok) keeper.tiktok = p.tiktok;
        continue;
      }
      if (seenPhone.has(p.phoneDigits)) continue;
      seenPhone.add(p.phoneDigits);
      deduped.push(p);
    }
    if (dupPhone > 0) {
      job.places = deduped;
      this.log(job, "info", `Dedup: ${dupPhone} entri dengan nomor telepon ganda digabung (satu entri terlengkap per nomor).`);
    }

    const places = job.places;
    const ratings = places.filter((p) => p.rating != null).map((p) => p.rating!);
    job.stats = {
      total: places.length,
      withPhone: places.filter((p) => p.phoneDigits).length,
      withWebsite: places.filter((p) => p.website).length,
      withEmail: places.filter((p) => p.email).length,
      withSocial: places.filter((p) => p.instagram || p.facebook || p.tiktok).length,
      withRating: places.filter((p) => p.rating != null).length,
      avgRating: ratings.length ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2)) : null,
      withHours: places.filter((p) => p.hours.length > 0).length,
      quadrants: job.stats.quadrants,
      variantsRun: job.variants.length,
    };
    job.status = "completed";
    job.finishedAt = Date.now();
    job.progress.percent = 100;
    job.progress.phase = "Selesai";
    const dur = ((job.finishedAt - job.startedAt!) / 1000).toFixed(0);
    this.log(job, "success", `Selesai! ${places.length} tempat disimpan tanpa duplikat (${dur} detik). Siap diekspor ke Excel/CSV.`);
  }

  async shutdown() {
    await this.bm.close();
  }
}
