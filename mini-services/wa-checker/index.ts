// Layanan verifikasi WhatsApp terpisah (port 3004) — ISOLASI penuh dari engine.
//
// Alasan arsitektur: modul Baileys + Chromium dalam SATU proses Bun terbukti bisa
// menyebabkan crash native senyap (engine mati tanpa stack). Dengan layanan terpisah:
//   - crash di sini tidak menjatuhkan engine/aplikasi (watchdog menyalakan ulang)
//   - pemeriksaan protokol resmi tetap tersedia saat sesi terhubung (pairing sekali)
//
// Endpoint:
//   GET  /health            → { ok, status, phone, pairingCode, pairingPhone }
//   POST /pair  {phone}     → { ok, code }
//   POST /unpair            → { ok }
//   POST /check {numbers[]} → { available, results: { digit62: true|false|null } }
//                             (available=false bila sesi tidak terhubung)
//   POST /send  {number, message, typing?} → { ok, id } — kirim SATU pesan teks (pacing diatur pemanggil);
//                 typing=true → tampilkan status "mengetik…" manusiawi sebelum pesan terkirim

import { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from "@whiskeysockets/baileys";
import { rmSync } from "node:fs";
import path from "node:path";

const PORT = 3004;
const AUTH_DIR = path.join(import.meta.dir, "wa-auth");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type S = "disconnected" | "connecting" | "pairing" | "connected";
interface St {
  sock: any | null;
  status: S;
  phone: string | null;
  pairingCode: string | null;
  pairingPhone: string | null;
  failedAttempts: number;
  connectingSince: number;
  nextRetryAt: number;
}
const st: St = {
  sock: null, status: "disconnected", phone: null,
  pairingCode: null, pairingPhone: null, failedAttempts: 0, connectingSince: 0, nextRetryAt: 0,
};

const jidToPhone = (jid: string | undefined | null): string | null =>
  jid ? jid.split("@")[0].split(":")[0] || null : null;

function wipeAuth() {
  try { st.sock?.end?.(); } catch {}
  st.sock = null;
  st.status = "disconnected";
  st.phone = null;
  st.pairingCode = null;
  st.pairingPhone = null;
  st.failedAttempts = 0;
  st.connectingSince = 0;
  st.nextRetryAt = 0;
  try { rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
  console.log("sesi lama tidak valid — auth dibersihkan, siap pairing baru");
}

/** Koneksi tersangkut lama di "connecting" (socket diam tanpa event — network
 *  black hole) ≠ sesi mati. Hanya SOCKET-nya yang diputus agar bisa disambung
 *  ulang; AUTH DIPERTAHANKAN. Menghapus auth hanya karena koneksi macet adalah
 *  penyebab "WhatsApp keluar sendiri" padahal pengguna tidak pernah logout. */
function isStuck(): boolean {
  if (st.status === "connected") return false;
  return st.status === "connecting" && st.connectingSince > 0 && Date.now() - st.connectingSince > 60_000;
}

/** Putuskan socket yang macet TANPA menghapus sesi. */
function dropStuckSocket() {
  try { st.sock?.end?.(); } catch {}
  st.sock = null;
  st.status = "disconnected";
  st.connectingSince = 0;
  console.log("koneksi tersangkut — socket diputus (sesi dipertahankan), coba ulang");
}

async function ensureSocket(): Promise<any> {
  if (st.sock) return st.sock;
  const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version: [number, number, number] | undefined;
  try {
    const vres = await fetchLatestBaileysVersion();
    version = vres.version as [number, number, number];
  } catch {}

  const sock = makeWASocket({
    version,
    auth,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // PENTING: deklarasi platform desktop RESMI — server WhatsApp menolak kode
    // pairing ("gagal menautkan") bila nama platform tidak dikenal (mis. "MapMiner").
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });
  st.sock = sock;
  st.status = "connecting";
  st.connectingSince = Date.now();

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", ({ connection, lastDisconnect }: any) => {
    // Abaikan event dari socket yang sudah diganti — race saat pairing ulang:
    // close-nya datang terlambat dan tidak boleh menghapus socket baru.
    if (sock !== st.sock) return;
    if (connection === "open") {
      st.status = "connected";
      st.phone = jidToPhone(sock.user?.id);
      st.pairingCode = null;
      st.pairingPhone = null;
      st.failedAttempts = 0;
      st.connectingSince = 0;
      st.nextRetryAt = 0;
      console.log(`terhubung sebagai +${st.phone}`);
    } else if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      st.sock = null;
      st.status = "disconnected";
      st.connectingSince = 0;
      if (loggedOut) {
        // SATU-SATUNYA kondisi penghapusan sesi: server WhatsApp sendiri yang
        // melepas perangkat ini (perangkat tertaut dilepas dari ponsel / akun
        // didaftarkan ulang). Selain ini sesi TIDAK PERNAH dihapus.
        console.log("sesi dilogout dari server — auth dibersihkan");
        try { rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
        st.phone = null;
        st.pairingCode = null;
        st.pairingPhone = null;
        st.failedAttempts = 0;
        st.nextRetryAt = 0;
      } else if (st.pairingCode) {
        // jendela pairing berakhir (kode kedaluwarsa / koneksi ditutup server) —
        // kode yang tampil sudah MATI: bersihkan agar UI tidak menampilkannya lagi
        console.log("jendela pairing berakhir — kode dibersihkan, minta kode baru");
        st.pairingCode = null;
        st.pairingPhone = null;
        st.failedAttempts = 0;
        st.nextRetryAt = 0;
      } else {
        // Gangguan jaringan (WiFi drop, laptop tidur, server sibuk, ganti IP)
        // BUKAN alasan menghapus sesi — coba ulang dengan jeda makin panjang.
        st.failedAttempts++;
        st.nextRetryAt = Date.now() + Math.min(30_000, 2_000 * st.failedAttempts);
        console.log(`terputus (kode ${code ?? "?"}) — sesi dipertahankan, ulang dalam ${Math.round((st.nextRetryAt - Date.now()) / 1000)} dtk`);
      }
    }
  });
  return sock;
}

