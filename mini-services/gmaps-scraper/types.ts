// Tipe data utama untuk Google Maps scraper service

export type LeadStatus = "baru" | "dihubungi" | "prospek" | "deal" | "tidak-tertarik";

export interface PlaceHours {
  day: string;   // e.g. "Senin"
  time: string;  // e.g. "10.00–22.00"
}

export interface Place {
  cid: string;            // Google CID (0x...:0x...)
  placeId: string;        // ChIJ...
  kgid: string;           // /g/...
  name: string;
  categories: string[];   // e.g. ["Tempat Cukur Rambut"]
  fullAddress: string;
  shortAddress: string;   // e.g. "Jl. MT. Haryono No.27"
  desa: string;           // desa/kelurahan
  kecamatan: string;
  kabupaten: string;      // kabupaten/kota
  provinsi: string;
  postalCode: string;
  plusCode: string;       // e.g. "CQX8+QXJ"
  area: string;           // e.g. "Sukamelang, Kecamatan Subang"
  phone: string;          // format lokal 0878-...
  phoneIntl: string;      // +62 878-...
  phoneDigits: string;    // 087857666655
  website: string;
  email: string;          // ditemukan via pemindaian website ("a@b.com; c@d.com" maks 2)
  emailStatus: "none" | "pending" | "found" | "not-found" | "skipped" | "error";
  instagram: string;      // https://instagram.com/toko — ditemukan dari website / link Google Maps
  facebook: string;       // https://facebook.com/toko
  tiktok: string;         // https://tiktok.com/@toko
  socialStatus: "none" | "pending" | "found" | "not-found" | "skipped" | "error";
  rating: number | null;
  reviewsCount: number | null;
  hours: PlaceHours[];
  hoursText: string;      // "Senin: 10.00–22.00; Selasa: ..."
  lat: number | null;
  lng: number | null;
  mapsUrl: string;
  businessStatus: string; // "Operasional" | "Tutup Permanen" | ""
  timezone: string;
  detailStatus: "pending" | "ok" | "failed";
  sourceQuery: string;
  foundAt: string;
  // ---- manajemen prospek (lead) — diperbarui pengguna, bukan dari Google ----
  leadStatus: LeadStatus;
  leadNote: string;
  leadUpdatedAt: number | null;
  // ---- verifikasi WhatsApp (v10.3): true = nomor terdaftar WA, false = tidak, null = belum dicek ----
  waOk?: boolean | null;
}

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobVariant {
  query: string;
  url: string;
  zoomLevel: number | null;
  placesFound: number;
  isQuadrant: boolean;
}

export interface JobLog {
  t: number;
  level: "info" | "success" | "warn" | "error";
  msg: string;
}

export interface JobStats {
  total: number;
  withPhone: number;
  withWebsite: number;
  withEmail: number;
  withSocial: number;
  withRating: number;
  avgRating: number | null;
  withHours: number;
  quadrants: number;
  variantsRun: number;
}

export interface ScrapeJob {
  id: string;
  keyword: string;         // display (untuk batch: "a, b, c")
  city: string;
  keywords?: string[];     // batch: beberapa kata kunci dalam satu job (pencarian bergantian + dedup)
  deepMode: boolean;
  minReviews?: number;     // filter: tempat dengan ulasan < nilai ini tidak diambil (0/undefined = ambil semua)
  requireWa?: boolean;     // filter: hanya simpan tempat dengan nomor WhatsApp aktif (dicek via render halaman WhatsApp)
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  progress: {
    phase: string;        // deskripsi fase saat ini (Bahasa Indonesia)
    percent: number;      // 0-100
    searchDone: number;   // jumlah variant search selesai
    searchTotal: number;  // total variant yang direncanakan (dinamis)
    detailsDone: number;
    detailsTotal: number;
  };
  variants: JobVariant[];
  logs: JobLog[];
  places: Place[];
  stats: JobStats;
  resolvedArea: string | null; // area yang dikenali Google untuk query kota
}

export interface ServiceStats {
  jobsTotal: number;
  jobsCompleted: number;
  placesScraped: number;
  browserPages: number;
  uptime: number;
  version?: string; // versi engine (untuk deteksi engine lama dari UI)
}
