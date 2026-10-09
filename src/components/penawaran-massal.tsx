"use client";

// ---------- Halaman Penawaran Massal ----------
// Kirim penawaran WhatsApp berurutan ke tempat hasil scraping (Cari Prospek).
// Pacing (jeda acak antar pesan) diatur di sisi UI agar bisa dijeda/dihentikan
// kapan pun; satu pesan = satu panggilan POST /api/scraper/wa/send.

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Pause, Play, Square, FastForward, Loader2,
  AlertTriangle, Clock, Save, Check,
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

// ---------- riwayat undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) ----------
// Textarea terkelola React kehilangan undo bawaan browser — nilai DOM ditulis
// ulang programatik (apalagi kotak nomor yang dipotong otomatis ke 50 baris).
// Riwayat dikelola sendiri: ketikan beruntun <800 mdtk digabung jadi satu titik
// undo, tempel/hapus besar selalu membuka titik tersendiri.
interface TextHistory { past: string[]; future: string[] }
const HISTORY_LIMIT = 100;
const BURST_MS = 800;

type HistoryRef = { current: TextHistory };
type LastRef = { current: { value: string; at: number } };

const recordTextHistory = (h: HistoryRef, last: LastRef, next: string) => {
  const now = Date.now();
  const newBurst = now - last.current.at > BURST_MS || Math.abs(next.length - last.current.value.length) > 1;
  if (newBurst) h.current.past = [...h.current.past.slice(-(HISTORY_LIMIT - 1)), last.current.value];
  h.current.future = [];
  last.current = { value: next, at: now };
};

const handleHistoryKeys =
  (h: HistoryRef, last: LastRef, setValue: (v: string) => void) =>
  (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    const isUndo = key === "z" && !e.shiftKey;
    const isRedo = key === "y" || (key === "z" && e.shiftKey);
    if (!isUndo && !isRedo) return;
    e.preventDefault(); // selalu — undo bawaan browser di sini tidak andal
    const from = isUndo ? h.current.past : h.current.future;
    if (from.length === 0) return;
    const value = from[from.length - 1];
    if (isUndo) {
      h.current.past = from.slice(0, -1);
      h.current.future = [...h.current.future.slice(-(HISTORY_LIMIT - 1)), last.current.value];
    } else {
      h.current.future = from.slice(0, -1);
      h.current.past = [...h.current.past.slice(-(HISTORY_LIMIT - 1)), last.current.value];
    }
    // at = 0 → ketikan setelah undo/redo selalu membuka titik riwayat baru
    last.current = { value, at: 0 };
    setValue(value);
  };
const fmtDur = (s: number) => {
  const j = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const d = s % 60;
  if (j > 0) return `${j} j ${m} mnt`;
  if (m > 0) return `${m} mnt ${d} dtk`;
  return `${d} dtk`;
};
/** Sisa waktu TANPA detik: menit bulat ke atas (jam bila panjang) — dibaca sekilas.
 *  Termasuk tanda ±-nya; di bawah satu menit tampil "<1 mnt" tanpa ±. */
