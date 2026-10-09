// search-rpc.ts — v13: pencarian Google Maps via HTTP MURNI (reverse-engineered).
// RPC `tbm=map` yang biasanya dipicu scroll halaman dipanggil langsung dengan
// fetch: halaman pertama (bentuk INIT, tanpa viewport — Google meresolusikan
// area dari teks query) lalu paginasi offset (bentuk PAGI, viewport eksplisit).
// Teruji: tanpa token sesi (nilai token bebas), tanpa psi/tch/ech, query di
// dalam pb diabaikan server (hanya parameter q yang menentukan), viewport
// kuadran bebas. Cookie persetujuan statis cukup — TANPA browser.
import { extractPlacesFromListBody } from "./parser";
import type { Place } from "./types";
import { googleFetch, noteBlocked } from "./google-guard";

/** Halaman pertama tanpa viewport. pb memuat query basi "barbershop di Subang"
 *  — diabaikan server (parameter q yang dipakai); dibiarkan agar struktur pb
 *  tetap byte-sama dengan capture asli yang teruji. */
const INIT_URL =
  "https://www.google.com/search?tbm=map&authuser=0&hl=id&gl=id&q={Q}&pb=%211sbarbershop+di+Subang%217i20%2110b1%2112m61%211m5%2118b1%2130b1%2131m1%211b1%2134e1%212m4%215m1%216e2%2120e3%2139b1%216m31%2132i1%2149b1%2163m0%2166b1%2185b1%21114b1%21149b1%21206b1%21209b1%21212b1%21215b1%21216b1%21222b1%21223b1%21234b1%21235b1%21239b1%21246b1%21253b1%21260b1%21262b1%21266b1%21270b1%21271b1%21273b1%21277b1%21281b1%21291m0%21294b1%21302i300%21303i100%2110b1%2112b1%2113b1%2114b1%2116b1%2117m1%213e1%2120m4%215e2%216b1%218b1%2114b1%2146m1%211b0%2196b1%2197m1%212b1%2199b1%2119m4%212m3%211i360%212i120%214i8%2120m57%212m2%211i203%212i100%213m2%212i4%215b1%216m6%211m2%211i86%212i86%211m2%211i408%212i240%217m33%211m3%211e1%212b0%213e3%211m3%211e2%212b1%213e2%211m3%211e2%212b0%213e3%211m3%211e8%212b0%213e3%211m3%211e10%212b0%213e3%211m3%211e10%212b1%213e2%211m3%211e10%212b0%213e4%211m3%211e9%212b1%213e2%212b1%219b0%2115m8%211m7%211m2%211m1%211e2%212m2%211i195%212i195%213i20%2122m5%211sAAfake0session0token0X%217e81%2114m1%213sAAfake0session0token0X%2115i9937%2124m107%211m25%2113m9%212b1%213b1%214b1%216i1%218b1%219b1%2114b1%2120b1%2125b1%2118m14%213b1%214b1%215b1%216b1%2113b1%2114b1%2117b1%2121b1%2122b1%2132b1%2133m1%211b1%2134b1%2136e2%2110m1%218e3%2111m1%213e1%2117b1%2120m2%211e3%211e6%2124b1%2125b1%2126b1%2127b1%2129b1%2130m1%212b1%2136b1%2137b1%2139m3%212m2%212i1%213i1%2143b1%2152b1%2154m1%211b1%2155b1%2156m1%211b1%2161m2%211m1%211e1%2165m5%213m4%211m3%211m2%211i224%212i298%2172m22%211m8%212b1%215b1%217b1%2112m4%211b1%212b1%214m1%211e1%214b1%218m10%211m6%214m1%211e1%214m1%211e3%214m1%211e4%213sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts%216m1%211e1%219b1%2189b1%2190m2%211m1%211e2%2198m3%211b1%212b1%213b1%21103b1%21113b1%21114m3%211b1%212m1%211b1%21117b1%21122m1%211b1%21126b1%21127b1%21128m1%211b1%2126m4%212m3%211i80%212i92%214i8%2130m28%211m6%211m2%211i0%212i0%212m2%211i530%212i768%211m6%211m2%211i974%212i0%212m2%211i1024%212i768%211m6%211m2%211i0%212i0%212m2%211i1024%212i20%211m6%211m2%211i0%212i748%212m2%211i1024%212i768%2134m19%212b1%213b1%214b1%216b1%218m6%211b1%213b1%214b1%215b1%216b1%217b1%219b1%2112b1%2114b1%2120b1%2123b1%2125b1%2126b1%2131b1%2137m1%211e81%2142b1%2149m10%213b1%216m2%211b1%212b1%217m2%211e3%212b1%218b1%219b1%2110e2%2150m3%212e2%213m1%213b1%2161b1%2167m5%217b1%2110b1%2114b1%2115m1%211b0%2169i798%2177b1";

