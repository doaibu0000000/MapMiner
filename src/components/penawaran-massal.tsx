"use client";

// ---------- Halaman Penawaran Massal ----------
// Kirim penawaran WhatsApp berurutan ke tempat hasil scraping (Cari Prospek).
// Pacing (jeda acak antar pesan) diatur di sisi UI agar bisa dijeda/dihentikan
// kapan pun; satu pesan = satu panggilan POST /api/scraper/wa/send.

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Pause, Play, Square, FastForward, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Clock, RotateCcw,
  FileSpreadsheet, Upload, Trash2, Sheet, ChevronRight, X,
} from "lucide-react";
import { WhatsAppIcon } from "@/components/whatsapp-icon";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  buildRecipientsFromSheet, parseFileToSheet, toDigits62, tokensFromHeaders,
  type Recipient, type SheetSource,
} from "@/lib/spreadsheet";
import SheetEditorDialog from "@/components/sheet-editor-dialog";

// ---------- tipe ----------
// Recipient & SheetSource didefinisikan di @/lib/spreadsheet

interface SendLog {
  t: number;
  name: string;
  phone: string; // tampilan +62…
  ok: boolean;
  msg: string;
}

// ---------- util ----------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtPhone = (d: string) => (d ? `+${d}` : "-");

/** Nilai input angka bebas diketik/dihapus saat fokus; dibatasi min–maks saat
 *  keluar fokus. Kosong/tidak valid → kembali ke batas minimum. */
const clampInputNum = (raw: string, min: number, max: number): string => {
  const n = Math.floor(Number(raw));
  if (raw.trim() === "" || Number.isNaN(n)) return String(min);
  return String(Math.min(max, Math.max(min, n)));
};
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const fmtDur = (s: number) => {
  const j = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const d = s % 60;
  if (j > 0) return `${j} j ${m} mnt`;
  if (m > 0) return `${m} mnt ${d} dtk`;
  return `${d} dtk`;
};

/** Parsing daftar nomor dari textarea: pisah per baris/koma/spasi, normalisasi,
 *  dedup. Tanpa batas di sini — batas 50 diterapkan pada antrian setelah filter
 *  "lewati yang sudah terkirim", agar lanjut ke 50 berikutnya tanpa edit daftar. */
function parseNumbers(raw: string): { all: Recipient[]; dup: number; invalid: number } {
  const tokens = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: Recipient[] = [];
  let dup = 0;
  let invalid = 0;
  for (const t of tokens) {
    const d = toDigits62(t);
    if (d.length < 8 || d.length > 15) { invalid++; continue; }
    if (seen.has(d)) { dup++; continue; }
    seen.add(d);
    out.push({ jobId: "", cid: "", name: "", phoneDigits: d, kota: "", kategori: "", alamat: "", website: "", fields: {} });
  }
  return { all: out, dup, invalid };
}

function renderTemplate(tpl: string, r: Recipient): string {
  // placeholder dinamis {<nama kolom>} — nilainya dari baris file ini
  let out = tpl;
  for (const [h, v] of Object.entries(r.fields ?? {})) {
    out = out.replaceAll(`{${h}}`, v || "-");
  }
  // token lama tetap dipakai agar template tersimpan sebelumnya tidak rusak
  return out
    .replaceAll("{nama}", r.name || "-")
    .replaceAll("{kota}", r.kota || "-")
    .replaceAll("{kategori}", r.kategori || "-")
    .replaceAll("{alamat}", r.alamat || "-")
    .replaceAll("{website}", r.website || "-");
}

const DEFAULT_TEMPLATE =
  "*Assalamualaikum Kak, perkenalkan saya Agung. Izin, saya tadi menemukan {Bisnis} dari Google Maps.*\n\n" +
  "Saya sedang membantu beberapa bisnis agar calon pelanggan dari Google bisa langsung melihat informasi layanan dan menghubungi WhatsApp dalam satu halaman.\n\n" +
  "Saya lihat {Bisnis} punya peluang untuk dibuatkan halaman seperti itu agar informasi bisnisnya lebih mudah diakses calon pelanggan.";
// v5: paragraf pembuka dibungkus *…* — format tebal WhatsApp (klien WA yang
// me-render-nya tebal). Kunci LS dinaikkan agar template lama yang tersimpan
// tidak menimpa default baru.
const LS_TEMPLATE = "mapminer_penawaran_template_v5";

// pesan lanjutan: dikirim ke chat yang sama beberapa detik setelah pesan pertama
const DEFAULT_FOLLOW_UP = "Saya sudah ada gambaran tampilannya untuk {Bisnis}. Boleh saya kirim contohnya, Kak?";
const LS_FOLLOW_UP = "mapminer_penawaran_followup_v3";
const FOLLOW_UP_DELAY_MIN_S = 5;   // detik
const FOLLOW_UP_DELAY_MAX_S = 15;  // detik

// simulasi mengetik di layanan (durasi per pesan — sinkron dengan wa-checker)
const TYPING_BASE_S = 0.8;
const TYPING_MS_PER_CHAR = 37.5; // 25–50 ms/karakter (acak di layanan)
const TYPING_CAP_S = 20;
const LS_DELAY = "mapminer_penawaran_delay";
const LS_SENT = "mapminer_wa_sent"; // catatan nomor terkirim per pesan

// batas keras jumlah penerima per pengiriman
const MAX_RECIPIENTS = 50;

