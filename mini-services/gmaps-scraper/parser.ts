// Parser payload RPC Google Maps (format protobuf-JSON)
// Pola respons: {"c":0,"d":")]}'\n[...json...]"} atau langsung )]}'\n[...json...]

import type { Place, PlaceHours } from "./types";

/** Cari indeks akhir objek JSON berawal di posisi awal — depth-counting yang
 *  menghormati string (escape \") agar "}" di dalam nilai string tidak salah
 *  dianggap penutup. Respons Google ({"c":0,"d":"..."}) memuat tanda kurung
 *  di dalam string ter-escape, sehingga indexOf("}") biasa gagal. */
function findJsonObjectEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parse body respons tbm=map / preview/place menjadi JSON mentah */
export function parseTbmBody(body: string): any[] {
  let payload = body;
  if (payload.startsWith('{"c":')) {
    // envelope chunked: ambil field "d" — batas objek dicari dengan depth-counting
    const end = findJsonObjectEnd(payload, 0);
    const obj = JSON.parse(payload.slice(0, end + 1));
    payload = obj.d ?? "";
  }
  if (payload.startsWith(")]}'")) payload = payload.slice(4);
  payload = payload.trim();
  return JSON.parse(payload);
}

function asArr(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function asStr(v: any): string {
  return typeof v === "string" ? v : "";
}

function asNum(v: any): number | null {
  return typeof v === "number" && isFinite(v) ? v : null;
}

const PROVINCE_RE = /^(jawa|kalimantan|sulawesi|sumatera|sumatra|bali|ntt|ntb|nusa tenggara|papua|maluku|aceh|banten|jakarta|daerah khusus ibu kota|yogyakarta|di yogyakarta|riau|jambi|bengkulu|lampung|bangka belitung|kepulauan riau|bangka|gorontalo)/i;

/**
 * Klasifikasi token alamat Indonesia.
 * Masukan: daftar komponen (mungkin mengandung koma: "Kec. Subang, Kabupaten Subang, Jawa Barat 41211")
 * Keluaran: { desa, kecamatan, kabupaten, provinsi, postal }
 */
function classifyAddressParts(parts: string[]): { desa: string; kecamatan: string; kabupaten: string; provinsi: string; postal: string } {
  const out = { desa: "", kecamatan: "", kabupaten: "", provinsi: "", postal: "" };
  // pecah semua menjadi token atomik
  const tokens = parts.flatMap((s) => String(s).split(",")).map((t) => t.trim()).filter(Boolean);
  for (let raw of tokens) {
    let tok = raw;
    // ekstrak kode pos bila menempel (mis. "Jawa Barat 41211")
    if (!out.postal) {
      const pm = tok.match(/\b(\d{5})\b/);
      if (pm) {
        out.postal = pm[1];
        tok = tok.replace(/\b\d{5}\b/, "").replace(/[,\s]+$/, "").trim();
        if (!tok) continue;
      }
    }
    if (PLUS_TOKEN_RE.test(tok)) continue; // plus code ditangani pemanggil
    if (!out.kecamatan && /^(kec\.|kecamatan)\s/i.test(tok)) {
      out.kecamatan = tok.replace(/^(kec\.|kecamatan)\s*/i, "").trim() || tok;
      continue;
    }
    if (!out.kabupaten && /^(kabupaten|kota|kab\.|kab )/i.test(tok)) {
      out.kabupaten = tok;
      continue;
    }
    if (!out.provinsi && PROVINCE_RE.test(tok)) {
      out.provinsi = tok;
      continue;
    }
    if (!out.desa) {
      out.desa = tok;
      continue;
    }
    if (!out.kecamatan) {
      out.kecamatan = tok.replace(/^(kec\.|kecamatan)\s*/i, "").trim() || tok;
      continue;
    }
    if (!out.kabupaten) {
      out.kabupaten = tok;
      continue;
    }
  }
  return out;
}

// penanda agar token plus code dilewati di classifyAddressParts
const PLUS_TOKEN_RE = /^[0-9A-Z]{2,4}\+[0-9A-Z]{2,3}$/;

/**
 * Parse alamat lengkap Google Maps Indonesia:
 * "Jl. X No.1, Desa, Kec. Y, Kabupaten Z, Jawa Barat 12345"
 * Bisa diawali plus code: "CQX8+QXJ, Sukamelang, Kec. Subang, ..."
 * Urutan token: [plusCode?] street? desa? kecamatan kabupaten provinsi? postal?
 */
export function parseFullAddress(addr: string): {
  plusCode: string; street: string; desa: string; kecamatan: string;
  kabupaten: string; provinsi: string; postal: string;
} {
  const out = { plusCode: "", street: "", desa: "", kecamatan: "", kabupaten: "", provinsi: "", postal: "" };
  if (!addr) return out;
  let tokens = addr.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return out;

  // plus code di awal
  if (PLUS_TOKEN_RE.test(tokens[0])) {
    out.plusCode = tokens[0];
    tokens = tokens.slice(1);
  }

  // jalan masuk ke bagian provinsi+kodepos (dari belakang)
  for (let i = tokens.length - 1; i >= 0 && i >= tokens.length - 2; i--) {
    const tok = tokens[i];
    const pm = tok.match(/\b(\d{5})\b/);
    if (pm && !out.postal) {
      out.postal = pm[1];
      const rest = tok.replace(/\b\d{5}\b/, "").replace(/[,\s]+$/, "").trim();
      if (rest && !out.provinsi && PROVINCE_RE.test(rest)) { out.provinsi = rest; tokens.splice(i, 1); continue; }
      if (rest) tokens[i] = rest;
      continue;
    }
    if (!out.provinsi && PROVINCE_RE.test(tok)) { out.provinsi = tok; tokens.splice(i, 1); continue; }
  }

  // sisa token dari depan: street, desa, kecamatan, kabupaten
  const restTokens = tokens.filter(Boolean);
  let idx = 0;
  // street: token pertama bila terlihat seperti alamat jalan/patokan
  const STREET_RE = /^(jl\.|jln\.|jalan|gg\.|gang|no\.|nomor|depan\s|seberang\s|sebrang\s|spbu|komplek|perum|rt\.|rw\.|lt\.|blok|kp\.|dusun|kampung)/i;
  if (restTokens.length > 0 && STREET_RE.test(restTokens[0])) {
    out.street = restTokens[0];
    idx = 1;
  }
  for (; idx < restTokens.length; idx++) {
    const t = restTokens[idx];
    if (!out.kecamatan && /^(kec\.|kecamatan)\s?/i.test(t)) {
      out.kecamatan = t.replace(/^(kec\.|kecamatan)\s*/i, "").trim() || t;
      continue;
    }
    if (!out.kabupaten && /^(kabupaten|kota|kab\.|kab )/i.test(t)) {
      out.kabupaten = t;
      continue;
    }
    if (!out.provinsi && PROVINCE_RE.test(t)) { out.provinsi = t; continue; }
    if (!out.desa) { out.desa = t; continue; }
    if (!out.kecamatan) { out.kecamatan = t.replace(/^(kec\.|kecamatan)\s*/i, "").trim() || t; continue; }
    if (!out.kabupaten) { out.kabupaten = t; continue; }
  }
  return out;
}

/** Parse komponen alamat Indonesia: "Kabupaten Subang, Jawa Barat 41211" (dipakai untuk region string mandiri) */
function parseRegionParts(s: string): { kabupaten: string; provinsi: string; postal: string } {
  if (!s) return { kabupaten: "", provinsi: "", postal: "" };
  const r = classifyAddressParts([s]);
  return { kabupaten: r.kabupaten, provinsi: r.provinsi, postal: r.postal };
}

const PLUS_CODE_RE = /^[0-9A-Z]{2,4}\+[0-9A-Z]{2,3}(?![0-9])/;

/** Ekstrak data place dari entri list response (data[64][i][1]) */
export function parsePlaceFromList(entryPlace: any, sourceQuery: string): Place | null {
  const p = asArr(entryPlace);
  if (!p || p.length < 12) return null;

  const name = asStr(p[11]);
  const cid = asStr(p[10]);
  if (!name || !cid) return null;

  // alamat lengkap p[39]: "Jl. X No.1, Desa, Kec. Y, Kabupaten Z, Provinsi 12345" (bisa diawali plus code)
  const fullAddress = asStr(p[39]);
  const geo = parseFullAddress(fullAddress);
  const plusCode = geo.plusCode;
  const shortAddress = geo.street;
  const desa = geo.desa;
  const kecamatan = geo.kecamatan;
  const region = { kabupaten: geo.kabupaten, provinsi: geo.provinsi, postal: geo.postal };

  const ratingArr = asArr(p[4]);
  const rating = asNum(ratingArr[7]);
  const reviewsCount = asNum(ratingArr[8]);

  const coords = asArr(p[9]);
  const lat = asNum(coords[2]);
  const lng = asNum(coords[3]);

  const placeId = asStr(p[78]);
  const hours: PlaceHours[] = [];
  const hoursRaw = asArr(p[203]);
  if (Array.isArray(hoursRaw[0])) {
    for (const d of hoursRaw[0]) {
      const day = asStr(d?.[0]);
      const times = asArr(d?.[3]);
      const timeStr = times.length > 0 && Array.isArray(times[0]) ? asStr(times[0][0]) : "";
      if (day) hours.push({ day, time: timeStr });
    }
  }

  const place: Place = {
    cid,
    placeId,
    kgid: asStr(p[89]),
    name,
    categories: asArr(p[13]).map((x) => asStr(x)).filter(Boolean),
    fullAddress,
    shortAddress: shortAddress || asStr(p[82]?.[1]) || asStr(p[82]?.[2]) || "",
    desa,
    kecamatan,
    kabupaten: region.kabupaten,
    provinsi: region.provinsi,
    postalCode: region.postal,
    plusCode,
    area: asStr(p[14]),
    phone: "",
    phoneIntl: "",
    phoneDigits: "",
    website: "",
    email: "",
    emailStatus: "none",
    instagram: "",
    facebook: "",
    tiktok: "",
    socialStatus: "none",
    rating,
    reviewsCount,
    hours,
    hoursText: hours.map((h) => `${h.day}: ${h.time}`).join("; "),
    lat,
    lng,
    mapsUrl: placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : `https://www.google.com/maps/search/${encodeURIComponent(name)}`,
    businessStatus: "",
    timezone: asStr(p[30]),
    detailStatus: "pending",
    sourceQuery,
    foundAt: new Date().toISOString(),
    leadStatus: "baru",
    leadNote: "",
    leadUpdatedAt: null,
  };
  return place;
}

/** Ambil semua place unik dari body respons list (tbm=map) */
export function extractPlacesFromListBody(body: string, sourceQuery: string): { places: Place[]; viewport: [number, number, number] | null } {
  const out: Place[] = [];
  let viewport: [number, number, number] | null = null;
  let data: any;
  try {
    data = parseTbmBody(body);
  } catch {
    return { places: out, viewport };
  }
  if (!Array.isArray(data)) return { places: out, viewport };
  // viewport: data[1] = [d, lng, lat] atau [[d, lng, lat], ...]
  const vpRaw = data[1];
  if (Array.isArray(vpRaw)) {
    const v = Array.isArray(vpRaw[0]) ? vpRaw[0] : vpRaw;
    if (typeof v[0] === "number" && typeof v[1] === "number" && typeof v[2] === "number") {
      viewport = [v[0], v[1], v[2]];
    }
  }
  const container = data[64];
  if (!Array.isArray(container)) return { places: out, viewport };
  for (const entry of container) {
    if (Array.isArray(entry) && entry.length > 1 && Array.isArray(entry[1])) {
      const place = parsePlaceFromList(entry[1], sourceQuery);
      if (place) out.push(place);
    }
  }
  return { places: out, viewport };
}

/** Jumlah ulasan dari array rating — angka langsung (idx 8), atau fallback teks
 *  "N ulasan" (varian respons kompakt kadang hanya membawa labelnya, cth
 *  "114 ulasan" / "1.234 ulasan" di array tautan ulasan). */
function reviewsFromRatingArr(ratingArr: any[]): number | null {
  const direct = asNum(ratingArr[8]);
  if (direct != null) return direct;
  const texts: string[] = [];
  const collect = (node: any, depth: number): void => {
    if (depth > 6 || texts.length > 10) return;
    if (typeof node === "string") { if (/[\d.,]+\s*(ulasan|reviews)/i.test(node)) texts.push(node); return; }
    if (Array.isArray(node)) for (const c of node) collect(c, depth + 1);
  };
  collect(ratingArr, 0);
  for (const t of texts) {
    const m = t.match(/([\d.,]+)\s*(?:ulasan|reviews)/i);
    if (m) {
      const n = Number(m[1].replace(/\./g, "").replace(/,/g, ""));
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  return null;
}

/** Parse data detail place dari body respons /maps/preview/place (data[6]) */
export function parsePlaceDetail(body: string): Partial<Place> | null {
  let data: any;
  try {
    data = parseTbmBody(body);
  } catch {
    return null;
  }
  const p = Array.isArray(data) ? asArr(data[6]) : null;
  if (!p || p.length < 12) return null;

  const name = asStr(p[11]);
  if (!name) return null;

  // phone: p[178][0]
  let phone = "", phoneIntl = "", phoneDigits = "";
  const phoneArr = asArr(p[178]);
  if (Array.isArray(phoneArr[0])) {
    phone = asStr(phoneArr[0][0]);
    phoneDigits = asStr(phoneArr[0][3]) || phone.replace(/[^\d]/g, "");
    const variants = asArr(phoneArr[0][1]);
    for (const v of variants) {
      if (Array.isArray(v) && v[1] === 2 && typeof v[0] === "string") phoneIntl = v[0];
    }
    if (!phoneIntl) phoneIntl = phone;
  }

  // hours: p[203][0]
  const hours: PlaceHours[] = [];
  const hoursRaw = asArr(p[203]);
  if (Array.isArray(hoursRaw[0])) {
    for (const d of hoursRaw[0]) {
      const day = asStr(d?.[0]);
      const times = asArr(d?.[3]);
      const timeStr = times.length > 0 && Array.isArray(times[0]) ? asStr(times[0][0]) : "";
      if (day) hours.push({ day, time: timeStr });
    }
  }

  // business status: cari field string status
  let businessStatus = "";
  const statusCandidates = [asStr(p[154]?.[0]), asStr(p[88]?.[0]), asStr(p[153]?.[0])];
  for (const s of statusCandidates) {
    if (s && /tutup permanen|permanently closed/i.test(s)) { businessStatus = "Tutup Permanen"; break; }
    if (s && /operasional|operational/i.test(s)) { businessStatus = "Operasional"; break; }
  }

  const ratingArr = asArr(p[4]);
  const fullAddress = asStr(p[39]);
  const geo = parseFullAddress(fullAddress);
  // website: p[7] bisa string langsung atau array [url, domain, ...]
  let website = "";
  const webRaw = p[7];
  if (typeof webRaw === "string" && webRaw.startsWith("http")) website = webRaw;
  else if (Array.isArray(webRaw) && typeof webRaw[0] === "string" && webRaw[0].startsWith("http")) website = webRaw[0];

  return {
    name,
    fullAddress,
    shortAddress: geo.street || asStr(p[82]?.[1]) || asStr(p[82]?.[2]) || "",
    desa: geo.desa,
    kecamatan: geo.kecamatan,
    kabupaten: geo.kabupaten,
    provinsi: geo.provinsi,
    postalCode: geo.postal,
    plusCode: geo.plusCode,
    phone,
    phoneIntl,
    phoneDigits,
    website,
    rating: asNum(ratingArr[7]),
    reviewsCount: reviewsFromRatingArr(ratingArr),
    hours,
    hoursText: hours.map((h) => `${h.day}: ${h.time}`).join("; "),
    timezone: asStr(p[30]),
    businessStatus,
    detailStatus: "ok",
  };
}