const toDigits = (raw: string): string | null => {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("62")) return d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("8")) return "62" + d;
  return d;
};

async function pair(phoneRaw: string): Promise<string> {
  const digits = String(phoneRaw ?? "").replace(/\D/g, "");
  const norm = toDigits(digits);
  if (!norm || norm.length < 9) throw new Error("Nomor tidak valid");
  // sesi lama harus diganti: akhiri socket lama, bersihkan auth
  try { st.sock?.end?.(); } catch {}
  st.sock = null;
  st.status = "disconnected";
  st.pairingCode = null;
  st.pairingPhone = null;
  try { rmSync(AUTH_DIR, { recursive: true, force: true }); } catch {}
  const sock = await ensureSocket();
  // tunggu koneksi WebSocket benar-benar terbuka (maks 12 dtk)
  for (let i = 0; i < 24; i++) {
    if ((sock as any)?.ws?.readyState === 1) break;
    await sleep(500);
  }
  // beri waktu handshake registrasi selesai — kode yang diminta terlalu awal
  // akan ditolak ponsel ("gagal menautkan")
  await sleep(3500);
  const code = await sock.requestPairingCode(norm);
  st.pairingCode = code;
  st.pairingPhone = norm;
  st.status = "pairing";
  console.log(`kode pairing utk +${norm}: ${code}`);
  return code;
}