/** Paginasi dengan viewport eksplisit (meter) + offset. Kuadran memakai bentuk
 *  ini langsung dari offset 0. Token sesi placeholder (nilai bebas, struktur
 *  wajib); blok chip diganti versi polos (tak membawa tanda tangan sesi). */
const PAGI_URL =
  "https://www.google.com/search?tbm=map&authuser=0&hl=id&gl=id&pb=!4m12!1m3!1d{SPAN}!2d{LNG}!3d{LAT}!2m3!1f0!2f0!3f0!3m2!1i1280!2i900!4f13.1!7i20!8i{OFFSET}!10b1!12m61!1m5!18b1!30b1!31m1!1b1!34e1!2m4!5m1!6e2!20e3!39b1!6m31!32i1!49b1!63m0!66b1!85b1!114b1!149b1!206b1!209b1!212b1!215b1!216b1!222b1!223b1!234b1!235b1!239b1!246b1!253b1!260b1!262b1!266b1!270b1!271b1!273b1!277b1!281b1!291m0!294b1!302i300!303i100!10b1!12b1!13b1!14b1!16b1!17m1!3e1!20m4!5e2!6b1!8b1!14b1!46m1!1b0!96b1!97m1!2b1!99b1!19m4!2m3!1i360!2i120!4i8!20m65!2m2!1i203!2i100!3m2!2i4!5b1!6m6!1m2!1i86!2i86!1m2!1i408!2i240!7m33!1m3!1e1!2b0!3e3!1m3!1e2!2b1!3e2!1m3!1e2!2b0!3e3!1m3!1e8!2b0!3e3!1m3!1e10!2b0!3e3!1m3!1e10!2b1!3e2!1m3!1e10!2b0!3e4!1m3!1e9!2b1!3e2!2b1!9b0!15m16!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!1m7!1m2!1m1!1e2!2m2!1i195!2i195!3i20!22m5!1sAAfake0session0token0X%3A51!2s1i%3A0%2Ct%3A246204%2Cp%3AAAfake0session0token0X%3A51!7e81!12e22!17sAAfake0session0token0X%3A52!24m107!1m25!13m9!2b1!3b1!4b1!6i1!8b1!9b1!14b1!20b1!25b1!18m14!3b1!4b1!5b1!6b1!13b1!14b1!17b1!21b1!22b1!32b1!33m1!1b1!34b1!36e2!10m1!8e3!11m1!3e1!17b1!20m2!1e3!1e6!24b1!25b1!26b1!27b1!29b1!30m1!2b1!36b1!37b1!39m3!2m2!2i1!3i1!43b1!52b1!54m1!1b1!55b1!56m1!1b1!61m2!1m1!1e1!65m5!3m4!1m3!1m2!1i224!2i298!72m22!1m8!2b1!5b1!7b1!12m4!1b1!2b1!4m1!1e1!4b1!8m10!1m6!4m1!1e1!4m1!1e3!4m1!1e4!3sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts!6m1!1e1!9b1!89b1!90m2!1m1!1e2!98m3!1b1!2b1!3b1!103b1!113b1!114m3!1b1!2m1!1b1!117b1!122m1!1b1!126b1!127b1!128m1!1b1!26m4!2m3!1i80!2i92!4i8!30m28!1m6!1m2!1i0!2i0!2m2!1i530!2i900!1m6!1m2!1i1230!2i0!2m2!1i1280!2i900!1m6!1m2!1i0!2i0!2m2!1i1280!2i20!1m6!1m2!1i0!2i880!2m2!1i1280!2i900!34m19!2b1!3b1!4b1!6b1!8m6!1b1!3b1!4b1!5b1!6b1!7b1!9b1!12b1!14b1!20b1!23b1!25b1!26b1!31b1!37m1!1e81!42b1!46m1!1e1!47m0!49m10!3b1!6m2!1b1!2b1!7m2!1e3!2b1!8b1!9b1!10e2!50m3!2e2!3m1!3b1!61b1!67m5!7b1!10b1!14b1!15m1!1b0!69i798!77b1&q={Q}&tch=1&ech=1";

