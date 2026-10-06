// Pencari email dari website bisnis — fetch ringan (tanpa browser) + koncurrency
// Strategi: buka homepage → cari mailto: & email di teks; bila kosong coba
// halaman kontak umum (/kontak, /contact, …) maks 3 fetch per website.

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,10}/g;
const MAILTO_RE = /mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,10})/gi;

/** domain yang hampir pasti bukan email kontak bisnis (tooling / placeholder / CDN) */
const JUNK_DOMAINS = [
  "sentry.io", "sentry-next.wixpress.com", "wixpress.com", "wix.com", "example.com",
  "example.org", "example.net", "domain.com", "domain.id", "yourdomain.com", "yourcompany.com",
  "email.com", "email.com.br", "mail.com", "foo.cool", "foo.com", "foo.org", "contoh.com",
  "godaddy.com", "schema.org", "squarespace.com", "wordpress.org", "googlemail.com.test",
  "test.com", "abc.com", "site.com", "website.com", "situs.com", "1secmail.com", "mailinator.com",
  "adobe.com", "fonts.adobe.com", "typekit.com", "polyfill.io", "jsdelivr.net",
  "unpkg.com", "cloudflare.com", "recaptcha.google", "gstatic.com", "google.com",
];
/** akun yang hampir pasti otomatis/bukan kontak manusia */
const JUNK_LOCALS = ["noreply", "no-reply", "donotreply", "postmaster", "abuse", "webmaster-spam"];
/** bagian dari email yang menandakan artefak aset (bukan email sungguhan) */
const ASSET_EXT = /\.(png|jpe?g|webp|gif|svg|css|js|ico|woff2?|ttf|eot|mp4|pdf|zip)$/i;

/** situs sosial / shortener — profile butuh login, email tak akan muncul: skip */
const SOCIAL_SKIP = [
  "facebook.com", "m.facebook.com", "web.facebook.com", "instagram.com", "tiktok.com", "vt.tiktok.com",
  "wa.me", "whatsapp.com", "youtube.com", "youtu.be", "goo.gl", "bit.ly", "t.ly",
  "shopee.co.id", "tokopedia.com", "gofood.link", "grab.com", "linktr.ee",
];

// ---- ekstraksi link media sosial (Instagram / Facebook / TikTok) ----

/** path yang pasti bukan profil (halaman internal platform) */
const IG_RESERVED = new Set(["p", "reel", "reels", "explore", "stories", "story", "tv", "accounts", "directory", "legal", "about", "developer", "plugins", "share", "challenge"]);
const FB_RESERVED = new Set(["sharer", "sharer.php", "share", "sh", "shb", "tr", "events", "groups", "help", "login", "hashtag", "watch", "photo", "permalink.php", "wix", "pages", "people", "profile.php", "marketplace", "gaming", "reel", "share.php", "dialog", "profil-facebook", "your-page", "username", "halaman-anda", "namahalaman"]);
const TT_RESERVED = new Set(["discover", "explore", "foryou", "following", "upload", "live", "tag", "music", "video", "trending", "search"]);

/** URL halaman Facebook lama: /pages/{nama}/{id} atau /people/{nama}/{id} — tetap halaman bisnis valid */
function legacyFbPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:pages|people)\/([A-Za-z0-9.\-]+)\/(\d{5,20})/);
  if (m) return `https://facebook.com/${m[1]}`;
  return null;
}

export interface SocialLinks {
  instagram: string;
  facebook: string;
  tiktok: string;
}

export const EMPTY_SOCIALS: SocialLinks = { instagram: "", facebook: "", tiktok: "" };

/** Bila URL website itu sendiri adalah link sosial → kembalikan langsung tanpa fetch */
export function socialFromUrl(rawUrl: string): SocialLinks {
  const out = { ...EMPTY_SOCIALS };
  try {
    const u = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, "");
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      const seg = path.split("/")[1] ?? "";
      if (seg && /^[A-Za-z0-9_.]{2,40}$/.test(seg) && !IG_RESERVED.has(seg.toLowerCase())) out.instagram = `https://instagram.com/${seg}`;
    } else if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com" || host === "fb.com" || host.endsWith(".facebook.com")) {
      const seg = (path.split("/")[1] ?? "").split("?")[0];
      const qId = u.searchParams.get("id");
      if (seg === "profile.php" && qId && /^\d{5,20}$/.test(qId)) out.facebook = `https://facebook.com/profile.php?id=${qId}`;
      else if (seg === "pages" || seg === "people") {
        const legacy = legacyFbPath(path);
        if (legacy) out.facebook = legacy;
      }
      else if (seg && /^[A-Za-z0-9.\-]{2,60}$/.test(seg) && !FB_RESERVED.has(seg.toLowerCase())) out.facebook = `https://facebook.com/${seg}`;
    } else if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      const seg = path.split("/")[1] ?? "";
      if (seg.startsWith("@")) {
        const user = seg.slice(1);
        if (/^[A-Za-z0-9_.]{1,30}$/.test(user) && !TT_RESERVED.has(user.toLowerCase())) out.tiktok = `https://tiktok.com/@${user}`;
      }
    }
  } catch {}
  return out;
}