async function unpair(): Promise<void> {
  try { st.sock?.logout?.(); } catch {}
  wipeAuth();
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    const J = (data: any, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    if (isStuck()) dropStuckSocket();

    if (path === "/health" && method === "GET") {
      // dorong koneksi saat health dipoll UI (agar auto-reconnect jalan);
      // hormati jeda ulang (backoff) agar tidak menghantam server saat bermasalah
      if (st.status === "disconnected" && !st.sock && Date.now() >= st.nextRetryAt) { void ensureSocket().catch(() => {}); }
      const status =
        st.status === "connected" ? "connected"
        : st.status === "pairing" || st.pairingCode ? "pairing"
        : st.status === "connecting" ? "connecting"
        : "disconnected";
      return J({ ok: true, status, phone: st.phone, pairingCode: st.pairingCode, pairingPhone: st.pairingPhone, mode: st.status === "connected" ? "baileys-protocol" : "web-render" });
    }

    if (path === "/pair" && method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      try {
        const code = await pair(String(body?.phone ?? ""));
        return J({ ok: true, code });
      } catch (e: any) {
        return J({ ok: false, error: e?.message ?? String(e) }, 500);
      }
    }

    if (path === "/unpair" && method === "POST") {
      await unpair();
      return J({ ok: true });
    }

    if (path === "/check" && method === "POST") {
      if (st.status !== "connected" || !st.sock) return J({ ok: true, available: false, results: {} });
      const body = await req.json().catch(() => ({} as any));
      const numbers: string[] = Array.isArray(body?.numbers) ? body.numbers.map(String) : [];
      if (numbers.length === 0) return J({ ok: true, available: true, results: {} });
      const uniq: string[] = [];
      for (const raw of numbers) {
        const d = toDigits(raw);
        if (d && !uniq.includes(d)) uniq.push(d);
      }
      const results: Record<string, boolean | null> = {};
      const CHUNK = 30;
      for (let i = 0; i < uniq.length; i += CHUNK) {
        const chunk = uniq.slice(i, i + CHUNK);
        try {
          const res: { exists: boolean; jid: string }[] = await st.sock.onWhatsApp(...chunk);
          const byJid = new Map<string, boolean>();
          for (const r of res) {
            const p = jidToPhone(r.jid);
            if (p) byJid.set(p, r.exists === true);
          }
          for (const d of chunk) results[d] = byJid.get(d) ?? false;
        } catch (e: any) {
          // sesi yang baru terpasang kadang belum siap menerima queri — tunggu
          // sebentar lalu coba ulang sekali sebelum menyerah (null = tak pasti)
          console.log(`queri batch gagal (${e?.message ?? e}) — tunggu 3 dtk lalu ulangi…`);
          await sleep(3000);
          try {
            const res: { exists: boolean; jid: string }[] = await st.sock.onWhatsApp(...chunk);
            const byJid = new Map<string, boolean>();
            for (const r of res) {
              const p = jidToPhone(r.jid);
              if (p) byJid.set(p, r.exists === true);
            }
            for (const d of chunk) results[d] = byJid.get(d) ?? false;
          } catch (e2: any) {
            console.log(`queri batch gagal lagi (${e2?.message ?? e2}) — tandai tak pasti (null)`);
            for (const d of chunk) results[d] = null; // jangan buang data karena kegagalan queri
          }
        }
        await sleep(300 + Math.random() * 400);
      }
      return J({ ok: true, available: true, results });
    }

    if (path === "/send" && method === "POST") {
      if (st.status !== "connected" || !st.sock) return J({ ok: false, error: "WhatsApp belum terhubung" }, 400);
      const body = await req.json().catch(() => ({} as any));
      const d = toDigits(String(body?.number ?? ""));
      const message = String(body?.message ?? "");
      const simulateTyping = Boolean(body?.typing);
      if (!d || d.length < 9) return J({ ok: false, error: "Nomor tidak valid" }, 400);
      if (!message.trim()) return J({ ok: false, error: "Pesan kosong" }, 400);
      try {
        const jid = `${d}@s.whatsapp.net`;
        if (simulateTyping) {
          // simulasi mengetik manusiawi: status "mengetik…" tampil selama durasi yang
          // menyesuaikan panjang pesan (acak); diperbarui tiap ±4 dtk agar indikator
          // tidak mati sebelum pesan dikirim. Gagal simulasi TIDAK membatalkan kirim.
          // Pangkas maks 10 dtk — mengetik 20 dtk per pesan menambah jeda nyata
          // di luar pengaturan pengguna tanpa manfaat tambahan yang berarti.
          const totalMs = Math.min(10_000, 800 + message.length * (20 + Math.random() * 20));
          try {
            const bursts = Math.max(1, Math.ceil(totalMs / 4000));
            await st.sock.sendPresenceUpdate("composing", jid);
            for (let i = 0; i < bursts; i++) {
              await sleep(Math.min(4000, totalMs - i * 4000));
              if (i < bursts - 1) await st.sock.sendPresenceUpdate("composing", jid);
            }
            await st.sock.sendPresenceUpdate("paused", jid);
          } catch (e: any) {
            console.log(`simulasi mengetik ke ${d} gagal (lanjut kirim): ${e?.message ?? e}`);
          }
        }
        const res: any = await st.sock.sendMessage(jid, { text: message });
        return J({ ok: true, id: res?.key?.id ?? null, jid });
      } catch (e: any) {
        console.log(`kirim ke ${d} gagal: ${e?.message ?? e}`);
        return J({ ok: false, error: e?.message ?? String(e) }, 502);
      }
    }

    return J({ ok: false, error: "Endpoint tidak ditemukan" }, 404);
  },
});

console.log(`✅ wa-checker service berjalan di http://localhost:${PORT} (sesi WhatsApp terpisah)`);

// Koneksi ulang otomatis: sesi yang putus (non-logout) disambung kembali sendiri
// agar layanan selalu siap memeriksa tanpa menunggu poll /health dari UI.
// Sesi TIDAK PERNAH dihapus di sini — pair ulang hanya bila server benar-benar
// melepas perangkat (loggedOut) atau pengguna memutuskan sendiri via /unpair.
// Pairing yang sedang menunggu scan tidak disentuh.
setInterval(() => {
  if (st.status === "connected" || st.sock || st.pairingCode) return;
  if (Date.now() < st.nextRetryAt) return;
  try { void ensureSocket().catch(() => {}); } catch {}
}, 15_000);
