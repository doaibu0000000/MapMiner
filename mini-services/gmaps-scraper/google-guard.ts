// google-guard.ts — v13.1: satu pintu untuk SEMUA request ke Google.
//   1) Gerbang SSRF: hanya https://www.google.com (host ditolak selain itu)
//   2) p-limit terpusat: batas inflight global — struktur pemanggil (pekerja
//      tempat, gelombang paginasi) bebas paralel, jumlah request serentak
//      tetap terkendali
//   3) Backoff adaptif: 429/403/halaman sorry → seluruh proses berhenti
//      meningkat (30 dtk → 1 → 2 → 4 → 8 → 10 mnt maks), pulih bertahap
//      setelah 50 request sukses. Ini yang membuat "kencang tapi aman":
//      kencang saat Google lega, mundur otomatis saat Google menegur.
import pLimit from "p-limit";

const ALLOWED_HOST = "www.google.com";
const CONCURRENCY = Math.max(4, Math.min(48, Number(process.env.GOOGLE_CONCURRENCY ?? 24)));

const central = pLimit(CONCURRENCY);

let cooldownUntil = 0;
let blockStreak = 0;
let okSinceBlock = 0;

export function guardStats() {
  return { concurrency: CONCURRENCY, cooldownUntil, blockStreak, okSinceBlock, cooling: Date.now() < cooldownUntil };
}

/** Sinyal Google menegur — semua pekerja akan diam serentak selama cooldown. */
export function noteBlocked(reason: string): void {
  blockStreak++;
  okSinceBlock = 0;
  const waitMs = Math.min(10 * 60_000, 30_000 * Math.pow(2, Math.min(blockStreak - 1, 4)));
  cooldownUntil = Math.max(cooldownUntil, Date.now() + waitMs);
  console.log(`[guard] ${reason} → jeda global ${Math.round(waitMs / 1000)} dtk (streak ${blockStreak})`);
}

/** Google melayani dengan normal — pulih bertahap setelah 50 sukses beruntun. */
function noteOk(): void {
  if (blockStreak > 0 && ++okSinceBlock >= 50) {
    blockStreak = 0;
    okSinceBlock = 0;
    console.log("[guard] 50 request sukses beruntun — pulih dari jeda blokir.");
  }
}

export type GuardVerdict = { resp: Response; body: string };

/** Fetch ke www.google.com dengan gerbang + limiter + deteksi blokir.
 *  Melempar Error bila jaringan gagal / URL ditolak. Bila Google menjawab
 *  429/403, noteBlocked dipanggil otomatis dan status diteruskan ke pemanggil. */
export async function googleFetch(url: string, timeoutMs = 15000): Promise<GuardVerdict> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("URL tidak valid");
  }
  if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST) {
    throw new Error(`URL ditolak guard: ${u.protocol}//${u.hostname}`);
  }
  // tunggu di LUAR slot limiter — pekerja yang menunggu cooldown tidak memakan kuota inflight
  const waitMs = cooldownUntil - Date.now();
  if (waitMs > 0) await Bun.sleep(waitMs);

  return central(async () => {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Cookie: GOOGLE_COOKIE,
        "Accept-Language": "id,en;q=0.9",
        Referer: "https://www.google.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resp.status === 429 || resp.status === 403) {
      noteBlocked(`HTTP ${resp.status}`);
      return { resp, body: "" };
    }
    const body = await resp.text();
    if (resp.redirected && /\/sorry\/|\/easeui\/|sandbox\.google/i.test(resp.url)) {
      noteBlocked("redirect sorry");
      return { resp, body };
    }
    if (body.length > 0 && body.length < 20000 && /unusual traffic|tidak wajar|CAPTCHA/i.test(body)) {
      noteBlocked("halaman captcha");
      return { resp, body };
    }
    noteOk();
    return { resp, body };
  });
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GOOGLE_COOKIE = "CONSENT=YES+cb.20220419-08-p0.en+FX+700; SOCS=CAESHAgBEhJnd3NfMjAyMzAyMjgtMF9SQzEaAmRlIAEaBgiAo_CmBg";
