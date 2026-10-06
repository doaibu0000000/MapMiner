// Manajemen lifecycle browser Chromium (Playwright)

import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

// Kandidat executable Chromium: cache Playwright dulu (Windows & Linux), lalu
// Chrome/Edge yang terpasang di sistem sebagai cadangan — agar scraping tetap
// jalan meski browser Playwright versi terbaru belum terunduh.
function chromiumCandidates(): string[] {
  const local = process.env.LOCALAPPDATA ?? "";
  const pf = process.env.ProgramFiles ?? "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const cache = local ? `${local}\\ms-playwright` : "";
  return [
    // cache Playwright di Windows
    ...(cache ? [
      `${cache}\\chromium-1243\\chrome-win64\\chrome.exe`,
      `${cache}\\chromium-1243\\chrome-win\\chrome.exe`,
      `${cache}\\chromium-1228\\chrome-win64\\chrome.exe`,
      `${cache}\\chromium-1228\\chrome-win\\chrome.exe`,
      `${cache}\\chromium-1200\\chrome-win64\\chrome.exe`,
      `${cache}\\chromium-1200\\chrome-win\\chrome.exe`,
      `${cache}\\chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
      `${cache}\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
    ] : []),
    // Chrome / Edge yang terpasang di Windows
    `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    ...(local ? [`${local}\\Google\\Chrome\\Application\\chrome.exe`] : []),
    `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    // cache Playwright di Linux (host lama)
    "/home/z/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
    "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome",
    "/home/z/.cache/ms-playwright/chromium-1243/chrome-linux/chrome",
    "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux/chrome",
  ];
}

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private launching: Promise<Browser> | null = null;
  pagesCreated = 0;

  async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected?.() ?? this.browser) {
      return this.browser!;
    }
    if (this.launching) return this.launching;
    this.launching = this.launch();
    try {
      this.browser = await this.launching;
      return this.browser;
    } finally {
      this.launching = null;
    }
  }

  private async launch(): Promise<Browser> {
    let exe: string | undefined;
    for (const p of chromiumCandidates()) {
      try {
        await Bun.file(p).stat();
        exe = p;
        break;
      } catch {}
    }
    if (!exe) {
      // biarkan Playwright memakai resolusi default-nya (errornya jelas: perlu `npx playwright install`)
      console.warn("[browser] Tidak ada Chromium/Chrome/Edge ditemukan — fallback ke Playwright default.");
    }
    const browser = await chromium.launch({
      headless: true,
      executablePath: exe,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-first-run",
        "--disable-features=IsolateOrigins,site-per-process",
        "--window-size=1280,900",
        "--lang=id",
      ],
    });
    this.browser = browser;
    this.context = null;
    return browser;
  }

  async getContext(): Promise<BrowserContext> {
    const browser = await this.getBrowser();
    if (this.context) return this.context;
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "id-ID",
      timezoneId: "Asia/Jakarta",
      userAgent: USER_AGENT,
      deviceScaleFactor: 1,
      extraHTTPHeaders: { "Accept-Language": "id,en;q=0.9" },
    });
    // v10.2: pra-pasang cookie persetujuan Google — tanpa ini consent.google.com
    // mencegat halaman pencarian sehingga feed hasil tidak pernah muncul (0 tempat).
    try {
      await context.addCookies([
        { name: "CONSENT", value: "YES+cb.20220419-08-p0.en+FX+700", domain: ".google.com", path: "/" },
        { name: "SOCS", value: "CAESHAgBEhJnd3NfMjAyMzAyMjgtMF9SQzEaAmRlIAEaBgiAo_CmBg", domain: ".google.com", path: "/" },
      ]);
    } catch {}
    // Menyamarkan jejak otomasi
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      // @ts-ignore
      window.chrome = window.chrome || { runtime: {} };
    });
    this.context = context;
    return context;
  }

  async newPage(): Promise<Page> {
    const ctx = await this.getContext();
    const page = await ctx.newPage();
    this.pagesCreated++;
    return page;
  }

  async close(): Promise<void> {
    try { await this.browser?.close(); } catch {}
    this.browser = null;
    this.context = null;
  }
}
