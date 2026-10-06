"use client";

// ---------- Editor Spreadsheet (ala Google Sheets) ----------
// Popup untuk melihat & mengedit isi file Excel yang dimuat di Penawaran
// Massal. Model kerjanya draf: sel yang diedit belum tersimpan — klik
// "Selesai" untuk menyimpan ke daftar pengiriman, menutup popup (✕/Esc/klik
// luar) membuang perubahan. Ctrl+Z mengurungkan, Ctrl+Y / Ctrl+Shift+Z
// mengulang. Satu langkah undo per sel yang disunting (per sesi fokus),
// sama seperti Google Sheets.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, Undo2, Redo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { colLetter, type SheetSource } from "@/lib/spreadsheet";

// kelas sel: input tanpa border yang saat fokus menyerupai sel aktif spreadsheet
const CELL =
  "w-full min-w-[150px] bg-transparent px-2.5 py-1.5 text-xs outline-none focus:bg-background focus:ring-2 focus:ring-inset focus:ring-emerald-500/50";
const CELL_HEAD =
  "w-full min-w-[150px] bg-transparent px-2.5 py-2 text-xs font-semibold outline-none focus:bg-background focus:ring-2 focus:ring-inset focus:ring-emerald-500/50";
const TD = "border-r border-b border-border/60 p-0 align-middle";
const ROWNUM =
  "sticky left-0 z-20 w-10 min-w-10 bg-muted/80 text-center text-[10px] text-muted-foreground border-r border-b border-border/60 tabular-nums";

// riwayat undo: masa lalu + kondisi kini + yang sudah di-undo (bisa di-redo)
interface History {
  past: SheetSource[];
  present: SheetSource;
  future: SheetSource[];
}
const HISTORY_MAX = 100; // batas langkah undo agar memori tidak membengkak

interface Props {
  sheet: SheetSource;               // data tersimpan (belum termasuk draf popup)
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (s: SheetSource) => void; // dipanggil saat "Selesai" dengan draf terbaru
}

