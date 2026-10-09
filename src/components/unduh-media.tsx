"use client";

// ---------- Halaman Unduh Media ----------
// Tempel link Google Maps tempat bisnis (satu per baris) → aplikasi memanen SEMUA
// foto (video best-effort) dari tiap tempat lalu mengemasnya jadi satu arsip ZIP.
// Proses berat berjalan di mini-service scraper (port 3003); UI hanya membuat job
// (POST /api/scraper/media), memantau progres (polling tiap 2 dtk), dan mengunduh
// arsip jadi (/api/scraper/media/:id/zip).

import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  Download, Loader2, AlertTriangle, Images, Link2, Archive,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

// ---------- tipe (cermin mediaSummary di mini-service) ----------
interface MediaItem {
  url: string;
  name: string;
  slug: string;
  photos: number;
  videos: number;
  downloaded: number;
  failed: number;
  webp: number;
  savedBytes: number;
  error: string | null;
}

interface MediaJob {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  linkCount: number;
  links: string[];
  items: MediaItem[];
  logs: { t: number; level: "info" | "success" | "warn" | "error"; msg: string }[];
  cancelled: boolean;
  zipReady: boolean;
  zipBytes: number;
  percent: number;
  totals: { photos: number; videos: number; downloaded: number; failed: number; webp: number; saved: number };
}