const PAGE_SIZE = 20;
const MAX_PAGES_DEFAULT = 10; // offset maks ±200 — batas Google per query ~120

const rnd = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const encQ = (q: string) => encodeURIComponent(q).replace(/%20/g, "+");

/** Span viewport (meter) dari zoom Web Mercator utk tinggi 900px — hanya dipakai
 *  bila pemanggil tidak menyediakan spanMeters (kuadran selalu menyediakan). */
function zoomToSpan(zoom: number, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180) * 900) / Math.pow(2, zoom);
}

function buildInitUrl(query: string): string {
  return INIT_URL.replace(/\{Q\}/g, encQ(query));
}

function buildPagiUrl(query: string, span: number, lng: number, lat: number, offset: number): string {
  return PAGI_URL.replace("{SPAN}", String(span))
    .replace("{LNG}", String(lng))
    .replace("{LAT}", String(lat))
    .replace("{OFFSET}", String(offset))
    .replace("{Q}", encQ(query));
}

export interface DirectViewport {
  lat: number;
  lng: number;
  zoom: number;
  /** Tinggi viewport dalam meter (lebih presisi daripada derivasi zoom) */
  spanMeters?: number;
}

export interface SearchDirectOpts {
  isAlive?: () => boolean;
  onPage?: (page: number, uniqueSoFar: number, lastPageSize: number) => void;
  maxPages?: number;
  maxPlaces?: number;
}

export interface SearchDirectResult {
  ok: boolean;
  blocked: boolean;
  error?: string;
  places: Place[];
  viewport: [number, number, number] | null;
  pages: number;
}

type PageFetch = {
  ok: boolean;
  blocked: boolean;
  error?: string;
  places: Place[];
  viewport: [number, number, number] | null;
};

/** Ambil satu halaman RPC. Blocked = 429 / redirect ke sorry / halaman captcha. */
async function fetchPage(url: string, timeoutMs = 15000): Promise<PageFetch> {
  let resp: Response;
  let body = "";
  try {
    ({ resp, body } = await googleFetch(url, timeoutMs));
  } catch (e: any) {
    return { ok: false, blocked: false, error: `jaringan: ${e?.message ?? e}` };
  }
  if (resp.redirected && /\/sorry\/|sandbox\.google/i.test(resp.url)) {
    noteBlocked("redirect sorry");
    return { ok: false, blocked: true, error: "redirect sorry" };
  }
  if (resp.status !== 200) return { ok: false, blocked: resp.status === 403 || resp.status === 429, error: `HTTP ${resp.status}` };
  if (body.length > 0 && body.length < 20000 && /unusual traffic|tidak wajar|CAPTCHA/i.test(body.slice(0, 4000))) {
    return { ok: false, blocked: true, error: "halaman captcha" };
  }
  try {
    const { places, viewport } = extractPlacesFromListBody(body, "");
    return { ok: true, blocked: false, places, viewport };
  } catch (e: any) {
    return { ok: false, blocked: false, error: `parse: ${e?.message ?? e}` };
  }
}

const WAVE_SIZE = 3; // halaman per gelombang — serentak via p-limit terpusat

/** Satu varian pencarian lengkap via HTTP murni: halaman awal + paginasi offset
 *  dalam GELOMBANG paralel (v13.1) sampai daftar habis. Halaman 0 serial (butuh
 *  viewport-nya utk halaman lanjut), lalu offset 20/40/60… dikirim 3 serentak.
 *  Tempat dikembalikan unik by cid (urut temuan). */