// ritme kirim aman utk nomor pribadi: istirahat panjang tiap beberapa pesan terkirim
const DEFAULT_DELAY_MIN = "60";     // detik
const DEFAULT_DELAY_MAX = "150";    // detik
const DEFAULT_BATCH_EVERY = 10;      // pesan
const DEFAULT_BATCH_PAUSE_MIN = 5;   // menit
const DEFAULT_BATCH_PAUSE_MAX = 10;  // menit

/** Sidik hash sederhana (djb2 + panjang) utk mengidentifikasi isi pesan.
 *  Bukan untuk keamanan — hanya membedakan teks pesan satu dgn lain. */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36) + "_" + s.length;
}

// ---------- komponen ----------
interface Props {
  waStatus: string | null;
  waChecked?: boolean; // false = status WA belum diperiksa → peringatan ditahan agar tidak kedip
  onOpenWa: () => void;
}

export default function PenawaranMassal({ waStatus, waChecked = true, onOpenWa }: Props) {
  const { toast } = useToast();
  const waConnected = waStatus === "connected";

  // langkah 1 — nomor penerima: upload file Excel (utama) atau tempel manual.
  // Grid file bisa diedit di popup; derivasi penerima diulang setiap perubahan.
  const [numbersInput, setNumbersInput] = useState("");
  const [sheet, setSheet] = useState<SheetSource | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // textarea selalu menjadi sumber nomor; grid file hanya menyediakan metadata
  // (nama bisnis, kota, alamat, …) yang dilekatkan ke nomor yang cocok
  const sheetInfo = useMemo(() => (sheet ? buildRecipientsFromSheet(sheet) : null), [sheet]);
  const metaMap = useMemo(
    () => new Map((sheetInfo?.recipients ?? []).map((r) => [r.phoneDigits, r])),
    [sheetInfo]
  );
  const parsed = useMemo(() => {
    const base = parseNumbers(numbersInput);
    if (metaMap.size === 0) return base;
    const all = base.all.map((r) => {
      const m = metaMap.get(r.phoneDigits);
      return m
        ? { ...r, name: m.name || r.name, kota: m.kota || r.kota, kategori: m.kategori || r.kategori, alamat: m.alamat || r.alamat, website: m.website || r.website, fields: m.fields }
        : r;
    });
    return { all, dup: base.dup, invalid: base.invalid };
  }, [numbersInput, metaMap]);
  // chip placeholder mengikuti judul kolom file — apa pun jumlah kolomnya.
  // Belum ada file → kosong (tidak menampilkan apa-apa dulu).
  const placeholders = useMemo(
    () => (sheet ? tokensFromHeaders(sheet.headers) : []),
    [sheet]
  );
  const [manualTrimInfo, setManualTrimInfo] = useState<string | null>(null);
  // kelebihan kapasitas dihitung turunan (bukan state) agar edit di popup langsung tercermin
  const sheetOver = sheetInfo ? Math.max(0, sheetInfo.recipients.length - MAX_RECIPIENTS) : 0;
  const trimInfo = sheet
    ? sheetOver > 0
      ? `${sheetOver} nomor kelebihan dihapus — maksimal ${MAX_RECIPIENTS} per pengiriman. Hapus/ubah baris di editor atau pilih ulang file untuk ronde berikutnya.`
      : null
    : manualTrimInfo;

  // catatan terkirim terikat pada isi pesan: hash pesan saat ini → daftar nomor terkirim.
  // Pesan diubah/dihapus → catatan tidak berlaku lagi (semua dianggap belum terkirim).
  const [sentRecord, setSentRecord] = useState<{ hash: string; sent: string[] } | null>(null);

  // batasi isi kotak: lebih dari 50 nomor valid → simpan 50 pertama (satu per baris),
  // sisanya dihapus dari kotak. Ronde berikutnya = isi nomor baru.
  const handleNumbersChange = (raw: string) => {
    const all = parseNumbers(raw).all;
    if (all.length > MAX_RECIPIENTS) {
      setNumbersInput(all.slice(0, MAX_RECIPIENTS).map((r) => r.phoneDigits).join("\n"));
      setManualTrimInfo(`${all.length - MAX_RECIPIENTS} nomor kelebihan dihapus — maksimal ${MAX_RECIPIENTS} per pengiriman. Isi nomor baru untuk ronde berikutnya.`);
    } else {
      setNumbersInput(raw);
      setManualTrimInfo(null);
    }
  };

  // ---------- file Excel ----------
  const onFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (f) void handleFile(f);
  };

  const clearFile = () => {
    // hanya lepas grid + metadata file; nomor di textarea tetap agar bisa
    // langsung disunting manual tanpa mengetik ulang dari nol
    setSheet(null);
    setSheetOpen(false);
    setFileError(null);
    setManualTrimInfo(null);
    setPhOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  /** Baca .xlsx/.xls/.csv menjadi grid yang bisa diedit (lihat SheetEditorDialog).
   *  Nomor diambil dari kolom Telepon (deteksi otomatis), nama bisnis dari kolom
   *  Bisnis/Nama, kota & kategori dari nama file. Lebih dari 50 baris data →
   *  sisanya langsung dibuang saat file dimuat. */
  const handleFile = async (file: File) => {
    setFileError(null);
    setFileLoading(true);
    try {
      const parsed = await parseFileToSheet(file);
      let s = parsed;
      if (parsed.rows.length > MAX_RECIPIENTS) {
        s = { ...parsed, rows: parsed.rows.slice(0, MAX_RECIPIENTS) };
      }
      setSheet(s);
      setPhOpen(false); // file baru → daftar placeholder kembali tertutup
      // nomor file masuk ke textarea — bisa dihapus semua lalu diketik manual
      setNumbersInput(s.rows.map((r) => (r[s.phoneIdx] ?? "").trim()).filter(Boolean).join("\n"));
      const info = buildRecipientsFromSheet(s);
      if (info.recipients.length === 0) {
        setFileError("Tidak ada nomor telepon valid di file ini");
      }
    } catch (e) {
      setSheet(null);
      setFileError(e instanceof Error ? e.message : "File tidak bisa dibaca");
    } finally {
      setFileLoading(false);
    }
  };

  // baris placeholder digeser kiri-kanan dengan mouse (drag-to-scroll, tanpa
  // scrollbar): tekan + tahan lalu geser; klik biasa tetap menyisipkan token
  const phWrapRef = useRef<HTMLDivElement>(null);
  const phDrag = useRef({ moved: false });
  const phPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const vp = phWrapRef.current?.querySelector<HTMLDivElement>("[data-radix-scroll-area-viewport]");
    if (!vp) return;
    const startX = e.clientX;
    const startLeft = vp.scrollLeft;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (Math.abs(dx) > 4) moved = true;
      vp.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (moved) {
        // geretan diakhiri click — tahan sekali agar token tidak tersisip
        phDrag.current.moved = true;
        setTimeout(() => { phDrag.current.moved = false; }, 0);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // langkah 2 — template pesan
  const [template, setTemplate] = useState<string>(DEFAULT_TEMPLATE);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // daftar placeholder ditutup/dibuka — tertutup = tampil satu tombol saja,
  // terbuka setelah diklik, lalu menutup lagi setelah satu dipilih
  const [phOpen, setPhOpen] = useState(false);
  const insertToken = (token: string) => {
    const el = taRef.current;
    if (!el) { setTemplate((t) => t + token); return; }
    const s = el.selectionStart ?? template.length;
    const e = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, s) + token + template.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + token.length, s + token.length); });
  };
  // pesan lanjutan (opsional): terkirim ke chat yang sama setelah pesan pertama
  const [followUp, setFollowUp] = useState<string>(DEFAULT_FOLLOW_UP);

  // langkah 3 — pengaturan kirim (rentang aman utk nomor pribadi: 1–2,5 menit)
  const [delayMin, setDelayMin] = useState(DEFAULT_DELAY_MIN);
  const [delayMax, setDelayMax] = useState(DEFAULT_DELAY_MAX);
  // istirahat otomatis: berhenti sebentar setiap N pesan terkirim (0 = matikan)
  const [batchEvery, setBatchEvery] = useState(String(DEFAULT_BATCH_EVERY));
  const [batchPauseMin, setBatchPauseMin] = useState(String(DEFAULT_BATCH_PAUSE_MIN));
  const [batchPauseMax, setBatchPauseMax] = useState(String(DEFAULT_BATCH_PAUSE_MAX));

  // antrian kirim
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [longLeft, setLongLeft] = useState(0); // sisa istirahat batch (detik)
  const [sentCount, setSentCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [logs, setLogs] = useState<SendLog[]>([]);
  const [progressIdx, setProgressIdx] = useState(0); // 0 = belum mulai
  const stopRef = useRef(false);
  const pauseRef = useRef(false);
  const skipRef = useRef(false); // lewati jeda berjalan

  // muat preferensi tersimpan SETELAH mount — render pertama harus identik dgn SSR.
  // persist ditahan sampai load selesai agar nilai default tidak menimpa yang tersimpan.
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  useEffect(() => {
    try {
      const tpl = localStorage.getItem(LS_TEMPLATE);
      if (tpl) setTemplate(tpl);
      const fu = localStorage.getItem(LS_FOLLOW_UP);
      if (fu !== null) setFollowUp(fu);
      const d = JSON.parse(localStorage.getItem(LS_DELAY) ?? "null");
      if (d?.min && d?.max) {
        // bawaan lama (8/20 lalu 45/90) terlalu cepat utk nomor pribadi — naikkan sekali ke rentang aman
        if ((d.min === 8 && d.max === 20) || (d.min === 45 && d.max === 90)) {
          setDelayMin("60");
          setDelayMax("150");
        } else {
          setDelayMin(String(d.min));
          setDelayMax(String(d.max));
        }
      }
      if (typeof d?.every === "number") setBatchEvery(String(d.every));
      if (typeof d?.pmin === "number" && typeof d?.pmax === "number") {
        // bawaan lama (20/30 mnt) terlalu panjang — naikkan sekali ke 5/10 menit
        if (d.pmin === 20 && d.pmax === 30) {
          setBatchPauseMin("5");
          setBatchPauseMax("10");
        } else {
          setBatchPauseMin(String(d.pmin));
          setBatchPauseMax(String(d.pmax));
        }
      } else {
        if (typeof d?.pmin === "number") setBatchPauseMin(String(d.pmin));
        if (typeof d?.pmax === "number") setBatchPauseMax(String(d.pmax));
      }
      const rec = localStorage.getItem(LS_SENT);
      if (rec) setSentRecord(JSON.parse(rec) as { hash: string; sent: string[] });
    } catch {}
    setPrefsLoaded(true);
  }, []);

  // persist template & jeda
  useEffect(() => {
    if (!prefsLoaded) return;
    try { localStorage.setItem(LS_TEMPLATE, template); } catch {}
  }, [template, prefsLoaded]);
  useEffect(() => {
    if (!prefsLoaded) return;
    try { localStorage.setItem(LS_FOLLOW_UP, followUp); } catch {}
  }, [followUp, prefsLoaded]);
  useEffect(() => {
    if (!prefsLoaded) return;
    try {
      localStorage.setItem(LS_DELAY, JSON.stringify({
        min: Number(delayMin) || 60,
        max: Number(delayMax) || 150,
        every: Number(batchEvery) || 0,
        pmin: Number(batchPauseMin) || 5,
        pmax: Number(batchPauseMax) || 10,
      }));
    } catch {}
  }, [delayMin, delayMax, batchEvery, batchPauseMin, batchPauseMax, prefsLoaded]);

  // hash pesan aktif & nomor yang sudah terkirim dgn pesan tersebut
  const msgHash = useMemo(() => hashText(template), [template]);
  const sentSet = useMemo(
    () => new Set<string>(sentRecord && sentRecord.hash === msgHash ? sentRecord.sent : []),
    [sentRecord, msgHash]
  );

  // antrian = isi kotak (dijamin ≤ 50 oleh handleNumbersChange) MINUS yang sudah terkirim dgn pesan ini
  const queue = useMemo(() => parsed.all.filter((r) => !sentSet.has(r.phoneDigits)), [parsed, sentSet]);

  // pesan dihapus (kosong) → catatan terkirim pesan itu dianggap tidak sah: reset
  useEffect(() => {
    if (!template.trim() && sentRecord) {
      setSentRecord(null);
      try { localStorage.removeItem(LS_SENT); } catch {}
    }
  }, [template, sentRecord]);

  // estimasi: jeda antar pesan + istirahat batch tiap N terkirim (0 = tanpa istirahat)
  const everyNum = Math.max(0, Math.floor(Number(batchEvery) || 0));
  const pMinNum = Math.max(1, Math.floor(Number(batchPauseMin) || DEFAULT_BATCH_PAUSE_MIN));
  const pMaxNum = Math.max(pMinNum, Math.floor(Number(batchPauseMax) || DEFAULT_BATCH_PAUSE_MAX));
  const avgGap = (Math.max(3, Number(delayMin) || 8) + Math.max(3, Number(delayMax) || 20)) / 2;
  const avgBatchPause = ((pMinNum + pMaxNum) / 2) * 60;
  // pesan lanjutan menggandakan jumlah pesan per penerima + jeda singkatnya
  const followUpMsg = followUp.trim();
  const totalMsgs = queue.length * (followUpMsg ? 2 : 1);
  const avgFollowUp = (FOLLOW_UP_DELAY_MIN_S + FOLLOW_UP_DELAY_MAX_S) / 2;
  const batchPauses = everyNum > 0 && totalMsgs > 1 ? Math.floor((totalMsgs - 1) / everyNum) : 0;
  // estimasi juga mencakup durasi simulasi mengetik per pesan
  const typingS = (len: number) => Math.min(TYPING_CAP_S, TYPING_BASE_S + (len * TYPING_MS_PER_CHAR) / 1000);
  const estSeconds =
    totalMsgs * avgGap +
    queue.length * (typingS(template.length) + (followUpMsg ? typingS(followUpMsg.length) : 0)) +
    batchPauses * avgBatchPause;
  const estLabel =
    estSeconds >= 5400 ? `${(estSeconds / 3600).toFixed(1).replace(".", ",")} jam`
    : estSeconds >= 90 ? `${Math.round(estSeconds / 60)} mnt`
    : `${Math.round(estSeconds)} dtk`;

  // ---- waktu berjalan & sisa waktu SAAT pengiriman (detik per detik) ----
  // tick memaksa render ulang tiap 1 dtk selama sending agar jam ikut berjalan.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [sending]);
  const elapsedS = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const progressFrac = queue.length > 0 ? Math.min(1, progressIdx / queue.length) : 0;
  // sisa waktu dari kecepatan aktual; sebelum ada progres → pakai estimasi konfigurasi
  const etaS = progressIdx > 0 && progressIdx < queue.length
    ? Math.round((elapsedS / progressIdx) * (queue.length - progressIdx))
    : estSeconds;

  // tombol "Default": menonjol hanya ketika pengaturan berbeda dari bawaan
  const settingsChanged =
    delayMin !== DEFAULT_DELAY_MIN ||
    delayMax !== DEFAULT_DELAY_MAX ||
    batchEvery !== String(DEFAULT_BATCH_EVERY) ||
    batchPauseMin !== String(DEFAULT_BATCH_PAUSE_MIN) ||
    batchPauseMax !== String(DEFAULT_BATCH_PAUSE_MAX);
  const resetSettings = () => {
    setDelayMin(DEFAULT_DELAY_MIN);
    setDelayMax(DEFAULT_DELAY_MAX);
    setBatchEvery(String(DEFAULT_BATCH_EVERY));
    setBatchPauseMin(String(DEFAULT_BATCH_PAUSE_MIN));
    setBatchPauseMax(String(DEFAULT_BATCH_PAUSE_MAX));
  };

  // ---------- kirim ----------
  const sendOne = async (number: string, message: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await fetch("/api/scraper/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // typing: tampilkan status "mengetik…" manusiawi di chat penerima sebelum pesan terkirim
        body: JSON.stringify({ number, message, typing: true }),
      });
      const data = await resp.json().catch(() => null);
      return data?.ok ? { ok: true } : { ok: false, error: data?.error ?? `HTTP ${resp.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  const pushLog = (l: SendLog) => setLogs((prev) => [l, ...prev].slice(0, 300));

  // jeda berdetik yang bisa dijeda / dilewati / dihentikan kapan pun
  const waitSecs = async (secs: number) => {
    let s = secs;
    while (s > 0) {
      if (stopRef.current || skipRef.current) break;
      if (pauseRef.current) { await sleep(500); continue; }
      setCountdown(s);
      await sleep(1000);
      s--;
    }
    setCountdown(0);
    skipRef.current = false;
  };

  // catat nomor berhasil terkirim utk pesan yang sedang dipakai
  const rememberSent = (digits: string) => {
    setSentRecord((prev) => {
      const cur = prev && prev.hash === msgHash ? prev.sent : [];
      const next: { hash: string; sent: string[] } = {
        hash: msgHash,
        sent: [...new Set([...cur, digits])].slice(-5000),
      };
      try { localStorage.setItem(LS_SENT, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const startSend = async () => {
    if (queue.length === 0) {
      toast({ title: "Antrian kosong", description: "Pilih file Excel atau tempel daftar nomor dulu (maks 50).", variant: "destructive" });
      return;
    }
    if (!template.trim()) {
      toast({ title: "Template kosong", description: "Tulis pesan penawaran terlebih dahulu.", variant: "destructive" });
      return;
    }
    if (!waConnected) {
      toast({ title: "WhatsApp belum terhubung", description: "Hubungkan WhatsApp lewat ikon obrolan di header.", variant: "destructive" });
      return;
    }
    const dMin = Math.max(3, Math.floor(Number(delayMin) || 8));
    const dMax = Math.max(dMin, Math.floor(Number(delayMax) || 20));
    const every = Math.max(0, Math.floor(Number(batchEvery) || 0));
    const pMin = Math.max(1, Math.floor(Number(batchPauseMin) || DEFAULT_BATCH_PAUSE_MIN));
    const pMax = Math.max(pMin, Math.floor(Number(batchPauseMax) || DEFAULT_BATCH_PAUSE_MAX));

    setSending(true);
    setPaused(false);
    pauseRef.current = false;
    stopRef.current = false;
    skipRef.current = false;
    setLongLeft(0);
    setSentCount(0);
    setFailCount(0);
    setProgressIdx(0);
    setStartedAt(Date.now());
    let sent = 0;
    let failed = 0;
    let idx = 0;
    let batchSent = 0; // terkirim dalam batch berjalan (istirahat tiap BATCH_EVERY)

    for (; idx < queue.length; idx++) {
      if (stopRef.current) break;
      // jeda bisa ditekan kapan pun
      while (pauseRef.current && !stopRef.current) await sleep(300);
      if (stopRef.current) break;
      const r = queue[idx];
      setProgressIdx(idx + 1);
      const msg = renderTemplate(template, r);
      const res = await sendOne(r.phoneDigits, msg);
      if (res.ok) {
        sent++;
        setSentCount(sent);
        batchSent++;
        rememberSent(r.phoneDigits);
        pushLog({ t: Date.now(), name: r.name || fmtPhone(r.phoneDigits), phone: fmtPhone(r.phoneDigits), ok: true, msg: "terkirim" });
      } else {
        failed++;
        setFailCount(failed);
        pushLog({ t: Date.now(), name: r.name || fmtPhone(r.phoneDigits), phone: fmtPhone(r.phoneDigits), ok: false, msg: res.error ?? "gagal" });
      }

      // pesan lanjutan ke chat yang sama — hanya jika pesan pertama berhasil
      if (followUpMsg && res.ok && !stopRef.current) {
        const fDelay = FOLLOW_UP_DELAY_MIN_S + Math.floor(Math.random() * (FOLLOW_UP_DELAY_MAX_S - FOLLOW_UP_DELAY_MIN_S + 1));
        await waitSecs(fDelay);
        if (!stopRef.current) {
          const res2 = await sendOne(r.phoneDigits, renderTemplate(followUpMsg, r));
          if (res2.ok) {
            sent++;
            setSentCount(sent);
            batchSent++;
            pushLog({ t: Date.now(), name: r.name || fmtPhone(r.phoneDigits), phone: fmtPhone(r.phoneDigits), ok: true, msg: "lanjutan: terkirim" });
          } else {
            failed++;
            setFailCount(failed);
            pushLog({ t: Date.now(), name: r.name || fmtPhone(r.phoneDigits), phone: fmtPhone(r.phoneDigits), ok: false, msg: "lanjutan: " + (res2.error ?? "gagal") });
          }
        }
      }

      // jeda antar pesan / istirahat batch — tidak menunggu setelah penerima terakhir
      const moreLeft = idx < queue.length - 1;
      if (moreLeft && every > 0 && batchSent >= every) {
        // istirahat panjang setiap N pesan terkirim
        skipRef.current = false;
        pushLog({ t: Date.now(), name: "istirahat", phone: "", ok: true, msg: `batch ${every} pesan selesai — jeda ${pMin}–${pMax} mnt` });
        const pause = pMin * 60 + Math.floor(Math.random() * ((pMax - pMin) * 60 + 1));
        let s = pause;
        while (s > 0) {
          if (stopRef.current || skipRef.current) break;
          if (pauseRef.current) { await sleep(500); continue; }
          setLongLeft(s);
          await sleep(1000);
          s--;
        }
        setLongLeft(0);
        skipRef.current = false;
        batchSent = 0;
      } else if (moreLeft) {
        const d = Math.floor(dMin + Math.random() * (dMax - dMin + 1));
        await waitSecs(d);
      }
    }

    setSending(false);
    setPaused(false);
    setCountdown(0);
    setStartedAt(null);
    const stopped = stopRef.current;
    toast({
      title: stopped ? "Pengiriman dihentikan" : "Pengiriman selesai ✅",
      description: `${sent} terkirim · ${failed} gagal${stopped ? ` · sisa ${queue.length - idx - 1 < 0 ? 0 : queue.length - idx - 1} belum dikirim` : ""}.`,
    });
  };

  const canStart = waConnected && queue.length > 0 && template.trim().length > 0 && !sending;

  // ---------- render ----------
  return (
    <div className="space-y-6 animate-fade-up" aria-label="Penawaran Massal">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* kolom kiri: sumber + template */}
        <div className="lg:col-span-3 space-y-6">
          {/* langkah 1 — nomor penerima manual */}
          <Card className="pt-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">1</span>
                Nomor penerima
                <Badge variant="outline" className="ml-auto tabular-nums">
                  {queue.length}/{MAX_RECIPIENTS}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={onFilePick}
                disabled={sending}
              />
              {sheet ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3">
                  <FileSpreadsheet className="h-5 w-5 text-emerald-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate" title={sheet.fileName}>{sheet.fileName}</div>
                    <div className="text-xs text-muted-foreground">
                      {sheet.rows.length} baris dibaca · kolom &ldquo;{sheet.headers[sheet.phoneIdx]}&rdquo;
                      {sheetInfo && (sheetInfo.empty > 0 || sheetInfo.invalid > 0) && ` · ${sheetInfo.empty + sheetInfo.invalid} baris dilewati`}
                      {sheetInfo && sheetInfo.dup > 0 && ` · ${sheetInfo.dup} duplikat dibuang`}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 shrink-0 cursor-pointer" onClick={() => setSheetOpen(true)} disabled={sending}>
                    <Sheet className="h-3.5 w-3.5" /> Lihat &amp; Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5 shrink-0 cursor-pointer transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
                    onClick={clearFile}
                    disabled={sending}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Hapus
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full h-11 gap-2 border-dashed cursor-pointer" onClick={() => fileRef.current?.click()} disabled={sending || fileLoading}>
                  <Upload className="h-4 w-4" />
                  {fileLoading ? "Membaca file…" : "Pilih file Excel (.xlsx)"}
                </Button>
              )}

              {/* selalu textarea: terisi otomatis dari file (bisa dihapus semua
                  lalu diketik manual), atau diketik langsung tanpa file */}
              <Textarea
                value={numbersInput}
                onChange={(e) => handleNumbersChange(e.target.value)}
                className="text-sm font-mono leading-relaxed numbers-textarea"
                  placeholder={"82395022596\n083125626838\n6285173230850\n+6282195256729\n601170046869\n+601112895220"}
                spellCheck={false}
                disabled={sending}
              />
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-emerald-600 dark:text-emerald-400">{queue.length} nomor siap kirim</span>
                {parsed.dup > 0 && <span>{parsed.dup} duplikat dibuang</span>}
                {parsed.invalid > 0 && <span className="text-amber-600 dark:text-amber-400">{parsed.invalid} tidak valid dibuang</span>}
              </div>
              {parsed.all.length > 0 && queue.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5 shrink-0 self-center" />
                  <span className="leading-relaxed">
                    <span className="block">Semua nomor sudah terkirim dengan pesan ini.</span>
                    <span className="block">Ubah atau hapus pesannya agar dianggap belum terkirim, atau isi nomor baru.</span>
                  </span>
                </div>
              )}
              {fileError && (
                <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Gagal membaca file: {fileError}</span>
                </div>
              )}
              {trimInfo && (
                <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{trimInfo}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* langkah 2 */}
          <Card className="pt-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">2</span>
                Tulis pesan penawaran
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {placeholders.length > 0 ? (
                phOpen ? (
                  // ScrollArea Radix: scrollbar native selalu disembunyikan oleh
                  // pustakanya sendiri — baris digeser kiri-kanan dengan drag mouse
                  <div
                    ref={phWrapRef}
                    className="cursor-grab select-none active:cursor-grabbing"
                    onPointerDown={phPointerDown}
                  >
                    <ScrollArea className="w-full">
                      <div className="flex flex-nowrap items-center gap-1.5">
                        {placeholders.map((ph) => (
                          <button
                            key={ph.token}
                            type="button"
                            title={ph.label}
                            onClick={() => {
                              if (phDrag.current.moved) return; // baru selesai digeser, bukan klik
                              insertToken(ph.token); // daftar tetap terbuka — tutup hanya lewat ✕
                            }}
                            className="shrink-0 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-xs font-mono text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15 cursor-pointer"
                          >
                            {ph.token}
                          </button>
                        ))}
                        <button
                          type="button"
                          title="Tutup"
                          onClick={() => setPhOpen(false)}
                          className="shrink-0 rounded-lg border border-border px-1.5 py-1 text-xs text-muted-foreground hover:bg-muted cursor-pointer"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </ScrollArea>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Sisipkan placeholder dari judul kolom file"
                    onClick={() => setPhOpen(true)}
                    className="flex w-fit items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 text-xs font-mono text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15 cursor-pointer"
                  >
                    {"{placeholder}"} <ChevronRight className="h-3 w-3" />
                  </button>
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  Pilih file Excel di langkah 1 — placeholder dari judul kolomnya (mis. {"{Bisnis}"}, {"{Telepon}"}) muncul di sini.
                </p>
              )}
                <Textarea
                  ref={taRef}
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={7}
                  className="text-sm leading-relaxed message-textarea"
                  placeholder="Tulis pesan penawaran…"
                  disabled={sending}
                />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{template.length} karakter</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-7 gap-1.5 px-2 text-xs cursor-pointer",
                    template !== DEFAULT_TEMPLATE
                      ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                      : "text-muted-foreground"
                  )}
                  title="Kembalikan pesan ke bawaan"
                  onClick={() => setTemplate(DEFAULT_TEMPLATE)}
                  disabled={sending}
                >
                  <RotateCcw className="h-3 w-3" /> Default
                </Button>
              </div>

              <Separator className="bg-border/60" />
              <div className="space-y-1.5">
                <Label className="text-xs">Pesan lanjutan (opsional)</Label>
                <Textarea
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  rows={3}
                  className="text-sm leading-relaxed message-textarea message-textarea-sm"
                  placeholder={"Saya ada ide tampilannya untuk {Bisnis}. Boleh saya kirim contohnya?\n\nKosongkan untuk menonaktifkan."}
                  disabled={sending}
                />
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                    Dikirim ke chat yang sama ±{FOLLOW_UP_DELAY_MIN_S}–{FOLLOW_UP_DELAY_MAX_S} detik setelah pesan pertama. Kosongkan untuk menonaktifkan.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 shrink-0 gap-1.5 px-2 text-xs cursor-pointer",
                      followUp !== DEFAULT_FOLLOW_UP
                        ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                        : "text-muted-foreground"
                    )}
                    title="Kembalikan pesan lanjutan ke bawaan"
                    onClick={() => setFollowUp(DEFAULT_FOLLOW_UP)}
                  >
                    <RotateCcw className="h-3 w-3" /> Default
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* kolom kanan: filter + pengaturan + aksi */}
        <div className="lg:col-span-2 space-y-6">
          {/* pengaturan kirim */}
          <Card className="pt-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">3</span>
                Pengaturan kirim
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "ml-auto h-7 gap-1.5 px-2 text-xs cursor-pointer",
                    settingsChanged
                      ? "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                      : "text-muted-foreground"
                  )}
                  title="Kembalikan pengaturan ke bawaan"
                  onClick={resetSettings}
                  disabled={sending}
                >
                  <RotateCcw className="h-3 w-3" /> Default
                </Button>
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="delayMin" className="text-xs">Jeda minimal (detik)</Label>
                  <Input id="delayMin" type="number" min={3} max={300} value={delayMin} disabled={sending}
                    onChange={(e) => setDelayMin(e.target.value)}
                    onBlur={() => setDelayMin(clampInputNum(delayMin, 3, 300))}
                    className="h-9 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="delayMax" className="text-xs">Jeda maksimal (detik)</Label>
                  <Input id="delayMax" type="number" min={3} max={600} value={delayMax} disabled={sending}
                    onChange={(e) => setDelayMax(e.target.value)}
                    onBlur={() => setDelayMax(clampInputNum(delayMax, 3, 600))}
                    className="h-9 tabular-nums" />
                </div>
              </div>
              {(Number(delayMin) < 30 || Number(delayMax) < 30) && (
                <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Jeda di bawah 30 detik berisiko tinggi dibatasi WhatsApp. Untuk nomor pribadi disarankan 45–90 detik dan maksimal ±50 pesan per hari.</span>
                </div>
              )}

              <Separator className="bg-border/60" />
              <div className="space-y-1.5">
                <Label className="text-xs">Istirahat otomatis</Label>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="batchEvery" className="text-xs text-muted-foreground">setiap (pesan)</Label>
                    <Input id="batchEvery" type="number" min={0} max={50} value={batchEvery} disabled={sending}
                      onChange={(e) => setBatchEvery(e.target.value)}
                      onBlur={() => setBatchEvery(clampInputNum(batchEvery, 0, 50))}
                      className="h-9 tabular-nums" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="batchPauseMin" className="text-xs text-muted-foreground">jeda min (mnt)</Label>
                    <Input id="batchPauseMin" type="number" min={1} max={120} value={batchPauseMin} disabled={sending}
                      onChange={(e) => setBatchPauseMin(e.target.value)}
                      onBlur={() => setBatchPauseMin(clampInputNum(batchPauseMin, 1, 120))}
                      className="h-9 tabular-nums" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="batchPauseMax" className="text-xs text-muted-foreground">jeda maks (mnt)</Label>
                    <Input id="batchPauseMax" type="number" min={1} max={180} value={batchPauseMax} disabled={sending}
                      onChange={(e) => setBatchPauseMax(e.target.value)}
                      onBlur={() => setBatchPauseMax(clampInputNum(batchPauseMax, 1, 180))}
                      className="h-9 tabular-nums" />
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {everyNum > 0
                    ? <>Setelah <b>{everyNum} pesan terkirim</b>, pengiriman berhenti dulu <b>{pMinNum}–{pMaxNum} menit</b> (acak) sebelum lanjut ke nomor berikutnya. Isi 0 di &ldquo;setiap&rdquo; untuk mematikan.</>
                    : "Istirahat otomatis mati — isi angka di kolom \u201csetiap\u201d untuk mengaktifkan."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ringkasan & aksi */}
          <Card className="border-emerald-500/25">
            <CardContent className="space-y-4 pt-5">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-border bg-muted/50 py-2.5">
                  <div className="text-lg font-bold tabular-nums">{queue.length}</div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">siap kirim</div>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5">
                  <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{sentCount}</div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">terkirim</div>
                </div>
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 py-2.5">
                  <div className="text-lg font-bold tabular-nums text-red-500">{failCount}</div>
                  <div className="text-[11px] text-muted-foreground uppercase tracking-wider">gagal</div>
                </div>
              </div>
              {queue.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Estimasi total ±{estLabel} ({everyNum > 0 ? `jeda ${delayMin}–${delayMax} dtk · istirahat ${pMinNum}–${pMaxNum} mnt tiap ${everyNum} terkirim` : `jeda ${delayMin}–${delayMax} dtk`}{followUpMsg ? ` · lanjutan ${FOLLOW_UP_DELAY_MIN_S}–${FOLLOW_UP_DELAY_MAX_S} dtk` : ""})
                </div>
              )}

              {/* saat pengiriman berjalan: bar beranimasi + waktu berjalan & sisa waktu */}
              {sending && (
                <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Berjalan {fmtDur(elapsedS)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">sisa ±{fmtDur(etaS)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="kf-send-progress h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-[width] duration-700"
                      style={{ width: `${Math.max(progressFrac * 100, 2)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>{progressIdx} dari {queue.length} penerima terproses</span>
                    <span>{Math.round(progressFrac * 100)}%</span>
                  </div>
                </div>
              )}

              {!sending ? (
                <Button className="w-full h-11 gap-2 text-base cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/20" disabled={!canStart} onClick={() => { void startSend(); }}>
                  <Send className="h-4.5 w-4.5" /> Mulai Kirim {queue.length > 0 ? `(${queue.length})` : ""}
                </Button>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {paused ? (
                    <Button className="h-10 gap-1.5 cursor-pointer col-span-2" onClick={() => { pauseRef.current = false; setPaused(false); }}>
                      <Play className="h-4 w-4" /> Lanjutkan
                    </Button>
                  ) : (
                    <Button variant="outline" className="h-10 gap-1.5 cursor-pointer" onClick={() => { pauseRef.current = true; setPaused(true); }}>
                      <Pause className="h-4 w-4" /> Jeda
                    </Button>
                  )}
                  <Button variant="destructive" className="h-10 gap-1.5 cursor-pointer" onClick={() => { stopRef.current = true; pauseRef.current = false; }}>
                    <Square className="h-4 w-4" /> Hentikan
                  </Button>
                  {(countdown > 0 || longLeft > 0) && (
                    <Button variant="outline" className="h-10 gap-1.5 cursor-pointer col-span-2" onClick={() => { skipRef.current = true; }}>
                      <FastForward className="h-4 w-4" /> Lewati jeda — lanjut sekarang
                    </Button>
                  )}
                </div>
              )}
              {waChecked && !waConnected && (
                <div className="flex items-center justify-between gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <span className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> WhatsApp belum terhubung
                  </span>
                  <Button size="sm" variant="outline" className="h-7 gap-1.5 cursor-pointer shrink-0" onClick={onOpenWa}>
                    <WhatsAppIcon className="h-3 w-3" /> Hubungkan
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* progres + log */}
      {(sending || logs.length > 0) && (
        <Card className="pt-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {sending ? <Loader2 className="h-4 w-4 animate-spin text-emerald-500" /> : <Send className="h-4 w-4 text-emerald-500" />}
              Progres pengiriman
              {sending && paused && <Badge variant="outline" className="border-amber-500/40 text-amber-600">dijeda</Badge>}
              {sending && !paused && longLeft > 0 && (
                <Badge variant="outline" className="tabular-nums border-amber-500/40 text-amber-600 dark:text-amber-400">
                  istirahat batch — sisa {fmtDur(longLeft)}
                </Badge>
              )}
              {sending && !paused && countdown > 0 && (
                <Badge variant="outline" className="tabular-nums border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                  pesan berikutnya dalam {countdown} dtk
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="tabular-nums">
              {progressIdx > 0 ? `Mengirim ${progressIdx} dari ${queue.length}` : "Belum dimulai"} — riwayat 300 terakhir ditampilkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* bar beranimasi (shimmer) — bergerak selama proses kirim berjalan */}
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="kf-send-progress h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-[width] duration-700"
                style={{ width: `${Math.max(queue.length > 0 ? (progressIdx / queue.length) * 100 : 0, 2)}%` }}
              />
            </div>
            {sending && (
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {Math.round(queue.length > 0 ? (progressIdx / queue.length) * 100 : 0)}% terproses
                </span>
                <span className="text-muted-foreground">
                  ⏱ {fmtDur(elapsedS)} berjalan · sisa ±{fmtDur(etaS)}
                </span>
              </div>
            )}
            <ScrollArea className="h-56 rounded-xl border border-border/60">
              <div className="p-2 font-mono text-xs space-y-1">
                {logs.length === 0 ? (
                  <div className="px-2 py-1.5 text-muted-foreground italic">Belum ada aktivitas.</div>
                ) : (
                  logs.map((l, i) => (
                    <div key={`${l.t}-${i}`} className={cn("flex items-start gap-2 rounded-lg px-2 py-1.5", i === 0 && "bg-muted/50")}>
                      {l.ok
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        : <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />}
                      <span className="text-muted-foreground tabular-nums shrink-0">{fmtTime(l.t)}</span>
                      <span className="min-w-0 flex-1 truncate" title={`${l.name} — ${l.phone}`}>
                        <b>{l.name}</b> <span className="text-muted-foreground">{l.phone}</span> — {l.msg}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* editor spreadsheet ala Google Sheets. Dimount hanya saat terbuka agar
          draf selalu mulai dari data tersimpan; ditutup tanpa "Selesai" = buang. */}
      {sheet && sheetOpen && (
        <SheetEditorDialog
          sheet={sheet}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onSave={(s) => {
            setSheet(s);
            setPhOpen(false); // judul kolom bisa berubah → daftar tertutup ulang
            // tarik ulang nomor dari grid ke textarea (batas 50 tetap berlaku)
            setNumbersInput(
              s.rows.map((r) => (r[s.phoneIdx] ?? "").trim()).filter(Boolean).slice(0, MAX_RECIPIENTS).join("\n")
            );
          }}
        />
      )}
    </div>
  );
}