// ---------- util ----------
function fmtBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** Parsing textarea: pisah per baris/koma/spasi, buang duplikat & yang bukan link. */
function parseLinks(raw: string): string[] {
  const tokens = raw.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!/^https?:\/\//i.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Nama arsip untuk penyimpanan lokal — sama dengan yang dipakai server. */
function zipFileName(job: MediaJob): string {
  const first = job.items.find((i) => i.slug)?.slug ?? "maps";
  const d = new Date(job.createdAt);
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `klienflow-media-${first}-${stamp}.zip`;
}

// ---------- halaman ----------
export default function UnduhMedia() {
  const { toast } = useToast();
  const [linksText, setLinksText] = useState("");
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [creating, setCreating] = useState(false);
  const [loadError, setLoadError] = useState("");
  // job yang diproses di sesi ini (dibuat lewat tombol Download sesi ini) — satu-satunya
  // job yang mengunci Download & menampilkan tombol ZIP; riwayat job lama diabaikan
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  // true saat arsip sedang diambil (fetch blob) — tombol ZIP jadi spinner
  const [zipping, setZipping] = useState(false);

  const links = useMemo(() => parseLinks(linksText), [linksText]);
  const hasRunning = jobs.some((j) => j.status === "running" || j.status === "queued");
  const active = activeJobId ? jobs.find((j) => j.id === activeJobId) ?? null : null;
  // bila kolom berisi link yang BERBEDA dari job aktif, arsip lama tidak boleh diunduh —
  // pengguna harus menekan Download dulu dengan link baru itu (urutan link diabaikan)
  const linksChanged =
    links.length > 0 &&
    active != null &&
    JSON.stringify([...links].sort()) !== JSON.stringify([...active.links].sort());

  // job SESI INI sudah selesai & arsip siap → link di kotak sudah diunduh: Download
  // terkunci, satu-satunya tombol aktif adalah Unduh Arsip ZIP
  const sessionReady = active != null && active.zipReady && !linksChanged;
  const zipJob = sessionReady ? active : null;

  const loadJobs = useCallback(async () => {
    try {
      const r = await fetch("/api/scraper/media", { cache: "no-store" });
      const data = await r.json();
      if (data?.ok) {
        setJobs(data.jobs as MediaJob[]);
        setLoadError("");
      } else {
        setLoadError(data?.error ?? "Gagal memuat daftar job media");
      }
    } catch (e: any) {
      setLoadError(`Layanan scraper tidak merespons: ${e?.message ?? e}`);
    }
  }, []);

  // muat daftar saat masuk tab + polling selama ada job berjalan
  useEffect(() => { void loadJobs(); }, [loadJobs]);
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(() => { void loadJobs(); }, 2000);
    return () => clearInterval(t);
  }, [hasRunning, loadJobs]);

  const start = async () => {
    if (links.length === 0 || creating) return;
    setCreating(true);
    try {
      const r = await fetch("/api/scraper/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // kompresi WebP "Web Kencang" (maks 1280px · q72) selalu aktif sebagai default
        body: JSON.stringify({ links, webp: true, preset: "web" }),
      });
      const data = await r.json();
      if (data?.ok) {
        setActiveJobId(data.job.id as string);
        // link dibiarkan di kotak — begitu job selesai Download terkunci otomatis
        // (link sudah diunduh) dan hanya Unduh Arsip ZIP yang bisa diklik
        toast({ title: "Unduhan dimulai", description: `${data.job.linkCount} link sedang diproses.` });
        await loadJobs();
      } else {
        toast({ title: "Gagal memulai", description: data?.error ?? "Tidak diketahui", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Gagal memulai", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  // Ambil arsip ZIP: unduh utuh ke browser DULU (blob), baru hapus job + berkas +
  // arsip di server — riwayat unduhan tidak disimpan agar layanan tetap ringan.
  const takeZip = async () => {
    if (!zipJob || zipping) return;
    setZipping(true);
    try {
      const r = await fetch(`/api/scraper/media/${encodeURIComponent(zipJob.id)}/zip`, { cache: "no-store" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFileName(zipJob);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      // arsip sudah utuh di tangan pengguna → hapus seluruh jejaknya di server
      await fetch(`/api/scraper/media/${encodeURIComponent(zipJob.id)}`, { method: "DELETE" }).catch(() => {});
      setJobs((prev) => prev.filter((j) => j.id !== zipJob.id));
      setActiveJobId(null);
      setLinksText("");
      toast({ title: "Arsip ZIP diunduh", description: "Data unduhan sudah dihapus dari server." });
    } catch (e: any) {
      toast({ title: "Gagal mengunduh arsip", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="space-y-5 animate-fade-up">
      {/* ---------- form tempel link ---------- */}
      <Card className="pt-4 sm:pt-4.5 pb-6 gap-4 sm:gap-4.5">
        <CardHeader className="pb-0">
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Images className="h-5 w-5 text-emerald-500" />
            Unduh Semua Media dari Link Google Maps
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="media-links" className="text-sm font-medium">Link Google Maps</Label>
              {links.length > 0 && (
                <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Link2 className="h-2.5 w-2.5" /> {links.length} link
                </Badge>
              )}
            </div>
            <Textarea
              id="media-links"
              value={linksText}
              onChange={(e) => setLinksText(e.target.value)}
              placeholder={"https://maps.app.goo.gl/xxxxxxxx\nhttps://www.google.com/maps/place/Nama+Toko/...\nhttps://www.google.com/maps/place/?q=place_id:ChIJ..."}
              className="min-h-[130px] font-mono text-xs sm:text-[13px] leading-relaxed resize-y"
              spellCheck={false}
            />
          </div>

          {loadError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{loadError}</span>
            </div>
          )}

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={start}
                disabled={links.length === 0 || creating || hasRunning || sessionReady}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : hasRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {creating
                  ? "Memulai…"
                  : hasRunning
                    ? active && (active.status === "running" || active.status === "queued")
                      ? `Sedang mengunduh ${active.percent}%…`
                      : "Sedang mengunduh…"
                    : `Download${links.length ? ` (${links.length})` : ""}`}
              </Button>
              {zipJob && (
                <Button
                  onClick={takeZip}
                  disabled={zipping}
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                >
                  {zipping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                  {zipping ? "Mengunduh arsip…" : `Unduh Arsip ZIP (${fmtBytes(zipJob.zipBytes)})`}
                </Button>
              )}
              {active?.status === "failed" && active.error && (
                <span className="text-xs text-red-600 dark:text-red-400 inline-flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {active.error}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