export default function SheetEditorDialog({ sheet, open, onOpenChange, onSave }: Props) {
  // Draf hidup di dalam riwayat editor. Komponen dimount ulang setiap kali
  // popup dibuka, jadi draf selalu mulai dari data tersimpan dan hilang
  // (dibuang) saat popup ditutup tanpa menyimpan.
  const [hist, setHist] = useState<History>(() => ({ past: [], present: sheet, future: [] }));
  const draft = hist.present;

  // sesi fokus sel: undefined = tidak sedang menyunting; null = sesi aktif dan
  // snapshootnya sudah masuk riwayat; selain itu = kondisi sebelum disunting
  // (didorong ke riwayat sekali per sesi fokus, bukan per ketukan tombol).
  const sessionRef = useRef<SheetSource | null | undefined>(undefined);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(sheet),
    [draft, sheet]
  );

  const applyEdit = useCallback((next: SheetSource) => {
    const snap = sessionRef.current;
    if (snap !== undefined) sessionRef.current = null; // konsumsi sekali per sesi fokus
    setHist((h) => {
      // undefined → sesi fokus tidak ada: dorong kondisi kini (aksi baris/tambah);
      // null → sesi berjalan & sudah tercatat: jangan dorong apa pun;
      // selain itu → dorong kondisi sebelum sel disunting (satu langkah per sesi).
      const push: SheetSource | null = snap === undefined ? h.present : snap;
      return {
        past: (push ? [...h.past, push] : h.past).slice(-HISTORY_MAX),
        present: next,
        future: [],
      };
    });
  }, []);

  const undo = useCallback(() => {
    // akhiri sesi fokus berjalan agar ketikan setelah undo tercatat sbg langkah baru
    sessionRef.current = undefined;
    setHist((h) =>
      h.past.length === 0
        ? h
        : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
    );
  }, []);

  const redo = useCallback(() => {
    sessionRef.current = undefined;
    setHist((h) =>
      h.future.length === 0
        ? h
        : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
    );
  }, []);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — aktif selama popup terbuka, menimpa
  // undo bawaan input teks agar undo berlaku pada seluruh grid (ala Sheets).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.key) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undo, redo]);

  const updateHeader = (c: number, v: string) => {
    applyEdit({ ...draft, headers: draft.headers.map((h, i) => (i === c ? v : h)) });
  };
  const updateCell = (r: number, c: number, v: string) => {
    applyEdit({
      ...draft,
      rows: draft.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)),
    });
  };
  const deleteRow = (r: number) => {
    applyEdit({ ...draft, rows: draft.rows.filter((_, i) => i !== r) });
  };
  const addRow = () => {
    applyEdit({ ...draft, rows: [...draft.rows, draft.headers.map(() => "")] });
  };

  const focusCell = () => { sessionRef.current = draft; };   // mulai sesi: catat kondisi sebelum
  const blurCell = () => { sessionRef.current = undefined; }; // akhiri sesi

  const finish = () => {
    if (dirty) onSave(draft); // tanpa perubahan → cukup tutup
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        // tanpa auto-focus saat dibuka — sel pertama tidak ikut ter-highlight
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-[96vw] max-w-[96vw] h-[90vh] flex flex-col gap-3 p-0 sm:max-w-[96vw] overflow-hidden"
      >
        <DialogHeader className="px-5 pt-5 pb-0 shrink-0">
          <DialogTitle className="text-base min-w-0 pr-8 truncate" title={sheet.fileName}>
            {sheet.fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto px-5">
          <table className="border-collapse w-max min-w-full">
            <thead className="sticky top-0 z-30">
              <tr>
                <th className="sticky left-0 z-40 w-10 min-w-10 bg-muted border-r border-b border-border/60" aria-label="Nomor baris" />
                {draft.headers.map((_, i) => (
                  <th key={i} className="bg-muted border-r border-b border-border/60 px-2.5 py-1 text-[10px] font-normal text-muted-foreground text-center min-w-[150px]">
                    {colLetter(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={ROWNUM}>1</td>
                {draft.headers.map((h, c) => (
                  <td key={c} className={`${TD} bg-emerald-500/10`}>
                    <input
                      className={CELL_HEAD}
                      data-mm-cell
                      value={h}
                      onChange={(e) => updateHeader(c, e.target.value)}
                      onFocus={focusCell}
                      onBlur={blurCell}
                      spellCheck={false}
                    />
                  </td>
                ))}
              </tr>
              {draft.rows.map((row, r) => (
                <tr key={r} className="group">
                  <td className={`${ROWNUM} relative`}>
                    <span className="group-hover:opacity-0">{r + 2}</span>
                    <button
                      type="button"
                      title="Hapus baris ini"
                      onClick={() => deleteRow(r)}
                      className="absolute inset-0 hidden group-hover:flex items-center justify-center text-red-500 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </td>
                  {draft.headers.map((_, c) => (
                    <td key={c} className={TD}>
                      <input
                        className={CELL}
                        data-mm-cell
                        value={row[c] ?? ""}
                        onChange={(e) => updateCell(r, c, e.target.value)}
                        onFocus={focusCell}
                        onBlur={blurCell}
                        spellCheck={false}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border/60 shrink-0 flex items-center justify-between gap-3 sm:justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 cursor-pointer" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" /> Tambah baris
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 cursor-pointer" onClick={undo} disabled={hist.past.length === 0}
              title="Urungkan (Ctrl+Z)">
              <Undo2 className="h-3.5 w-3.5" /> Urungkan
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 cursor-pointer" onClick={redo} disabled={hist.future.length === 0}
              title="Ulangi (Ctrl+Y)">
              <Redo2 className="h-3.5 w-3.5" /> Ulangi
            </Button>
          </div>
          <Button size="sm" className="cursor-pointer" onClick={finish} title="Simpan perubahan dan tutup">
            Selesai
          </Button>
        </DialogFooter>

        {/* ✕ kanan atas: menutup TANPA menyimpan (draf dibuang) */}
        <DialogClose
          className="absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 cursor-pointer"
          title="Tutup tanpa menyimpan — perubahan dibuang"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Tutup tanpa menyimpan</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
