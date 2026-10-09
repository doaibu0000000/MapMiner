// capture-search.ts — alat reverse-engineering (dijalankan manual, bukan bagian service):
// buka 1 pencarian Google Maps di browser sungguhan, tangkap SEMUA URL RPC tbm=map
// (GET) beserta panjang body-nya, lalu simpan ke debug/search-rpc.json untuk
// dianalisis & direplikasi via HTTP murni.
//
// Pakai: bun capture-search.ts ["barbershop di Subang"] [jumlahScroll]
import { BrowserManager } from "./browser";
import { mkdirSync } from "node:fs";
import path from "node:path";

const QUERY = process.argv[2] ?? "barbershop di Subang";
const SCROLLS = Number(process.argv[3] ?? 8);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const bm = new BrowserManager();
const page = await bm.newPage();
const captured: { url: string; bodyLen: number }[] = [];
let firstBody: string | null = null;

const onResponse = async (resp: any) => {
  const u = resp.url();
  if (u.includes("tbm=map") && resp.request().method() === "GET") {
    let len = 0;
    try {
      const body = await resp.text();
      len = body.length;
      if (!firstBody && len > 800) firstBody = body;
    } catch {}
    captured.push({ url: u, bodyLen: len });
  }
};
page.on("response", onResponse);

await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(QUERY)}?hl=id&gl=id`, {
  waitUntil: "domcontentloaded",
  timeout: 45000,
});
await sleep(3000);

for (let i = 0; i < SCROLLS; i++) {
  await page
    .evaluate(() => {
      const f = document.querySelector('div[role="feed"]') as HTMLElement | null;
      if (f) f.scrollTop = f.scrollHeight;
    })
    .catch(() => {});
  await sleep(1500);
}

mkdirSync(path.join(import.meta.dir, "debug"), { recursive: true });
const out = {
  query: QUERY,
  capturedAt: new Date().toISOString(),
  count: captured.length,
  requests: captured,
  firstBodyLen: firstBody?.length ?? 0,
};
await Bun.write(path.join(import.meta.dir, "debug", "search-rpc.json"), JSON.stringify(out, null, 2));
if (firstBody) {
  await Bun.write(path.join(import.meta.dir, "debug", "search-rpc-body1.txt"), firstBody);
}

console.log(`tertangkap ${captured.length} URL tbm=map (query: "${QUERY}")`);
for (const c of captured) console.log(`- [${c.bodyLen} B] ${c.url.slice(0, 200)}`);
await bm.close();