const fmtMenit = (s: number) => {
  const v = Math.max(0, s);
  if (v < 60) return "<1 mnt";
  const mnt = Math.ceil(v / 60);
  if (mnt < 90) return `±${mnt} mnt`;
  return `±${(v / 3600).toFixed(1).replace(".", ",")} jam`;
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
const TYPING_MS_PER_CHAR = 30; // 20–40 ms/karakter (acak di layanan) — rata-rata 30
const TYPING_CAP_S = 10;
const LS_DELAY = "mapminer_penawaran_delay";
const LS_SENT = "mapminer_wa_sent"; // catatan nomor terkirim per pesan

// batas keras jumlah penerima per pengiriman
const MAX_RECIPIENTS = 50;

// ritme kirim aman utk nomor pribadi
const DEFAULT_DELAY_MIN = "60";     // detik
const DEFAULT_DELAY_MAX = "150";    // detik

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

  // riwayat ketikan kotak nomor — dipotong otomatis ke 50 baris merusak undo bawaan
  const numbersHist = useRef<TextHistory>({ past: [], future: [] });
  const numbersLast = useRef({ value: numbersInput, at: 0 });

  // batasi isi kotak: lebih dari 50 nomor valid → simpan 50 pertama (satu per baris),
  // sisanya dihapus dari kotak. Ronde berikutnya = isi nomor baru.
  const handleNumbersChange = (raw: string) => {
    const all = parseNumbers(raw).all;
    if (all.length > MAX_RECIPIENTS) {
      const next = all.slice(0, MAX_RECIPIENTS).map((r) => r.phoneDigits).join("\n");
      recordTextHistory(numbersHist, numbersLast, next);
      setNumbersInput(next);
      setManualTrimInfo(`${all.length - MAX_RECIPIENTS} nomor kelebihan dihapus — maksimal ${MAX_RECIPIENTS} per pengiriman. Isi nomor baru untuk ronde berikutnya.`);
    } else {
      recordTextHistory(numbersHist, numbersLast, raw);
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
  // riwayat ketikan pesan utama & pesan lanjutan untuk undo/redo
  const templateHist = useRef<TextHistory>({ past: [], future: [] });
  const templateLast = useRef({ value: template, at: 0 });
  const followUpHist = useRef<TextHistory>({ past: [], future: [] });
  const followUpLast = useRef({ value: followUp, at: 0 });

  // nilai diganti dari luar ketikan (muat preferensi tersimpan) → patokan riwayat
  // direset; at = 0 agar ketikan berikut selalu membuka titik undo baru
  useEffect(() => {
    if (template !== templateLast.current.value) templateLast.current = { value: template, at: 0 };
  }, [template]);
  useEffect(() => {
    if (followUp !== followUpLast.current.value) followUpLast.current = { value: followUp, at: 0 };
  }, [followUp]);
  useEffect(() => {
    if (numbersInput !== numbersLast.current.value) numbersLast.current = { value: numbersInput, at: 0 };
  }, [numbersInput]);

  // langkah 3 — pengaturan kirim (rentang aman utk nomor pribadi: 1–2,5 menit)
  const [delayMin, setDelayMin] = useState(DEFAULT_DELAY_MIN);
  const [delayMax, setDelayMax] = useState(DEFAULT_DELAY_MAX);

  // antrian kirim
  const [sending, setSending] = useState(false);
  const [paused, setPaused] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [sentCount, setSentCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [progressIdx, setProgressIdx] = useState(0); // 0 = belum mulai
  // Rencana kirim yang DIBEKUKAN saat Mulai Kirim ditekan: jumlah penerima & estimasi
  // total. Wajib dibekukan — queue menyusut live begitu nomor tercatat terkirim
  // (sentSet tumbuh), tanpa pembekuan penyebut progres & estimasi berubah di tengah
  // jalan ("1 dari 2" mendadak jadi "1 dari 1", bar melompat penuh).
  const [runPlan, setRunPlan] = useState<{ total: number; estTotal: number } | null>(null);
  // notifikasi "Simpan Berhasil": turun dari atas layar, tutup sendiri setelah ±2,4 dtk
  const [savedPop, setSavedPop] = useState<{ title: string; desc: string } | null>(null);
  const [savedClosing, setSavedClosing] = useState(false);
  // nomor urut tiap kali notifikasi muncul — dipakai sebagai <key> agar elemen
  // dibuat ulang: menekan Simpan lain saat notifikasi masih tampil tetap
  // memutar ulang animasi turun-dari-atas, bukan sekadar mengganti teks
  const [savedSeq, setSavedSeq] = useState(0);
  const savedTimerRef = useRef<number | null>(null);
  const savedCloseTimerRef = useRef<number | null>(null);
  const showSavedPop = (title: string, desc: string) => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    if (savedCloseTimerRef.current) window.clearTimeout(savedCloseTimerRef.current);
    setSavedPop({ title, desc });
    setSavedClosing(false);
    setSavedSeq((n) => n + 1);
    savedTimerRef.current = window.setTimeout(() => setSavedClosing(true), 2400);
    savedCloseTimerRef.current = window.setTimeout(() => { setSavedPop(null); setSavedClosing(false); }, 2700);
  };
  useEffect(() => () => {
    if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current);
    if (savedCloseTimerRef.current) window.clearTimeout(savedCloseTimerRef.current);
  }, []);
  // tab disembunyikan saat mengirim → browser memperlambat timer; tampilkan peringatan
  const [tabHidden, setTabHidden] = useState(false);
  useEffect(() => {
    if (!sending) { setTabHidden(false); return; }
    const upd = () => setTabHidden(document.visibilityState === "hidden");
    upd();
    document.addEventListener("visibilitychange", upd);
    return () => document.removeEventListener("visibilitychange", upd);
  }, [sending]);
  const stopRef = useRef(false);
  const pauseRef = useRef(false);
  const skipRef = useRef(false); // lewati jeda berjalan

  // muat preferensi tersimpan SETELAH mount — render pertama harus identik dgn SSR.
  // Penyimpanan HANYA lewat tombol Simpan: ketikan tidak lagi tersimpan otomatis,
  // reload mengembalikan snapshot terakhir yang disimpan (bukan isi kotak saat ini).
  const [savedTpl, setSavedTpl] = useState(DEFAULT_TEMPLATE);
  const [savedFu, setSavedFu] = useState(DEFAULT_FOLLOW_UP);
  const [savedDelay, setSavedDelay] = useState<{ min: string; max: string }>({ min: DEFAULT_DELAY_MIN, max: DEFAULT_DELAY_MAX });
  useEffect(() => {
    try {
      const tpl = localStorage.getItem(LS_TEMPLATE);
      if (tpl) { setTemplate(tpl); setSavedTpl(tpl); }
      const fu = localStorage.getItem(LS_FOLLOW_UP);
      if (fu !== null) { setFollowUp(fu); setSavedFu(fu); }
      const d = JSON.parse(localStorage.getItem(LS_DELAY) ?? "null");
      if (d?.min && d?.max) {
        // bawaan lama (8/20 lalu 45/90) terlalu cepat utk nomor pribadi — naikkan sekali ke rentang aman
        if ((d.min === 8 && d.max === 20) || (d.min === 45 && d.max === 90)) {
          setDelayMin("60"); setDelayMax("150");
          setSavedDelay({ min: "60", max: "150" });
        } else {
          setDelayMin(String(d.min)); setDelayMax(String(d.max));
          setSavedDelay({ min: String(d.min), max: String(d.max) });
        }
      }
      const rec = localStorage.getItem(LS_SENT);
      if (rec) setSentRecord(JSON.parse(rec) as { hash: string; sent: string[] });
    } catch {}
  }, []);

  // ada perubahan belum disimpan? (dibanding isi kotak vs snapshot tersimpan)
  const msgDirty = template !== savedTpl || followUp !== savedFu;
  const delayDirty = delayMin !== savedDelay.min || delayMax !== savedDelay.max;

  // hash pesan yang TERSIMPAN (hasil tombol Simpan) — bukan teks yang sedang diedit.
  // Catatan terkirim hanya berlaku untuk pesan tersimpan: mengubah teks TIDAK
  // mengubah status "sudah terkirim" selama belum ditekan Simpan.
  const savedHash = useMemo(() => hashText(savedTpl), [savedTpl]);
  const sentSet = useMemo(
    () => new Set<string>(sentRecord && sentRecord.hash === savedHash ? sentRecord.sent : []),
    [sentRecord, savedHash]
  );

  // antrian = isi kotak (dijamin ≤ 50 oleh handleNumbersChange) MINUS yang sudah terkirim dgn pesan tersimpan
  const queue = useMemo(() => parsed.all.filter((r) => !sentSet.has(r.phoneDigits)), [parsed, sentSet]);

  // estimasi: jeda antar pesan
  const avgGap = (Math.max(3, Number(delayMin) || 8) + Math.max(3, Number(delayMax) || 20)) / 2;
  const followUpMsg = followUp.trim();
  const avgFollowUp = (FOLLOW_UP_DELAY_MIN_S + FOLLOW_UP_DELAY_MAX_S) / 2;
  // estimasi juga mencakup durasi simulasi mengetik per pesan
  const typingS = (len: number) => Math.min(TYPING_CAP_S, TYPING_BASE_S + (len * TYPING_MS_PER_CHAR) / 1000);
  // Estimasi total utk n penerima — mengikuti struktur loop kirim persis: pesan
  // utama penerima PERTAMA langsung terkirim (tanpa simulasi ketik), penerima
  // berikutnya disertai simulasi ketik; pesan lanjutan tanpa simulasi ketik
  // (hanya jeda 5–15 dtk); jeda antar pesan hanya di ANTARA pesan (penerima
  // terakhir tidak diikuti jeda). Tanpa itu estimasi 1 penerima membengkak
  // sebesar satu jeda penuh.
  const estTotalFor = (n: number) =>
    Math.round(
      Math.max(0, n - 1) * typingS(template.length)
      + n * (followUpMsg ? avgFollowUp : 0)
      + Math.max(0, n - 1) * avgGap
    );
  const estSeconds = estTotalFor(queue.length);
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
  const plan = runPlan;
  const planTotal = plan ? plan.total : queue.length;
  // Bar progres terisi MULUS mengikuti waktu terhadap estimasi total (seperti
  // unduhan berkas — tidak melompat per penerima); penuh hanya saat semua penerima
  // sudah diproses. Setelah selesai/berhenti: proporsi penerima terproses.
  const progressFrac =
    plan && plan.total > 0
      ? sending
        ? progressIdx >= plan.total
          ? 1
          : Math.min(0.99, plan.estTotal > 0 ? elapsedS / plan.estTotal : 0)
        : Math.min(1, progressIdx / plan.total)
      : queue.length > 0
        ? Math.min(1, progressIdx / queue.length)
        : 0;
  // Sisa waktu = mundur dari estimasi total − waktu berjalan → selalu konsisten
  // dengan baris "Estimasi total" (rumus kecepatan-aktual lama menghasilkan angka
  // ngawur, mis. "sisa <1 mnt" dua detik setelah mulai).
  const etaS = plan && sending
    ? Math.max(0, plan.estTotal - elapsedS)
    : estSeconds;

  // ---------- kirim ----------
  const sendOne = async (number: string, message: string, typing = true): Promise<{ ok: boolean; error?: string }> => {
    try {
      const resp = await fetch("/api/scraper/wa/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // typing=true → status "mengetik…" manusiawi sebelum pesan terkirim (menambah
        // 0,8–10 dtk). typing=false → pesan langsung terkirim: dipakai untuk pesan
        // PERTAMA (nomor pertama langsung jalan) dan pesan lanjutan (agar tepat
        // tiba 5–15 dtk setelah pesan pertama, tidak bertambah durasi mengetik).
        // timeout 90 dtk — sesi WhatsApp yang tidak sehat bisa membuat kirim menggantung
        body: JSON.stringify({ number, message, typing }),
        signal: AbortSignal.timeout(90_000),
      });
      const data = await resp.json().catch(() => null);
      return data?.ok ? { ok: true } : { ok: false, error: data?.error ?? `HTTP ${resp.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // jeda berdetik yang bisa dijeda / dilewati / dihentikan kapan pun.
  // DITUNGGU dengan TENGGAT WAKTU MUTLAK (bukan loop per-detik): browser
  // memperlambat timer di tab latar belakang dan loop per-detik MENUMPUK
  // keterlambatan itu (penyebab jeda membengkak jauh di luar pengaturan);
  // dengan tenggat mutlak, durasi jeda tetap akurat apa pun kondisi tab.
  const waitSecs = async (secs: number) => {
    const deadline = Date.now() + secs * 1000;
    while (Date.now() < deadline) {
      if (stopRef.current || skipRef.current) break;
      if (pauseRef.current) { await sleep(300); continue; }
      setCountdown(Math.ceil((deadline - Date.now()) / 1000));
      await sleep(Math.min(5000, Math.max(0, deadline - Date.now())));
    }
    setCountdown(0);
    skipRef.current = false;
  };

  // catat nomor berhasil terkirim utk pesan tersimpan yang sedang dipakai
  // (pengiriman hanya bisa dimulai saat pesan tidak sedang diedit — kirim selalu
  // memakai teks tersimpan, sehingga hash catatan selalu konsisten)
  const rememberSent = (digits: string) => {
    setSentRecord((prev) => {
      const cur = prev && prev.hash === savedHash ? prev.sent : [];
      const next: { hash: string; sent: string[] } = {
        hash: savedHash,
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

    setSending(true);
    setPaused(false);
    pauseRef.current = false;
    stopRef.current = false;
    skipRef.current = false;
    setSentCount(0);
    setFailCount(0);
    setProgressIdx(0);
    setStartedAt(Date.now());
    // bekukan rencana kirim: penyebut progres & dasar sisa-waktu tak berubah di tengah jalan
    setRunPlan({ total: queue.length, estTotal: estTotalFor(queue.length) });
    let sent = 0;
    let failed = 0;
    let idx = 0;
    let lastGap = -1; // jeda antar pesan sebelumnya — dipakai agar jeda berurutan tidak pernah sama

    for (; idx < queue.length; idx++) {
      if (stopRef.current) break;
      // jeda bisa ditekan kapan pun
      while (pauseRef.current && !stopRef.current) await sleep(300);
      if (stopRef.current) break;
      const r = queue[idx];
      setProgressIdx(idx + 1);
      const msg = renderTemplate(template, r);
      // pesan pertama (nomor pertama) langsung dikirim tanpa simulasi mengetik;
      // nomor berikutnya tetap dengan simulasi mengetik manusiawi
      const res = await sendOne(r.phoneDigits, msg, idx > 0);
      if (res.ok) {
        sent++;
        setSentCount(sent);
        rememberSent(r.phoneDigits);
      } else {
        failed++;
        setFailCount(failed);
      }

      // pesan lanjutan ke chat yang sama — hanya jika pesan pertama berhasil.
      // Dikirim TANPA simulasi mengetik agar tepat tiba 5–15 dtk setelah pesan pertama.
      if (followUpMsg && res.ok && !stopRef.current) {
        const fDelay = FOLLOW_UP_DELAY_MIN_S + Math.floor(Math.random() * (FOLLOW_UP_DELAY_MAX_S - FOLLOW_UP_DELAY_MIN_S + 1));
        await waitSecs(fDelay);
        if (!stopRef.current) {
          await sendOne(r.phoneDigits, renderTemplate(followUpMsg, r), false);
        }
      }

      // jeda antar pesan — diacak penuh di antara jeda minimal–maksimal (bukan
      // selalu nilai tinggi), dan TIDAK BOLEH sama dengan jeda sebelumnya:
      // sama → diacak ulang. Tidak menunggu setelah penerima terakhir.
      if (idx < queue.length - 1) {
        let d = lastGap;
        if (dMax > dMin) {
          while (d === lastGap) d = dMin + Math.floor(Math.random() * (dMax - dMin + 1));
        } else {
          d = dMin;
        }
        lastGap = d;
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

  // kirim hanya boleh dimulai saat pesan sudah disimpan — perubahan yang belum
  // ditekan Simpan tidak boleh terkirim (dan status "terkirim" mengikat ke pesan tersimpan)
  const canStart = waConnected && queue.length > 0 && template.trim().length > 0 && !sending && !msgDirty;

  // ---------- render ----------
  return (
    <div className="space-y-6 animate-fade-up" aria-label="Penawaran Massal">
      <div className="grid gap-6 lg:grid-cols-5">
        {/* kolom kiri: sumber + template */}
        <div className="lg:col-span-3 space-y-6">
          {/* langkah 1 — nomor penerima manual */}
          <Card className="pt-3 gap-3">
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
                onKeyDown={handleHistoryKeys(numbersHist, numbersLast, setNumbersInput)}
                className="text-sm font-mono leading-relaxed numbers-textarea"
                  placeholder={"82395022596\n083125626838\n6285173230850\n+6282195256729\n601170046869\n+601112895220"}
                spellCheck={false}
                disabled={sending}
              />
              {(parsed.dup > 0 || parsed.invalid > 0) && (
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
                  {parsed.dup > 0 && <span>{parsed.dup} duplikat dibuang</span>}
                  {parsed.invalid > 0 && <span className="text-amber-600 dark:text-amber-400">{parsed.invalid} tidak valid dibuang</span>}
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
          <Card className="pt-3 gap-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">2</span>
                Tulis pesan penawaran
                <Button
                  size="sm"
                  className="relative ml-auto h-7 gap-1.5 px-2.5 text-xs cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs"
                  title={msgDirty ? "Ada perubahan belum disimpan" : "Simpan pesan penawaran & pesan lanjutan"}
                  onClick={() => {
                    try {
                      localStorage.setItem(LS_TEMPLATE, template);
                      localStorage.setItem(LS_FOLLOW_UP, followUp);
                    } catch {}
                    setSavedTpl(template);
                    setSavedFu(followUp);
                    showSavedPop("Pesan Berhasil Disimpan", "Perubahan pesan telah disimpan.");
                  }}
                  disabled={sending}
                >
                  <Save className="h-3 w-3" /> Simpan
                  {msgDirty && <span className="kf-blink absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-card" />}
                </Button>
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
              ) : null}
                <Textarea
                  ref={taRef}
                  value={template}
                  onChange={(e) => {
                    recordTextHistory(templateHist, templateLast, e.target.value);
                    setTemplate(e.target.value);
                  }}
                  onKeyDown={handleHistoryKeys(templateHist, templateLast, setTemplate)}
                  rows={7}
                  className="text-sm leading-relaxed message-textarea"
                  placeholder="Tulis pesan penawaran…"
                  disabled={sending}
                />

              <Separator className="bg-border/60" />
              <div className="space-y-1.5">
                <Label className="text-xs">Pesan lanjutan (opsional)</Label>
                <Textarea
                  value={followUp}
                  onChange={(e) => {
                    recordTextHistory(followUpHist, followUpLast, e.target.value);
                    setFollowUp(e.target.value);
                  }}
                  onKeyDown={handleHistoryKeys(followUpHist, followUpLast, setFollowUp)}
                  rows={3}
                  className="text-sm leading-relaxed message-textarea message-textarea-sm"
                  placeholder={"Saya ada ide tampilannya untuk {Bisnis}. Boleh saya kirim contohnya?\n\nKosongkan untuk menonaktifkan."}
                  disabled={sending}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* kolom kanan: pengaturan + ringkasan + aksi */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="pt-3 gap-3">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <span className="h-6 w-6 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold">3</span>
                Pengaturan kirim
                <Button
                  size="sm"
                  className="relative ml-auto h-7 gap-1.5 px-2.5 text-xs cursor-pointer bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs"
                  title={delayDirty ? "Ada perubahan belum disimpan" : "Simpan pengaturan kirim"}
                  onClick={() => {
                    try {
                      localStorage.setItem(LS_DELAY, JSON.stringify({
                        min: Number(delayMin) || 60,
                        max: Number(delayMax) || 150,
                      }));
                    } catch {}
                    setSavedDelay({ min: delayMin, max: delayMax });
                    showSavedPop("Pengaturan Berhasil Disimpan", "Perubahan pengaturan telah disimpan.");
                  }}
                  disabled={sending}
                >
                  <Save className="h-3 w-3" /> Simpan
                  {delayDirty && <span className="kf-blink absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-card" />}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
              {/* pra-kirim saja — saat mengirim antrian menyusut (yang terkirim
                  keluar dari daftar) sehingga estimasi berbasis antrian menyesatkan */}
              {!sending && queue.length > 0 && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> Estimasi total ±{estLabel} (pesan pertama langsung terkirim · jeda {delayMin}–{delayMax} dtk{followUpMsg ? ` · lanjutan ${FOLLOW_UP_DELAY_MIN_S}–${FOLLOW_UP_DELAY_MAX_S} dtk setelah pesan pertama` : ""})
                </div>
              )}

              {sending && tabHidden && (
                <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Tab ini di latar belakang — browser memperlambat jeda. Biarkan tab ini tampil agar jeda sesuai pengaturan.</span>
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
                    <span className="text-muted-foreground tabular-nums">sisa {fmtMenit(etaS)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="kf-send-progress h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-[width] duration-700"
                      style={{ width: `${Math.max(progressFrac * 100, 2)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                    <span>{progressIdx} dari {planTotal} penerima terproses</span>
                    <span>{Math.round(progressFrac * 100)}%</span>
                  </div>
                </div>
              )}

              {!sending ? (
                <div className="space-y-2">
                  <Button className="w-full h-11 gap-2 text-base cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/20" disabled={!canStart} onClick={() => { void startSend(); }}>
                    <Send className="h-4.5 w-4.5" /> Mulai Kirim {queue.length > 0 ? `(${queue.length})` : ""}
                  </Button>
                  {msgDirty && queue.length > 0 && template.trim().length > 0 && waConnected && (
                    <div className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>Ada perubahan pesan belum disimpan — klik <b>Simpan</b> pada langkah 2 dulu untuk mengaktifkan pengiriman.</span>
                    </div>
                  )}
                  {/* peringatan hanya relevan saat WhatsApp terhubung — tanpa sesi,
                      antrian memang belum bisa dihitung "sudah terkirim" secara bermakna */}
                  {waConnected && parsed.all.length > 0 && queue.length === 0 && (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-5 w-5 shrink-0 self-center" />
                      <span className="leading-relaxed">
                        <span className="block">Semua nomor sudah menerima pesan ini.</span>
                        <span className="block">Ubah pesan untuk mengirim ulang, atau tambahkan nomor baru.</span>
                      </span>
                    </div>
                  )}
                </div>
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
                  {countdown > 0 && (
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

      {/* notifikasi "Berhasil Disimpan" — dirender via portal ke <body> karena
          induk halaman (animate-fade-up) menyimpan transform yang membuat
          position:fixed relatif ke elemen itu, bukan ke layar; tanpa portal
          notifikasi tidak terlihat saat halaman digulir ke bawah.
          Tanpa tombol tutup — menutup sendiri setelah ±2,4 dtk */}
      {savedPop && createPortal(
        <div
          key={savedSeq}
          className={cn(
            "kf-notify fixed left-1/2 top-4 z-50 flex w-fit max-w-[calc(100%-2rem)] items-center gap-3 rounded-2xl border border-emerald-500/30 bg-card p-4 pr-6 shadow-2xl shadow-emerald-500/10",
            savedClosing && "kf-notify-out"
          )}
          role="status"
          aria-live="polite"
        >
          <div className="kf-pop-circle flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-md shadow-emerald-500/30">
            <Check className="kf-pop-check h-6 w-6 text-white" strokeWidth={3.5} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold">{savedPop.title}</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{savedPop.desc}</p>
          </div>
        </div>,
        document.body
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
