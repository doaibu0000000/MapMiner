// e2e-v13.ts — uji end-to-end engine baru di proses terpisah (tanpa menyentuh
// service yang berjalan). Buktikan: pencarian + detail via HTTP murni
// (pagesCreated === 0), data lengkap, durasi.
import { ScrapeEngine } from "./scraper";
import type { ScrapeJob } from "./types";

const job: ScrapeJob = {
  id: "job_e2e_v13_test",
  keyword: "bakso",
  city: "Subang",
  keywords: undefined,
  deepMode: false, // tanpa kuadran — uji cepat
  minReviews: 1,
  requireWa: false, // cek WA ringan = fetch murni
  status: "queued",
  createdAt: Date.now(),
  startedAt: null,
  finishedAt: null,
  error: null,
  progress: { phase: "", percent: 0, searchDone: 0, searchTotal: 0, detailsDone: 0, detailsTotal: 0 },
  variants: [],
  logs: [],
  places: [],
  stats: { total: 0, withPhone: 0, withWebsite: 0, withEmail: 0, withSocial: 0, withRating: 0, avgRating: null, withHours: 0, quadrants: 0, variantsRun: 0 },
  resolvedArea: null,
};

const engine = new ScrapeEngine();
const t0 = Date.now();
await engine.runJob(job);
const dur = ((Date.now() - t0) / 1000).toFixed(1);
const pages = (engine as any).bm.pagesCreated ?? 0;

console.log(`\n===== HASIL =====`);
console.log(`status        : ${job.status}${job.error ? " — " + job.error : ""}`);
console.log(`durasi        : ${dur} dtk`);
console.log(`tempat        : ${job.places.length}`);
console.log(`dgn telepon   : ${job.stats.withPhone}`);
console.log(`dgn website   : ${job.stats.withWebsite}`);
console.log(`halaman dibuka: ${pages} ${pages === 0 ? "← NOL BROWSER ✔" : "← browser terpakai"}`);
console.log(`varian        : ${job.variants.length}`);
for (const v of job.variants) console.log(`  - "${v.query}" → ${v.placesFound} baru${v.isQuadrant ? " (kuadran)" : ""}`);
console.log(`--- log terakhir ---`);
for (const l of job.logs.slice(-14)) console.log(`  [${l.level}] ${l.msg}`);
console.log(`--- contoh tempat ---`);
for (const p of job.places.slice(0, 3)) {
  console.log(`  ${p.name} | tel:${p.phone || "-"} | web:${p.website || "-"} | ulasan:${p.reviewsCount ?? "-"} | ${p.kabupaten || p.fullAddress.slice(0, 40)}`);
}
await engine.shutdown();
