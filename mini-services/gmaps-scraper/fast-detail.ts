// Jalur cepat detail tempat (v11.6): RPC /maps/preview/place dipanggil LANGSUNG via
// HTTP (context.request — cookie & UA browser dipakai) TANPA membuka tab browser.
// Terbukti: ±0,2-0,8 dtk per tempat vs 2-4+ dtk lewat halaman browser, dan bisa
// paralel deras karena tanpa render. Template pb berasal dari URL RPC nyata yang
// tertangkap saat scraping (slot CID diganti per tempat; token sesi dibuang —
// teruji tidak wajib). Bila jalur ini gagal, pemanggil fallback ke halaman browser.
import type { BrowserContext } from "playwright-core";
import { parsePlaceDetail } from "./parser";
import type { Place } from "./types";

const PREVIEW_URL_TEMPLATE = "https://www.google.com/maps/preview/place?authuser=0&hl=id&gl=id&pb=%211m14%211s{CID}%213m12%211m3%211d3.265222004736283E7%212d118.01556799999999%213d-2.5502209999999996%212m3%211f0.0%212f0.0%213f0.0%213m2%211i1024%212i768%214f13.1%2112m4%212m3%211i360%212i120%214i8%2113m57%212m2%211i203%212i100%213m2%212i4%215b1%216m6%211m2%211i86%212i86%211m2%211i408%212i240%217m33%211m3%211e1%212b0%213e3%211m3%211e2%212b1%213e2%211m3%211e2%212b0%213e3%211m3%211e8%212b0%213e3%211m3%211e10%212b0%213e3%211m3%211e10%212b1%213e2%211m3%211e10%212b0%213e4%211m3%211e9%212b1%213e2%212b1%219b0%2115m8%211m7%211m2%211m1%211e2%212m2%211i195%212i195%213i20%2115m108%211m26%2113m9%212b1%213b1%214b1%216i1%218b1%219b1%2114b1%2120b1%2125b1%2118m15%213b1%214b1%215b1%216b1%2113b1%2114b1%2117b1%2121b1%2122b1%2130b1%2132b1%2133m1%211b1%2134b1%2136e2%2110m1%218e3%2111m1%213e1%2117b1%2120m2%211e3%211e6%2124b1%2125b1%2126b1%2127b1%2129b1%2130m1%212b1%2136b1%2137b1%2139m3%212m2%212i1%213i1%2143b1%2152b1%2154m1%211b1%2155b1%2156m1%211b1%2161m2%211m1%211e1%2165m5%213m4%211m3%211m2%211i224%212i298%2172m22%211m8%212b1%215b1%217b1%2112m4%211b1%212b1%214m1%211e1%214b1%218m10%211m6%214m1%211e1%214m1%211e3%214m1%211e4%213sother_user_google_review_posts__and__hotel_and_vr_partner_review_posts%216m1%211e1%219b1%2189b1%2190m2%211m1%211e2%2198m3%211b1%212b1%213b1%21103b1%21113b1%21114m3%211b1%212m1%211b1%21117b1%21122m1%211b1%21126b1%21127b1%21128m1%211b1%2121m0%2122m1%211e81%2130m8%213b1%216m2%211b1%212b1%217m2%211e3%212b1%219b1%2134m5%217b1%2110b1%2114b1%2115m1%211b0%2137i797";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** URL RPC preview/place untuk satu tempat (cid bentuk 0x…:0x…). */
export function buildPreviewUrl(cid: string): string {
  return PREVIEW_URL_TEMPLATE.replace("{CID}", encodeURIComponent(cid));
}

async function fetchOnce(ctx: BrowserContext, url: string, timeoutMs: number): Promise<Partial<Place> | null> {
  const resp = await ctx.request.get(url, { timeout: timeoutMs });
  if (resp.status() !== 200) return null;
  const body = await resp.text();
  if (!body || body.length < 2000) return null;
  return parsePlaceDetail(body);
}

/** Ambil detail tempat via HTTP murni. Google acak mengirim varian respons tanpa
 *  blok jumlah ulasan (nama/rating/telepon selalu ada) — angka ulasan wajib untuk
 *  filter review minimal & kolom tabel, maka diulang maks 3x sampai terbaca.
 *  Null bila cid tidak cocok / semua percobaan gagal. */
export async function fetchDetailFast(ctx: BrowserContext, cid: string | undefined, timeoutMs = 12000): Promise<Partial<Place> | null> {
  if (!cid || !cid.includes(":")) return null;
  let best: Partial<Place> | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await fetchOnce(ctx, buildPreviewUrl(cid), timeoutMs);
      if (d) {
        const cur = best;
        if (!cur) best = d;
        else if (d.reviewsCount != null && cur.reviewsCount == null) {
          best = { ...cur, rating: d.rating ?? cur.rating, reviewsCount: d.reviewsCount };
        }
        if (best && best.reviewsCount != null) return best;
      }
    } catch {}
    if (attempt < 2) await sleep(150 + Math.random() * 250);
  }
  return best;
}