export async function searchDirect(
  query: string,
  viewport?: DirectViewport,
  opts: SearchDirectOpts = {},
): Promise<SearchDirectResult> {
  const maxPages = opts.maxPages ?? MAX_PAGES_DEFAULT;
  const maxPlaces = opts.maxPlaces ?? 3000;
  const byCid = new Map<string, Place>();
  let lastViewport: [number, number, number] | null = null;
  let pagesRun = 0;
  let stalePages = 0; // halaman berturut tanpa tempat baru → berhenti
  let failed: PageFetch | null = null;

  const mergePage = (places: Place[]): { added: number } => {
    let added = 0;
    for (const p of places) {
      if (!p.cid || byCid.has(p.cid)) continue;
      byCid.set(p.cid, p);
      added++;
    }
    return { added };
  };

  // halaman 0 — serial: viewport hasilnya menentukan semua halaman lanjutan
  {
    const url0 = !viewport
      ? buildInitUrl(query)
      : buildPagiUrl(query, viewport.spanMeters ?? zoomToSpan(viewport.zoom, viewport.lat), viewport.lng, viewport.lat, 0);
    let res = await fetchPage(url0);
    if (!res.ok && !res.blocked) {
      await sleep(rnd(500, 1100));
      res = await fetchPage(url0);
    }
    if (!res.ok) {
      return { ok: false, blocked: res.blocked, error: res.error, places: [], viewport: null, pages: 0 };
    }
    if (res.viewport) lastViewport = res.viewport;
    pagesRun++;
    mergePage(res.places);
    opts.onPage?.(1, byCid.size, res.places.length);
    // halaman awal sudah kurang dari penuh → daftar memang pendek, selesai
    if (res.places.length === 0 || res.places.length < PAGE_SIZE) {
      return { ok: true, blocked: false, places: [...byCid.values()], viewport: lastViewport, pages: pagesRun };
    }
  }

  // gelombang paginasi paralel
  while (pagesRun < maxPages && !failed) {
    if (opts.isAlive && !opts.isAlive()) break;
    if (byCid.size >= maxPlaces) break;
    const offsets: number[] = [];
    for (let i = 0; i < WAVE_SIZE && pagesRun + i < maxPages; i++) offsets.push((pagesRun + i) * PAGE_SIZE);
    const results = await Promise.all(
      offsets.map(async (off, idx) => {
        // stagger kecil agar tidak menyambar persis bersamaan
        await sleep(idx * rnd(60, 140));
        // lastViewport berbentuk array [span, lng, lat] — normalisasi ke objek
        const vp = viewport
          ? { span: viewport.spanMeters ?? zoomToSpan(viewport.zoom, viewport.lat), lng: viewport.lng, lat: viewport.lat }
          : lastViewport
            ? { span: lastViewport[0], lng: lastViewport[1], lat: lastViewport[2] }
            : null;
        if (!vp) return { ok: false, blocked: false, error: "tanpa viewport", places: [], viewport: null } as PageFetch;
        return fetchPage(buildPagiUrl(query, vp.span, vp.lng, vp.lat, off));
      }),
    );
    let endOfList = false;
    for (const r of results) {
      pagesRun++;
      if (!r.ok) {
        if (r.blocked) failed = r;
        else if (!failed) failed = r; // gagal non-blokir di gelombang → berhenti juga
        continue;
      }
      if (r.viewport && !lastViewport) lastViewport = r.viewport;
      const { added } = mergePage(r.places);
      opts.onPage?.(pagesRun, byCid.size, r.places.length);
      if (r.places.length === 0 || r.places.length < PAGE_SIZE) endOfList = true;
      if (added === 0) {
        stalePages++;
        if (stalePages >= 2) endOfList = true;
      } else {
        stalePages = 0;
      }
    }
    if (endOfList && !failed) break;
  }

  if (failed) {
    return {
      ok: false,
      blocked: failed.blocked,
      error: failed.error,
      places: [...byCid.values()],
      viewport: lastViewport,
      pages: pagesRun,
    };
  }
  return { ok: true, blocked: false, places: [...byCid.values()], viewport: lastViewport, pages: pagesRun };
}