/** Cari link IG/FB/TikTok dari HTML (href anchor, teks polos, JSON-LD sameAs) */
export function extractSocials(html: string): SocialLinks {
  const out = { ...EMPTY_SOCIALS };

  if (!out.instagram) {
    const m = html.match(/(?:https?:\/\/)?(?:[a-z-]+\.)?instagram\.com\/([A-Za-z0-9_.]{2,40})(?:[\/?#"'\s<]|$)/i);
    if (m && !IG_RESERVED.has(m[1].toLowerCase())) out.instagram = `https://instagram.com/${m[1]}`;
  }
  if (!out.facebook) {
    const candidates = html.matchAll(/(?:https?:\/\/)?(?:[a-z-]+\.)?(?:facebook\.com|fb\.com)\/([A-Za-z0-9.\-_]{2,60})(?:[\/?#"'\s<]|$)/gi);
    for (const m of candidates) {
      const seg = m[1];
      if (FB_RESERVED.has(seg.toLowerCase())) continue;
      out.facebook = `https://facebook.com/${seg}`;
      break;
    }
    if (!out.facebook) {
      const mp = html.match(/facebook\.com\/profile\.php\?id=(\d{5,20})/i);
      if (mp) out.facebook = `https://facebook.com/profile.php?id=${mp[1]}`;
    }
    if (!out.facebook) {
      const ml = html.match(/facebook\.com\/(?:pages|people)\/([A-Za-z0-9.\-]+)\/(\d{5,20})/i);
      if (ml) out.facebook = "https://facebook.com/" + ml[1];
    }
  }
  if (!out.tiktok) {
    const m = html.match(/(?:https?:\/\/)?(?:[a-z-]+\.)?tiktok\.com\/@([A-Za-z0-9_.]{1,30})(?:[\/?#"'\s<]|$)/i);
    if (m && !TT_RESERVED.has(m[1].toLowerCase())) out.tiktok = `https://tiktok.com/@${m[1]}`;
  }
  return out;
}

export function hasSocial(s: SocialLinks): boolean {
  return Boolean(s.instagram || s.facebook || s.tiktok);
}

/** Gabungkan hasil ekstraksi beberapa halaman (isi kosong tak menimpa) */
export function mergeSocials(target: SocialLinks, extra: SocialLinks): SocialLinks {
  return {
    instagram: target.instagram || extra.instagram,
    facebook: target.facebook || extra.facebook,
    tiktok: target.tiktok || extra.tiktok,
  };
}

const CONTACT_PATHS = ["/kontak", "/contact", "/kontak-kami", "/hubungi-kami", "/contact-us", "/about", "/profil", "/tentang-kami", "/about-us"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (min: number, max: number) => min + Math.random() * (max - min);

export function isSocialLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return SOCIAL_SKIP.some((s) => host === s || host.endsWith("." + s));
  } catch {
    return true;
  }
}

/** Kandidat halaman kontak internal: anchor/teks menyebut kontak|contact|hubungi|tentang|about|profil.
 *  Link yang benar-benar ada di situs jauh lebih akurat daripada menebak path standar. */
export function extractContactLinks(html: string, origin: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const homePath = new URL(origin).pathname.replace(/\/$/, "");
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    if (!/kontak|contact|hubungi|email|whatsapp|tentang|about|profil|kantor|customer service/.test(text) && !/kontak|contact|about|profil|hubungi|contact-us/i.test(href)) {
      continue;
    }
    try {
      const abs = new URL(href, origin + "/").toString().split("#")[0];
      if (!abs.startsWith(origin)) continue; // hanya halaman internal (bukan sosial/eksternal)
      if (seen.has(abs)) continue;
      // hindari homepage itu sendiri
      const p = new URL(abs).pathname.replace(/\/$/, "");
      if (p === homePath || p === "") continue;
      seen.add(abs);
      out.push(abs);
    } catch {}
    if (out.length >= 3) break;
  }
  return out;
}

/** ekstrak email berkualitas dari HTML; return terurut (mailto dulu, domain cocok diprioritaskan) */
export function extractEmails(html: string, siteHost: string): string[] {
  const found = new Map<string, number>(); // lower → skor
  const add = (email: string, score: number) => {
    const e = email.toLowerCase().replace(/\.$/, "");
    if (ASSET_EXT.test(e)) return;
    const [local, domain] = e.split("@");
    if (!local || !domain) return;
    if (domain.length > 60 || local.length > 50) return;
    if (JUNK_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return;
    if (JUNK_LOCALS.some((l) => local === l || local.startsWith(l + "."))) return;
    // domain harus punya TLD valid-ish (huruf saja, 2-10 char)
    const tld = domain.split(".").pop() ?? "";
    if (!/^[a-z]{2,10}$/.test(tld)) return;
    const prev = found.get(e) ?? 0;
    found.set(e, prev + score);
  };

  let m: RegExpExecArray | null;
  MAILTO_RE.lastIndex = 0;
  while ((m = MAILTO_RE.exec(html))) add(m[1], 3);
  EMAIL_RE.lastIndex = 0;
  while ((m = EMAIL_RE.exec(html))) add(m[0], 1);

  const host = siteHost.replace(/^www\./, "").toLowerCase();
  const ranked = [...found.entries()]
    .map(([e, score]) => {
      const domain = e.split("@")[1];
      const domainMatch = host && (domain === host || host.endsWith(domain) || domain.endsWith(host) || host.split(".")[0] === domain.split(".")[0]) ? 4 : 0;
      return { e, score: score + domainMatch };
    })
    .sort((a, b) => b.score - a.score);
  return ranked.map((r) => r.e).slice(0, 2);
}

async function fetchText(url: string, timeoutMs = 9000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "id,en;q=0.9",
      },
    });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (ct && !/text\/html|text\/plain|application\/xhtml/i.test(ct)) return null;
    const body = await r.text();
    return body.slice(0, 400_000); // batasi 400KB per halaman
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Cari email + sosmed satu website: homepage → halaman kontak internal (link nyata + path umum, maks 4 fetch). */
export async function findEmailsForWebsite(
  website: string
): Promise<{ emails: string[]; socials: SocialLinks; skipped: boolean }> {
  if (isSocialLink(website)) return { emails: [], socials: socialFromUrl(website), skipped: true };

  let host = "";
  let origin = "";
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    host = u.hostname;
    origin = u.origin;
  } catch {
    return { emails: [], socials: { ...EMPTY_SOCIALS }, skipped: true };
  }

  let socials = { ...EMPTY_SOCIALS };

  // 1) homepage
  const home = await fetchText(website.startsWith("http") ? website : `https://${website}`);
  if (home) {
    socials = mergeSocials(socials, extractSocials(home));
    const emails = extractEmails(home, host);
    if (emails.length > 0) return { emails, socials, skipped: false };

    // 2) kumpulkan kandidat halaman kontak: link internal nyata DULU (lebih akurat),
    //    lalu path umum sebagai cadangan — maks 3 fetch tambahan (total 4/situs)
    const candidates: string[] = [];
    const seen = new Set<string>();
    for (const link of extractContactLinks(home, origin)) {
      if (!seen.has(link)) { seen.add(link); candidates.push(link); }
    }
    for (const p of CONTACT_PATHS) {
      const url = origin + p;
      if (!seen.has(url)) { seen.add(url); candidates.push(url); }
    }
    let extra = 0;
    for (const c of candidates) {
      if (extra >= 3) break;
      extra++;
      const html = await fetchText(c, 7000);
      if (html) {
        socials = mergeSocials(socials, extractSocials(html));
        const emails = extractEmails(html, host);
        if (emails.length > 0) return { emails, socials, skipped: false };
      }
    }
  }
  return { emails: [], socials, skipped: false };
}

/** Cari sosmed SATU website dengan budget minim (homepage + maks 1 halaman kontak) —
 *  dipakai saat pemindaian sosmed terpisah (job yang email-nya sudah dipindai). */
export async function findSocialsForWebsite(
  website: string
): Promise<{ socials: SocialLinks; skipped: boolean }> {
  // website-nya sendiri link sosial → langsung, tanpa fetch
  const direct = socialFromUrl(website);
  if (hasSocial(direct)) return { socials: direct, skipped: false };
  if (isSocialLink(website)) {
    // marketplace (shopee/tokopedia/gofood) / wa.me / youtube — bukan kanal IG/FB/TikTok
    const host = (() => { try { return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    // linktr.ee adalah hub link → fetch isinya (IG/FB/TikTok ada di sana)
    if (host !== "linktr.ee" && !host.endsWith(".linktr.ee")) return { socials: { ...EMPTY_SOCIALS }, skipped: true };
  }

  let origin = "";
  let host = "";
  try {
    const u = new URL(website.startsWith("http") ? website : `https://${website}`);
    origin = u.origin;
    host = u.hostname;
  } catch {
    return { socials: { ...EMPTY_SOCIALS }, skipped: true };
  }

  let socials = { ...EMPTY_SOCIALS };
  const home = await fetchText(website.startsWith("http") ? website : `https://${website}`);
  if (home) {
    socials = mergeSocials(socials, extractSocials(home));
    if (hasSocial(socials)) return { socials, skipped: false };
    // coba 1 halaman kontak internal nyata (link paling mungkin)
    const link = extractContactLinks(home, origin)[0];
    if (link) {
      const html = await fetchText(link, 7000);
      if (html) socials = mergeSocials(socials, extractSocials(html));
    }
  }
  void host;
  return { socials, skipped: false };
}

/** Jalankan pencarian email paralel utk daftar website dengan callback progres */
export async function scanEmails<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  const run = async (id: number) => {
    if (id > 0) await sleep(500 * id); // stagger
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i]);
      await sleep(rnd(250, 600));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, (_, w) => run(w)));
}
