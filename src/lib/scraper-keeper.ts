// Menjaga layanan scraper (port 3003) tetap hidup dari dalam proses server Next.js.
// Layanan scraper adalah process bun terpisah (mini-services/gmaps-scraper) — jika
// mati, seluruh API scraper balik 502 dan UI menampilkan "Offline" dengan tombol
// "Mulai Ambil Data" terkunci. Modul ini menyalakannya ulang secara otomatis:
//   - instrumentation.ts memanggilnya saat server start + keep-alive tiap 60 dtk
//   - route /api/scraper/jobs memanggilnya saat proksi gagal (self-heal)
// State disimpan di globalThis agar aman terhadap hot-reload (pola yang sama
// dipakai layanan scraper untuk bun --hot).

import { spawn } from "child_process";
import path from "path";

const HEALTH_URL = "http://localhost:3003/health";
const SPAWN_COOLDOWN_MS = 15_000;

type KeeperState = { lastSpawnAt: number };
const g = globalThis as any;
const state: KeeperState =
  g.__SCRAPER_KEEPER__ ?? (g.__SCRAPER_KEEPER__ = { lastSpawnAt: 0 });

export async function scraperHealthy(timeoutMs = 1500): Promise<boolean> {
  try {
    const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Spawn ulang layanan scraper (detached, tanpa jendela, tahan terhadap restart server Next). */
export function spawnScraper(): void {
  const now = Date.now();
  if (now - state.lastSpawnAt < SPAWN_COOLDOWN_MS) return;
  state.lastSpawnAt = now;
  const dir = path.join(process.cwd(), "mini-services", "gmaps-scraper");
  try {
    // shell:true agar "bun" ter-resolve dari PATH Windows; detached agar proses
    // tetap hidup walau server Next dimatikan/di-restart.
    const child = spawn("bun index.ts", {
      cwd: dir,
      shell: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // biarkan watchdog/keep-alive mencoba lagi pada siklus berikutnya
  }
}

/** Pastikan layanan scraper hidup; kalau mati, nyalakan dan (opsional) tunggu sampai siap. */
export async function ensureScraperService(waitMs = 0): Promise<boolean> {
  if (await scraperHealthy()) return true;
  spawnScraper();
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 600));
    if (await scraperHealthy(800)) return true;
  }
  return scraperHealthy(800);
}
