// Next.js instrumentation — berjalan sekali saat server Next.js start.
// Menyalakan layanan scraper (port 3003) otomatis dan menjaganya tetap hidup
// selama server berjalan, sehingga aplikasi tidak pernah "Offline" hanya karena
// proses scraper mati/terlupa dijalankan.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureScraperService } = await import("./lib/scraper-keeper");

  // nyalakan saat boot (non-blocking — server tetap start walau scraper lambat)
  void ensureScraperService(10_000);

  // keep-alive: cek tiap 60 dtk, nyalakan ulang bila mati
  const g = globalThis as any;
  if (!g.__SCRAPER_KEEPER_TIMER__) {
    g.__SCRAPER_KEEPER_TIMER__ = setInterval(() => {
      void ensureScraperService();
    }, 60_000);
    g.__SCRAPER_KEEPER_TIMER__?.unref?.();
  }
}
