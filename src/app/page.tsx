"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useTheme } from "next-themes";
import { useToast } from "@/hooks/use-toast";
import {
  MapPin, Search, Loader2, Download, FileSpreadsheet, Trash2, Star, Phone,
  Globe, Clock, ExternalLink, Moon, Sun, Layers, Database, CheckCircle2,
  XCircle, AlertTriangle, ChevronUp, ChevronDown, Radar, MapPinned, Sparkles,
  History, PhoneOff, TrendingUp, Activity, ListFilter, Copy, RotateCcw,
  Braces, MessageCircle, NotebookPen, Users, Info,
  Map as MapIcon,
  Building2, Navigation, Check, X, GitMerge, Layers3, Zap, Lightbulb, BellRing, StarHalf, Mail,
  Boxes, Target, RefreshCw, Inbox, Instagram, Facebook, Music2, Megaphone, ListChecks, Columns3,
  AtSign, CalendarRange, ChevronsUpDown, Images,
} from "lucide-react";

import { SYNONYM_CLUSTERS } from "@/data/synonym-clusters";

import PenawaranMassal from "@/components/penawaran-massal";
import UnduhMedia from "@/components/unduh-media";
import { WhatsAppIcon } from "@/components/whatsapp-icon";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuCheckboxItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Glif resmi WhatsApp sebagai SVG monokrom (fill=currentColor) — mengikuti warna tema
// agar menyatu dengan ikon Lucide lain, tanpa kotak hijau yang bertabrakan dgn emerald tema.
// ---------- tipe data (sesuai mini-service) ----------
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type LeadStatus = "baru" | "dihubungi" | "prospek" | "deal" | "tidak-tertarik";

interface JobSummary {
  id: string;
  keyword: string;
  city: string;
  keywords?: string[];
  deepMode: boolean;
  status: JobStatus;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  progress: { phase: string; percent: number; searchDone: number; searchTotal: number; detailsDone: number; detailsTotal: number };
  stats: { total: number; withPhone: number; withWebsite: number; withEmail: number; withSocial?: number; withRating: number; avgRating: number | null; withHours: number; quadrants: number; variantsRun: number };
  resolvedArea: string | null;
  placesCount: number;
  error: string | null;
}

interface Place {
  cid: string; placeId: string; kgid: string; name: string;
  categories: string[]; fullAddress: string; shortAddress: string;
  desa: string; kecamatan: string; kabupaten: string; provinsi: string;
  postalCode: string; plusCode: string; area: string;
  phone: string; phoneIntl: string; phoneDigits: string; website: string;
  email?: string; emailStatus?: string;
  instagram?: string; facebook?: string; tiktok?: string; socialStatus?: string;
  rating: number | null; reviewsCount: number | null;
  hours: { day: string; time: string }[]; hoursText: string;
  lat: number | null; lng: number | null; mapsUrl: string;
  businessStatus: string; timezone: string;
  detailStatus: "pending" | "ok" | "failed"; sourceQuery: string; foundAt: string;
  leadStatus?: LeadStatus; leadNote?: string; leadUpdatedAt?: number | null;
}

interface JobLog { t: number; level: "info" | "success" | "warn" | "error"; msg: string }
interface JobVariant { query: string; url: string; zoomLevel: number | null; placesFound: number; isQuadrant: boolean }

interface JobFull extends JobSummary {
  logs: JobLog[];
  variants: JobVariant[];
  places: Place[];
}

interface ServiceStats {
  jobsTotal: number;
  jobsCompleted: number;
  placesScraped: number;
  version?: string;
}

interface MasterSummary {
  totalUnique: number;
  dupRemoved: number;
  sources: number;
  lastUpdate: number | null;
  stats: { total: number; withPhone: number; withWebsite: number; withEmail: number; withSocial?: number; withRating: number; avgRating: number | null; withHours: number; quadrants: number; variantsRun: number };
  leadCounts: Record<string, number>;
  byCity: { name: string; count: number }[];
  byCategory: { name: string; count: number }[];
}

// ---------- konstanta UI ----------
const KEYWORD_CHIPS = ["Barbershop", "Toko Sepatu", "Distro", "Kedai Kopi", "Laundry", "Bengkel", "Klinik Gigi", "Toko Bangunan", "Wedding Organizer", "Fotokopi"];
const CITY_CHIPS = ["Subang", "Bandung", "Jakarta", "Surabaya", "Semarang", "Yogyakarta", "Bekasi", "Cirebon"];

// Daftar lengkap kabupaten/kota Indonesia
const ALL_KABUPATEN: { label: string; provinsi: string }[] = [
  // Aceh
  { label: "Banda Aceh", provinsi: "Aceh" }, { label: "Kab. Aceh Besar", provinsi: "Aceh" }, { label: "Kab. Pidie", provinsi: "Aceh" }, { label: "Kab. Bireuen", provinsi: "Aceh" }, { label: "Lhokseumawe", provinsi: "Aceh" }, { label: "Kab. Aceh Utara", provinsi: "Aceh" }, { label: "Langsa", provinsi: "Aceh" }, { label: "Kab. Aceh Timur", provinsi: "Aceh" }, { label: "Sabang", provinsi: "Aceh" }, { label: "Kab. Aceh Selatan", provinsi: "Aceh" }, { label: "Kab. Aceh Barat", provinsi: "Aceh" }, { label: "Kab. Aceh Tengah", provinsi: "Aceh" }, { label: "Kab. Aceh Tenggara", provinsi: "Aceh" }, { label: "Kab. Simeulue", provinsi: "Aceh" }, { label: "Kab. Nagan Raya", provinsi: "Aceh" }, { label: "Kab. Gayo Lues", provinsi: "Aceh" }, { label: "Subulussalam", provinsi: "Aceh" },
  // Sumatera Utara
  { label: "Medan", provinsi: "Sumatera Utara" }, { label: "Binjai", provinsi: "Sumatera Utara" }, { label: "Pematangsiantar", provinsi: "Sumatera Utara" }, { label: "Tebing Tinggi", provinsi: "Sumatera Utara" }, { label: "Tanjungbalai", provinsi: "Sumatera Utara" }, { label: "Sibolga", provinsi: "Sumatera Utara" }, { label: "Padangsidimpuan", provinsi: "Sumatera Utara" }, { label: "Gunungsitoli", provinsi: "Sumatera Utara" }, { label: "Kab. Deli Serdang", provinsi: "Sumatera Utara" }, { label: "Kab. Langkat", provinsi: "Sumatera Utara" }, { label: "Kab. Serdang Bedagai", provinsi: "Sumatera Utara" }, { label: "Kab. Asahan", provinsi: "Sumatera Utara" }, { label: "Kab. Labuhanbatu", provinsi: "Sumatera Utara" }, { label: "Kab. Tapanuli Utara", provinsi: "Sumatera Utara" }, { label: "Kab. Tapanuli Selatan", provinsi: "Sumatera Utara" }, { label: "Kab. Tapanuli Tengah", provinsi: "Sumatera Utara" }, { label: "Kab. Karo", provinsi: "Sumatera Utara" }, { label: "Kab. Toba Samosir", provinsi: "Sumatera Utara" }, { label: "Kab. Samosir", provinsi: "Sumatera Utara" }, { label: "Kab. Humbang Hasundutan", provinsi: "Sumatera Utara" }, { label: "Kab. Mandailing Natal", provinsi: "Sumatera Utara" }, { label: "Kab. Nias", provinsi: "Sumatera Utara" }, { label: "Kab. Nias Selatan", provinsi: "Sumatera Utara" },
  // Sumatera Barat
  { label: "Padang", provinsi: "Sumatera Barat" }, { label: "Bukittinggi", provinsi: "Sumatera Barat" }, { label: "Payakumbuh", provinsi: "Sumatera Barat" }, { label: "Solok", provinsi: "Sumatera Barat" }, { label: "Sawahlunto", provinsi: "Sumatera Barat" }, { label: "Padang Panjang", provinsi: "Sumatera Barat" }, { label: "Pariaman", provinsi: "Sumatera Barat" }, { label: "Kab. Agam", provinsi: "Sumatera Barat" }, { label: "Kab. Lima Puluh Kota", provinsi: "Sumatera Barat" }, { label: "Kab. Tanah Datar", provinsi: "Sumatera Barat" }, { label: "Kab. Pasaman", provinsi: "Sumatera Barat" }, { label: "Kab. Pesisir Selatan", provinsi: "Sumatera Barat" }, { label: "Kab. Sijunjung", provinsi: "Sumatera Barat" }, { label: "Kab. Dharmasraya", provinsi: "Sumatera Barat" }, { label: "Kab. Kepulauan Mentawai", provinsi: "Sumatera Barat" },
  // Riau
  { label: "Pekanbaru", provinsi: "Riau" }, { label: "Dumai", provinsi: "Riau" }, { label: "Kab. Kampar", provinsi: "Riau" }, { label: "Kab. Rokan Hulu", provinsi: "Riau" }, { label: "Kab. Rokan Hilir", provinsi: "Riau" }, { label: "Kab. Siak", provinsi: "Riau" }, { label: "Kab. Bengkalis", provinsi: "Riau" }, { label: "Kab. Pelalawan", provinsi: "Riau" }, { label: "Kab. Indragiri Hulu", provinsi: "Riau" }, { label: "Kab. Indragiri Hilir", provinsi: "Riau" }, { label: "Kab. Kuantan Singingi", provinsi: "Riau" }, { label: "Kab. Kepulauan Meranti", provinsi: "Riau" },
  // Jambi
  { label: "Jambi", provinsi: "Jambi" }, { label: "Sungai Penuh", provinsi: "Jambi" }, { label: "Kab. Muaro Jambi", provinsi: "Jambi" }, { label: "Kab. Batanghari", provinsi: "Jambi" }, { label: "Kab. Bungo", provinsi: "Jambi" }, { label: "Kab. Tebo", provinsi: "Jambi" }, { label: "Kab. Merangin", provinsi: "Jambi" }, { label: "Kab. Sarolangun", provinsi: "Jambi" }, { label: "Kab. Tanjung Jabung Barat", provinsi: "Jambi" }, { label: "Kab. Tanjung Jabung Timur", provinsi: "Jambi" }, { label: "Kab. Kerinci", provinsi: "Jambi" },
  // Sumatera Selatan
  { label: "Palembang", provinsi: "Sumatera Selatan" }, { label: "Prabumulih", provinsi: "Sumatera Selatan" }, { label: "Pagar Alam", provinsi: "Sumatera Selatan" }, { label: "Lubuklinggau", provinsi: "Sumatera Selatan" }, { label: "Kab. Ogan Ilir", provinsi: "Sumatera Selatan" }, { label: "Kab. Ogan Komering Ilir", provinsi: "Sumatera Selatan" }, { label: "Kab. Ogan Komering Ulu", provinsi: "Sumatera Selatan" }, { label: "Kab. Banyuasin", provinsi: "Sumatera Selatan" }, { label: "Kab. Musi Banyuasin", provinsi: "Sumatera Selatan" }, { label: "Kab. Musi Rawas", provinsi: "Sumatera Selatan" }, { label: "Kab. Muara Enim", provinsi: "Sumatera Selatan" }, { label: "Kab. Lahat", provinsi: "Sumatera Selatan" },
  // Bengkulu
  { label: "Bengkulu", provinsi: "Bengkulu" }, { label: "Kab. Bengkulu Utara", provinsi: "Bengkulu" }, { label: "Kab. Bengkulu Selatan", provinsi: "Bengkulu" }, { label: "Kab. Bengkulu Tengah", provinsi: "Bengkulu" }, { label: "Kab. Rejang Lebong", provinsi: "Bengkulu" }, { label: "Kab. Kepahiang", provinsi: "Bengkulu" }, { label: "Kab. Mukomuko", provinsi: "Bengkulu" }, { label: "Kab. Kaur", provinsi: "Bengkulu" }, { label: "Kab. Seluma", provinsi: "Bengkulu" },
  // Lampung
  { label: "Bandar Lampung", provinsi: "Lampung" }, { label: "Metro", provinsi: "Lampung" }, { label: "Kab. Lampung Selatan", provinsi: "Lampung" }, { label: "Kab. Lampung Tengah", provinsi: "Lampung" }, { label: "Kab. Lampung Utara", provinsi: "Lampung" }, { label: "Kab. Lampung Barat", provinsi: "Lampung" }, { label: "Kab. Lampung Timur", provinsi: "Lampung" }, { label: "Kab. Tanggamus", provinsi: "Lampung" }, { label: "Kab. Pringsewu", provinsi: "Lampung" }, { label: "Kab. Pesawaran", provinsi: "Lampung" }, { label: "Kab. Way Kanan", provinsi: "Lampung" }, { label: "Kab. Tulang Bawang", provinsi: "Lampung" }, { label: "Kab. Mesuji", provinsi: "Lampung" }, { label: "Kab. Pesisir Barat", provinsi: "Lampung" },
  // Bangka Belitung
  { label: "Pangkalpinang", provinsi: "Bangka Belitung" }, { label: "Kab. Bangka", provinsi: "Bangka Belitung" }, { label: "Kab. Bangka Tengah", provinsi: "Bangka Belitung" }, { label: "Kab. Bangka Barat", provinsi: "Bangka Belitung" }, { label: "Kab. Bangka Selatan", provinsi: "Bangka Belitung" }, { label: "Kab. Belitung", provinsi: "Bangka Belitung" }, { label: "Kab. Belitung Timur", provinsi: "Bangka Belitung" },
  // Kepulauan Riau
  { label: "Batam", provinsi: "Kepulauan Riau" }, { label: "Tanjungpinang", provinsi: "Kepulauan Riau" }, { label: "Kab. Bintan", provinsi: "Kepulauan Riau" }, { label: "Kab. Karimun", provinsi: "Kepulauan Riau" }, { label: "Kab. Lingga", provinsi: "Kepulauan Riau" }, { label: "Kab. Natuna", provinsi: "Kepulauan Riau" }, { label: "Kab. Anambas", provinsi: "Kepulauan Riau" },
  // DKI Jakarta
  { label: "Jakarta Pusat", provinsi: "DKI Jakarta" }, { label: "Jakarta Utara", provinsi: "DKI Jakarta" }, { label: "Jakarta Barat", provinsi: "DKI Jakarta" }, { label: "Jakarta Selatan", provinsi: "DKI Jakarta" }, { label: "Jakarta Timur", provinsi: "DKI Jakarta" }, { label: "Kepulauan Seribu", provinsi: "DKI Jakarta" },
  // Jawa Barat
  { label: "Bandung", provinsi: "Jawa Barat" }, { label: "Bekasi", provinsi: "Jawa Barat" }, { label: "Bogor", provinsi: "Jawa Barat" }, { label: "Cimahi", provinsi: "Jawa Barat" }, { label: "Cirebon", provinsi: "Jawa Barat" }, { label: "Depok", provinsi: "Jawa Barat" }, { label: "Sukabumi", provinsi: "Jawa Barat" }, { label: "Tasikmalaya", provinsi: "Jawa Barat" }, { label: "Banjar", provinsi: "Jawa Barat" }, { label: "Kab. Bandung", provinsi: "Jawa Barat" }, { label: "Kab. Bandung Barat", provinsi: "Jawa Barat" }, { label: "Kab. Bekasi", provinsi: "Jawa Barat" }, { label: "Kab. Bogor", provinsi: "Jawa Barat" }, { label: "Kab. Ciamis", provinsi: "Jawa Barat" }, { label: "Kab. Cianjur", provinsi: "Jawa Barat" }, { label: "Kab. Cirebon", provinsi: "Jawa Barat" }, { label: "Kab. Garut", provinsi: "Jawa Barat" }, { label: "Kab. Indramayu", provinsi: "Jawa Barat" }, { label: "Kab. Karawang", provinsi: "Jawa Barat" }, { label: "Kab. Kuningan", provinsi: "Jawa Barat" }, { label: "Kab. Majalengka", provinsi: "Jawa Barat" }, { label: "Kab. Pangandaran", provinsi: "Jawa Barat" }, { label: "Kab. Purwakarta", provinsi: "Jawa Barat" }, { label: "Kab. Subang", provinsi: "Jawa Barat" }, { label: "Kab. Sukabumi", provinsi: "Jawa Barat" }, { label: "Kab. Sumedang", provinsi: "Jawa Barat" }, { label: "Kab. Tasikmalaya", provinsi: "Jawa Barat" },
  // Banten
  { label: "Serang", provinsi: "Banten" }, { label: "Tangerang", provinsi: "Banten" }, { label: "Tangerang Selatan", provinsi: "Banten" }, { label: "Cilegon", provinsi: "Banten" }, { label: "Kab. Serang", provinsi: "Banten" }, { label: "Kab. Tangerang", provinsi: "Banten" }, { label: "Kab. Lebak", provinsi: "Banten" }, { label: "Kab. Pandeglang", provinsi: "Banten" },
  // Jawa Tengah
  { label: "Semarang", provinsi: "Jawa Tengah" }, { label: "Solo", provinsi: "Jawa Tengah" }, { label: "Magelang", provinsi: "Jawa Tengah" }, { label: "Pekalongan", provinsi: "Jawa Tengah" }, { label: "Salatiga", provinsi: "Jawa Tengah" }, { label: "Tegal", provinsi: "Jawa Tengah" }, { label: "Purwokerto", provinsi: "Jawa Tengah" }, { label: "Kab. Banjarnegara", provinsi: "Jawa Tengah" }, { label: "Kab. Banyumas", provinsi: "Jawa Tengah" }, { label: "Kab. Batang", provinsi: "Jawa Tengah" }, { label: "Kab. Blora", provinsi: "Jawa Tengah" }, { label: "Kab. Boyolali", provinsi: "Jawa Tengah" }, { label: "Kab. Brebes", provinsi: "Jawa Tengah" }, { label: "Kab. Cilacap", provinsi: "Jawa Tengah" }, { label: "Kab. Demak", provinsi: "Jawa Tengah" }, { label: "Kab. Grobogan", provinsi: "Jawa Tengah" }, { label: "Kab. Jepara", provinsi: "Jawa Tengah" }, { label: "Kab. Karanganyar", provinsi: "Jawa Tengah" }, { label: "Kab. Kebumen", provinsi: "Jawa Tengah" }, { label: "Kab. Kendal", provinsi: "Jawa Tengah" }, { label: "Kab. Klaten", provinsi: "Jawa Tengah" }, { label: "Kab. Kudus", provinsi: "Jawa Tengah" }, { label: "Kab. Magelang", provinsi: "Jawa Tengah" }, { label: "Kab. Pati", provinsi: "Jawa Tengah" }, { label: "Kab. Pekalongan", provinsi: "Jawa Tengah" }, { label: "Kab. Pemalang", provinsi: "Jawa Tengah" }, { label: "Kab. Purbalingga", provinsi: "Jawa Tengah" }, { label: "Kab. Purworejo", provinsi: "Jawa Tengah" }, { label: "Kab. Rembang", provinsi: "Jawa Tengah" }, { label: "Kab. Semarang", provinsi: "Jawa Tengah" }, { label: "Kab. Sragen", provinsi: "Jawa Tengah" }, { label: "Kab. Sukoharjo", provinsi: "Jawa Tengah" }, { label: "Kab. Tegal", provinsi: "Jawa Tengah" }, { label: "Kab. Temanggung", provinsi: "Jawa Tengah" }, { label: "Kab. Wonogiri", provinsi: "Jawa Tengah" }, { label: "Kab. Wonosobo", provinsi: "Jawa Tengah" },
  // DI Yogyakarta
  { label: "Yogyakarta", provinsi: "DI Yogyakarta" }, { label: "Kab. Bantul", provinsi: "DI Yogyakarta" }, { label: "Kab. Gunungkidul", provinsi: "DI Yogyakarta" }, { label: "Kab. Kulon Progo", provinsi: "DI Yogyakarta" }, { label: "Kab. Sleman", provinsi: "DI Yogyakarta" },
  // Jawa Timur
  { label: "Surabaya", provinsi: "Jawa Timur" }, { label: "Malang", provinsi: "Jawa Timur" }, { label: "Blitar", provinsi: "Jawa Timur" }, { label: "Batu", provinsi: "Jawa Timur" }, { label: "Kediri", provinsi: "Jawa Timur" }, { label: "Madiun", provinsi: "Jawa Timur" }, { label: "Mojokerto", provinsi: "Jawa Timur" }, { label: "Pasuruan", provinsi: "Jawa Timur" }, { label: "Probolinggo", provinsi: "Jawa Timur" }, { label: "Kab. Bangkalan", provinsi: "Jawa Timur" }, { label: "Kab. Banyuwangi", provinsi: "Jawa Timur" }, { label: "Kab. Blitar", provinsi: "Jawa Timur" }, { label: "Kab. Bojonegoro", provinsi: "Jawa Timur" }, { label: "Kab. Bondowoso", provinsi: "Jawa Timur" }, { label: "Kab. Gresik", provinsi: "Jawa Timur" }, { label: "Kab. Jember", provinsi: "Jawa Timur" }, { label: "Kab. Jombang", provinsi: "Jawa Timur" }, { label: "Kab. Kediri", provinsi: "Jawa Timur" }, { label: "Kab. Lamongan", provinsi: "Jawa Timur" }, { label: "Kab. Lumajang", provinsi: "Jawa Timur" }, { label: "Kab. Madiun", provinsi: "Jawa Timur" }, { label: "Kab. Magetan", provinsi: "Jawa Timur" }, { label: "Kab. Malang", provinsi: "Jawa Timur" }, { label: "Kab. Mojokerto", provinsi: "Jawa Timur" }, { label: "Kab. Nganjuk", provinsi: "Jawa Timur" }, { label: "Kab. Ngawi", provinsi: "Jawa Timur" }, { label: "Kab. Pacitan", provinsi: "Jawa Timur" }, { label: "Kab. Pamekasan", provinsi: "Jawa Timur" }, { label: "Kab. Pasuruan", provinsi: "Jawa Timur" }, { label: "Kab. Ponorogo", provinsi: "Jawa Timur" }, { label: "Kab. Probolinggo", provinsi: "Jawa Timur" }, { label: "Kab. Sampang", provinsi: "Jawa Timur" }, { label: "Kab. Sidoarjo", provinsi: "Jawa Timur" }, { label: "Kab. Situbondo", provinsi: "Jawa Timur" }, { label: "Kab. Sumenep", provinsi: "Jawa Timur" }, { label: "Kab. Trenggalek", provinsi: "Jawa Timur" }, { label: "Kab. Tuban", provinsi: "Jawa Timur" }, { label: "Kab. Tulungagung", provinsi: "Jawa Timur" },
  // Bali
  { label: "Denpasar", provinsi: "Bali" }, { label: "Kab. Badung", provinsi: "Bali" }, { label: "Kab. Bangli", provinsi: "Bali" }, { label: "Kab. Buleleng", provinsi: "Bali" }, { label: "Kab. Gianyar", provinsi: "Bali" }, { label: "Kab. Jembrana", provinsi: "Bali" }, { label: "Kab. Karangasem", provinsi: "Bali" }, { label: "Kab. Klungkung", provinsi: "Bali" }, { label: "Kab. Tabanan", provinsi: "Bali" },
  // NTB
  { label: "Mataram", provinsi: "NTB" }, { label: "Bima", provinsi: "NTB" }, { label: "Kab. Bima", provinsi: "NTB" }, { label: "Kab. Dompu", provinsi: "NTB" }, { label: "Kab. Lombok Barat", provinsi: "NTB" }, { label: "Kab. Lombok Tengah", provinsi: "NTB" }, { label: "Kab. Lombok Timur", provinsi: "NTB" }, { label: "Kab. Lombok Utara", provinsi: "NTB" }, { label: "Kab. Sumbawa", provinsi: "NTB" }, { label: "Kab. Sumbawa Barat", provinsi: "NTB" },
  // NTT
  { label: "Kupang", provinsi: "NTT" }, { label: "Kab. Flores Timur", provinsi: "NTT" }, { label: "Kab. Manggarai", provinsi: "NTT" }, { label: "Kab. Manggarai Barat", provinsi: "NTT" }, { label: "Kab. Manggarai Timur", provinsi: "NTT" }, { label: "Kab. Ende", provinsi: "NTT" }, { label: "Kab. Sikka", provinsi: "NTT" }, { label: "Kab. Ngada", provinsi: "NTT" }, { label: "Kab. Nagekeo", provinsi: "NTT" }, { label: "Kab. Sumba Barat", provinsi: "NTT" }, { label: "Kab. Sumba Timur", provinsi: "NTT" }, { label: "Kab. Sumba Tengah", provinsi: "NTT" }, { label: "Kab. Sumba Barat Daya", provinsi: "NTT" }, { label: "Kab. Kupang", provinsi: "NTT" }, { label: "Kab. Timor Tengah Selatan", provinsi: "NTT" }, { label: "Kab. Timor Tengah Utara", provinsi: "NTT" }, { label: "Kab. Belu", provinsi: "NTT" }, { label: "Kab. Alor", provinsi: "NTT" }, { label: "Kab. Lembata", provinsi: "NTT" }, { label: "Kab. Rote Ndao", provinsi: "NTT" }, { label: "Kab. Sabu Raijua", provinsi: "NTT" }, { label: "Kab. Malaka", provinsi: "NTT" },
  // Kalimantan Barat
  { label: "Pontianak", provinsi: "Kalimantan Barat" }, { label: "Singkawang", provinsi: "Kalimantan Barat" }, { label: "Kab. Sambas", provinsi: "Kalimantan Barat" }, { label: "Kab. Bengkayang", provinsi: "Kalimantan Barat" }, { label: "Kab. Landak", provinsi: "Kalimantan Barat" }, { label: "Kab. Mempawah", provinsi: "Kalimantan Barat" }, { label: "Kab. Sanggau", provinsi: "Kalimantan Barat" }, { label: "Kab. Ketapang", provinsi: "Kalimantan Barat" }, { label: "Kab. Sintang", provinsi: "Kalimantan Barat" }, { label: "Kab. Kapuas Hulu", provinsi: "Kalimantan Barat" }, { label: "Kab. Sekadau", provinsi: "Kalimantan Barat" }, { label: "Kab. Melawi", provinsi: "Kalimantan Barat" }, { label: "Kab. Kayong Utara", provinsi: "Kalimantan Barat" }, { label: "Kab. Kubu Raya", provinsi: "Kalimantan Barat" },
  // Kalimantan Tengah
  { label: "Palangkaraya", provinsi: "Kalimantan Tengah" }, { label: "Kab. Kotawaringin Barat", provinsi: "Kalimantan Tengah" }, { label: "Kab. Kotawaringin Timur", provinsi: "Kalimantan Tengah" }, { label: "Kab. Kapuas", provinsi: "Kalimantan Tengah" }, { label: "Kab. Barito Selatan", provinsi: "Kalimantan Tengah" }, { label: "Kab. Barito Utara", provinsi: "Kalimantan Tengah" }, { label: "Kab. Katingan", provinsi: "Kalimantan Tengah" }, { label: "Kab. Seruyan", provinsi: "Kalimantan Tengah" }, { label: "Kab. Sukamara", provinsi: "Kalimantan Tengah" }, { label: "Kab. Lamandau", provinsi: "Kalimantan Tengah" }, { label: "Kab. Gunung Mas", provinsi: "Kalimantan Tengah" }, { label: "Kab. Pulang Pisau", provinsi: "Kalimantan Tengah" }, { label: "Kab. Murung Raya", provinsi: "Kalimantan Tengah" }, { label: "Kab. Barito Timur", provinsi: "Kalimantan Tengah" },
  // Kalimantan Selatan
  { label: "Banjarmasin", provinsi: "Kalimantan Selatan" }, { label: "Banjarbaru", provinsi: "Kalimantan Selatan" }, { label: "Kab. Banjar", provinsi: "Kalimantan Selatan" }, { label: "Kab. Barito Kuala", provinsi: "Kalimantan Selatan" }, { label: "Kab. Hulu Sungai Selatan", provinsi: "Kalimantan Selatan" }, { label: "Kab. Hulu Sungai Tengah", provinsi: "Kalimantan Selatan" }, { label: "Kab. Hulu Sungai Utara", provinsi: "Kalimantan Selatan" }, { label: "Kab. Kotabaru", provinsi: "Kalimantan Selatan" }, { label: "Kab. Tabalong", provinsi: "Kalimantan Selatan" }, { label: "Kab. Tanah Bumbu", provinsi: "Kalimantan Selatan" }, { label: "Kab. Tanah Laut", provinsi: "Kalimantan Selatan" }, { label: "Kab. Tapin", provinsi: "Kalimantan Selatan" }, { label: "Kab. Balangan", provinsi: "Kalimantan Selatan" },
  // Kalimantan Timur
  { label: "Samarinda", provinsi: "Kalimantan Timur" }, { label: "Balikpapan", provinsi: "Kalimantan Timur" }, { label: "Bontang", provinsi: "Kalimantan Timur" }, { label: "Kab. Berau", provinsi: "Kalimantan Timur" }, { label: "Kab. Kutai Barat", provinsi: "Kalimantan Timur" }, { label: "Kab. Kutai Kartanegara", provinsi: "Kalimantan Timur" }, { label: "Kab. Kutai Timur", provinsi: "Kalimantan Timur" }, { label: "Kab. Mahakam Ulu", provinsi: "Kalimantan Timur" }, { label: "Kab. Paser", provinsi: "Kalimantan Timur" }, { label: "Kab. Penajam Paser Utara", provinsi: "Kalimantan Timur" },
  // Kalimantan Utara
  { label: "Tarakan", provinsi: "Kalimantan Utara" }, { label: "Kab. Bulungan", provinsi: "Kalimantan Utara" }, { label: "Kab. Malinau", provinsi: "Kalimantan Utara" }, { label: "Kab. Nunukan", provinsi: "Kalimantan Utara" }, { label: "Kab. Tana Tidung", provinsi: "Kalimantan Utara" },
  // Sulawesi Utara
  { label: "Manado", provinsi: "Sulawesi Utara" }, { label: "Bitung", provinsi: "Sulawesi Utara" }, { label: "Tomohon", provinsi: "Sulawesi Utara" }, { label: "Kotamobagu", provinsi: "Sulawesi Utara" }, { label: "Kab. Minahasa", provinsi: "Sulawesi Utara" }, { label: "Kab. Minahasa Selatan", provinsi: "Sulawesi Utara" }, { label: "Kab. Minahasa Tenggara", provinsi: "Sulawesi Utara" }, { label: "Kab. Minahasa Utara", provinsi: "Sulawesi Utara" }, { label: "Kab. Bolaang Mongondow", provinsi: "Sulawesi Utara" }, { label: "Kab. Kepulauan Sangihe", provinsi: "Sulawesi Utara" }, { label: "Kab. Kepulauan Talaud", provinsi: "Sulawesi Utara" },
  // Sulawesi Tengah
  { label: "Palu", provinsi: "Sulawesi Tengah" }, { label: "Kab. Banggai", provinsi: "Sulawesi Tengah" }, { label: "Kab. Banggai Kepulauan", provinsi: "Sulawesi Tengah" }, { label: "Kab. Buol", provinsi: "Sulawesi Tengah" }, { label: "Kab. Donggala", provinsi: "Sulawesi Tengah" }, { label: "Kab. Morowali", provinsi: "Sulawesi Tengah" }, { label: "Kab. Poso", provinsi: "Sulawesi Tengah" }, { label: "Kab. Toli-Toli", provinsi: "Sulawesi Tengah" }, { label: "Kab. Tojo Una-Una", provinsi: "Sulawesi Tengah" }, { label: "Kab. Sigi", provinsi: "Sulawesi Tengah" }, { label: "Kab. Parigi Moutong", provinsi: "Sulawesi Tengah" },
  // Sulawesi Selatan
  { label: "Makassar", provinsi: "Sulawesi Selatan" }, { label: "Parepare", provinsi: "Sulawesi Selatan" }, { label: "Palopo", provinsi: "Sulawesi Selatan" }, { label: "Kab. Bantaeng", provinsi: "Sulawesi Selatan" }, { label: "Kab. Barru", provinsi: "Sulawesi Selatan" }, { label: "Kab. Bone", provinsi: "Sulawesi Selatan" }, { label: "Kab. Bulukumba", provinsi: "Sulawesi Selatan" }, { label: "Kab. Enrekang", provinsi: "Sulawesi Selatan" }, { label: "Kab. Gowa", provinsi: "Sulawesi Selatan" }, { label: "Kab. Jeneponto", provinsi: "Sulawesi Selatan" }, { label: "Kab. Kepulauan Selayar", provinsi: "Sulawesi Selatan" }, { label: "Kab. Luwu", provinsi: "Sulawesi Selatan" }, { label: "Kab. Luwu Timur", provinsi: "Sulawesi Selatan" }, { label: "Kab. Luwu Utara", provinsi: "Sulawesi Selatan" }, { label: "Kab. Maros", provinsi: "Sulawesi Selatan" }, { label: "Kab. Pangkajene", provinsi: "Sulawesi Selatan" }, { label: "Kab. Pinrang", provinsi: "Sulawesi Selatan" }, { label: "Kab. Sinjai", provinsi: "Sulawesi Selatan" }, { label: "Kab. Sidenreng Rappang", provinsi: "Sulawesi Selatan" }, { label: "Kab. Soppeng", provinsi: "Sulawesi Selatan" }, { label: "Kab. Takalar", provinsi: "Sulawesi Selatan" }, { label: "Kab. Tana Toraja", provinsi: "Sulawesi Selatan" }, { label: "Kab. Toraja Utara", provinsi: "Sulawesi Selatan" }, { label: "Kab. Wajo", provinsi: "Sulawesi Selatan" },
  // Sulawesi Tenggara
  { label: "Kendari", provinsi: "Sulawesi Tenggara" }, { label: "Bau-Bau", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Buton", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Buton Utara", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Buton Tengah", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Buton Selatan", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Kolaka", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Kolaka Timur", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Kolaka Utara", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Konawe", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Konawe Selatan", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Konawe Utara", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Muna", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Muna Barat", provinsi: "Sulawesi Tenggara" }, { label: "Kab. Wakatobi", provinsi: "Sulawesi Tenggara" },
  // Gorontalo
  { label: "Gorontalo", provinsi: "Gorontalo" }, { label: "Kab. Boalemo", provinsi: "Gorontalo" }, { label: "Kab. Bone Bolango", provinsi: "Gorontalo" }, { label: "Kab. Gorontalo", provinsi: "Gorontalo" }, { label: "Kab. Gorontalo Utara", provinsi: "Gorontalo" }, { label: "Kab. Pohuwato", provinsi: "Gorontalo" },
  // Sulawesi Barat
  { label: "Mamuju", provinsi: "Sulawesi Barat" }, { label: "Kab. Majene", provinsi: "Sulawesi Barat" }, { label: "Kab. Mamasa", provinsi: "Sulawesi Barat" }, { label: "Kab. Mamuju Tengah", provinsi: "Sulawesi Barat" }, { label: "Kab. Mamuju Utara", provinsi: "Sulawesi Barat" }, { label: "Kab. Polewali Mandar", provinsi: "Sulawesi Barat" },
  // Maluku
  { label: "Ambon", provinsi: "Maluku" }, { label: "Tual", provinsi: "Maluku" }, { label: "Kab. Buru", provinsi: "Maluku" }, { label: "Kab. Buru Selatan", provinsi: "Maluku" }, { label: "Kab. Kepulauan Aru", provinsi: "Maluku" }, { label: "Kab. Maluku Barat Daya", provinsi: "Maluku" }, { label: "Kab. Maluku Tengah", provinsi: "Maluku" }, { label: "Kab. Maluku Tenggara", provinsi: "Maluku" }, { label: "Kab. Seram Bagian Barat", provinsi: "Maluku" }, { label: "Kab. Seram Bagian Timur", provinsi: "Maluku" },
  // Maluku Utara
  { label: "Ternate", provinsi: "Maluku Utara" }, { label: "Tidore Kepulauan", provinsi: "Maluku Utara" }, { label: "Kab. Halmahera Barat", provinsi: "Maluku Utara" }, { label: "Kab. Halmahera Tengah", provinsi: "Maluku Utara" }, { label: "Kab. Halmahera Timur", provinsi: "Maluku Utara" }, { label: "Kab. Halmahera Utara", provinsi: "Maluku Utara" }, { label: "Kab. Halmahera Selatan", provinsi: "Maluku Utara" }, { label: "Kab. Kepulauan Sula", provinsi: "Maluku Utara" }, { label: "Kab. Pulau Morotai", provinsi: "Maluku Utara" }, { label: "Kab. Pulau Taliabu", provinsi: "Maluku Utara" },
  // Papua Barat
  { label: "Manokwari", provinsi: "Papua Barat" }, { label: "Sorong", provinsi: "Papua Barat" }, { label: "Kab. Fakfak", provinsi: "Papua Barat" }, { label: "Kab. Kaimana", provinsi: "Papua Barat" }, { label: "Kab. Manokwari Selatan", provinsi: "Papua Barat" }, { label: "Kab. Maybrat", provinsi: "Papua Barat" }, { label: "Kab. Pegunungan Arfak", provinsi: "Papua Barat" }, { label: "Kab. Raja Ampat", provinsi: "Papua Barat" }, { label: "Kab. Sorong", provinsi: "Papua Barat" }, { label: "Kab. Sorong Selatan", provinsi: "Papua Barat" }, { label: "Kab. Tambrauw", provinsi: "Papua Barat" }, { label: "Kab. Teluk Bintuni", provinsi: "Papua Barat" }, { label: "Kab. Teluk Wondama", provinsi: "Papua Barat" },
  // Papua
  { label: "Jayapura", provinsi: "Papua" }, { label: "Kab. Asmat", provinsi: "Papua" }, { label: "Kab. Biak Numfor", provinsi: "Papua" }, { label: "Kab. Boven Digoel", provinsi: "Papua" }, { label: "Kab. Deiyai", provinsi: "Papua" }, { label: "Kab. Dogiyai", provinsi: "Papua" }, { label: "Kab. Intan Jaya", provinsi: "Papua" }, { label: "Kab. Jayapura", provinsi: "Papua" }, { label: "Kab. Jayawijaya", provinsi: "Papua" }, { label: "Kab. Keerom", provinsi: "Papua" }, { label: "Kab. Kepulauan Yapen", provinsi: "Papua" }, { label: "Kab. Lanny Jaya", provinsi: "Papua" }, { label: "Kab. Mamberamo Raya", provinsi: "Papua" }, { label: "Kab. Mamberamo Tengah", provinsi: "Papua" }, { label: "Kab. Mappi", provinsi: "Papua" }, { label: "Kab. Merauke", provinsi: "Papua" }, { label: "Kab. Mimika", provinsi: "Papua" }, { label: "Kab. Nabire", provinsi: "Papua" }, { label: "Kab. Nduga", provinsi: "Papua" }, { label: "Kab. Paniai", provinsi: "Papua" }, { label: "Kab. Pegunungan Bintang", provinsi: "Papua" }, { label: "Kab. Puncak", provinsi: "Papua" }, { label: "Kab. Puncak Jaya", provinsi: "Papua" }, { label: "Kab. Sarmi", provinsi: "Papua" }, { label: "Kab. Supiori", provinsi: "Papua" }, { label: "Kab. Tolikara", provinsi: "Papua" }, { label: "Kab. Waropen", provinsi: "Papua" }, { label: "Kab. Yalimo", provinsi: "Papua" }, { label: "Kab. Yahukimo", provinsi: "Papua" },
];

/** Klaster sinonim kini hidup di src/data/synonym-clusters.ts (v2: 40 → 95 klaster,
 *  1.700+ istilah) — dipindah agar kamus bisa berkembang tanpa membebani halaman.
 *  Semua istilah lama dipertahankan; batas 16 istilah per klaster sudah tidak ada
 *  (engine batch menerima kata kunci sebanyak apa pun). */
/** Kamus sinonim final: setiap istilah dicari terhadap semua klaster di atas */

/** Menghitung jarak Levenshtein sederhana untuk toleransi salah ketik / typo */
function levenshteinDist(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/** Menghasilkan saran sinonim cerdas untuk kata kunci apapun yang diketik.
 *  Aturan kemurnian: frasa yang cocok PERSIS / batas-kata dgn istilah kamus menghasilkan
 *  saran murni satu klaster ("SMP" → semua istilah SMP saja, tanpa SD/SMA/SMK).
 *  Pencocokan per-kata & typo hanya dipakai bila frasa tidak dikenali kamus,
 *  lalu dilengkapi saran Google Suggest dari /api/ai/synonyms. */
function getSynonymsForKeyword(rawKeyword: string): string[] {
  const clean = rawKeyword.trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return [];

  const matched = new Set<number>(); // indeks klaster yang sudah dimasukkan
  const seen = new Set<string>([clean]);
  const out: string[] = [];
  const addCluster = (idx: number) => {
    if (matched.has(idx)) return;
    matched.add(idx);
    for (const s of SYNONYM_CLUSTERS[idx]) {
      const low = s.toLowerCase();
      if (!seen.has(low)) {
        seen.add(low);
        out.push(s);
      }
    }
  };

  // kata generik tidak dipakai mencocokkan per-kata — "toko" cocok dengan semua "toko X"
  const GENERIC_WORDS = new Set(["toko", "tempat", "jasa", "servis", "service", "agen", "pusat", "kantor"]);
  const words = clean.split(" ").filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  // cocokkan hanya pada batas kata: "bakso" ✓ "bakso solo", ✗ "warung"≠"war"
  const wordHit = (low: string, w: string) =>
    low === w || low.startsWith(w + " ") || low.endsWith(" " + w) || low.includes(" " + w + " ");
  // frasa utuh: identik, awalan (gaya autocomplete "apo"→"apotek"), atau berada pada
  // batas kata — substring mentah membuat "toko bangunan" salah cocok "toko ban"
  const phraseHit = (low: string) => {
    if (low === clean) return true;
    if (clean.length >= 3 && low.startsWith(clean)) return true;
    if (low.length >= 4 &&
      (clean.startsWith(low + " ") || clean.endsWith(" " + low) || clean.includes(" " + low + " "))) return true;
    if (clean.length >= 4 &&
      (low.startsWith(clean + " ") || low.endsWith(" " + clean) || low.includes(" " + clean + " "))) return true;
    return false;
  };

  // 1. Kecocokan PERSIS dengan istilah kamus → saran MURNI satu klaster saja.
  //    "sekolah SMP" / "SMP" → hanya klaster SMP (tidak dicampur SD/SMA/SMK), dst.
  let exactHit = false;
  for (let i = 0; i < SYNONYM_CLUSTERS.length; i++) {
    if (SYNONYM_CLUSTERS[i].some((t) => t.toLowerCase() === clean)) {
      addCluster(i);
      exactHit = true;
    }
  }
  if (exactHit) return out;

  // 2. Frasa pada batas kata / awalan (autocomplete "sekolah sd neg…" → "sekolah sd") → juga murni
  let phraseMatched = false;
  for (let i = 0; i < SYNONYM_CLUSTERS.length; i++) {
    if (matched.has(i)) continue;
    for (const term of SYNONYM_CLUSTERS[i]) {
      if (phraseHit(term.toLowerCase())) {
        addCluster(i);
        phraseMatched = true;
        break;
      }
    }
  }
  if (phraseMatched) return out;

  // 3. Per kata penting (≥3 huruf, bukan kata generik) — v13.6: kata hanya dicocokkan
  //    ke ISTILAH UTAMA klaster (elemen pertama = nama kategori), BUKAN ke semua
  //    istilah. Satu kata yang kebetulan muncul di istilah pinggiran ("kos" pada
  //    "warung anak kos") tidak boleh menyeret seluruh klaster gorengan ke
  //    pencarian "kos kaki" — itulah sumber saran "ngaco".
  for (let i = 0; i < SYNONYM_CLUSTERS.length; i++) {
    if (matched.has(i)) continue;
    const head = SYNONYM_CLUSTERS[i][0].toLowerCase();
    if (words.some((w) => wordHit(head, w))) addCluster(i);
  }

  // 4. Typo-tolerant (Levenshtein) — mis. "babershop" → "barbershop", "apotik" → "apotek".
  //    v13.7: diperketat lagi — kamus bisnis Indonesia penuh pasangan kata NYATA beda
  //    makna yang hanya beda 1–2 huruf ("gendong" vs "rendang"/"genteng", "renang" vs
  //    "rendang", "salon" vs "sablon", "warung" vs "sarung"), jadi:
  //    (a) kata tunggal: jarak ≤1 (≥5 huruf); jarak ≤2 hanya untuk ≥9 huruf —
  //        2 salinan pada kata 7–8 huruf hampir selalu dua kata berbeda;
  //    (b) frasa multi-kata: setiap kata hanya di-typo-match ke ISTILAH UTAMA klaster
  //        (head), jarak ≤1, keduanya ≥5 huruf — bukan ke 1.700+ istilah pinggiran
  //        (pelajaran v13.6 yang sama, kini berlaku juga untuk typo).
  const typoBudget = (n: number) => (n >= 9 ? 2 : n >= 5 ? 1 : 0);
  const phraseTypo = !clean.includes(" ");
  for (let i = 0; i < SYNONYM_CLUSTERS.length; i++) {
    if (matched.has(i)) continue;
    if (phraseTypo) {
      // kata tunggal: typo pada frasa utuh diperbolehkan
      for (const term of SYNONYM_CLUSTERS[i]) {
        const low = term.toLowerCase();
        if (Math.abs(low.length - clean.length) > 2) continue;
        if (levenshteinDist(clean, low) <= typoBudget(Math.min(clean.length, low.length))) {
          addCluster(i);
          break;
        }
      }
      continue;
    }
    // frasa multi-kata: hanya kata utama klaster yang boleh di-typo-match
    const head = SYNONYM_CLUSTERS[i][0].toLowerCase();
    if (head.length < 5) continue;
    for (const w of words) {
      if (w.length < 5) continue;
      if (matched.has(i)) break;
      if (levenshteinDist(w, head) <= typoBudget(Math.min(w.length, head.length))) {
        addCluster(i);
        break;
      }
    }
  }

  // batasi tampilan 30 saran teratas — klaster paling relevan (kecocokan frasa) selalu duluan;
  // "Centang Semua" tanpa batas jumlah — sebanyak apa pun sinonimnya dicentang semua.
  if (out.length > 0) return out.slice(0, 30);

  // 5. Fallback umum NETRAL (tanpa asumsi jenis usaha — tidak ada lagi "Toko Sekolah").
  //    Kata kunci di luar kamus dilengkapi saran AI dari /api/ai/synonyms.
  return [
    `${clean} terdekat`,
    `${clean} terbaik`,
    `${clean} terlengkap`,
    `${clean} 24 jam`,
  ];
}

const STATUS_META: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: "Dalam Antrian", cls: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/20" },
  running: { label: "Sedang Berjalan", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  completed: { label: "Selesai", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  failed: { label: "Gagal", cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30" },
  cancelled: { label: "Dibatalkan", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
};

const LEAD_META: Record<LeadStatus, { label: string; short: string; dot: string; chip: string; bar: string }> = {
  "baru": { label: "Baru", short: "Baru", dot: "bg-zinc-400", chip: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-300 border-zinc-500/25", bar: "bg-zinc-400/80" },
  "dihubungi": { label: "Sudah Dihubungi", short: "Dihubungi", dot: "bg-amber-400", chip: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", bar: "bg-amber-400/80" },
  "prospek": { label: "Prospek", short: "Prospek", dot: "bg-violet-400", chip: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30", bar: "bg-violet-400/80" },
  "deal": { label: "Deal / Closing", short: "Deal", dot: "bg-emerald-400", chip: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", bar: "bg-emerald-400/80" },
  "tidak-tertarik": { label: "Tidak Tertarik", short: "Tdk Tertarik", dot: "bg-rose-400", chip: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30", bar: "bg-rose-400/80" },
};
const LEAD_ORDER: LeadStatus[] = ["baru", "dihubungi", "prospek", "deal", "tidak-tertarik"];

// v8.1: definisi kolom tabel yang bisa disembunyikan pengguna (persist localStorage)
type ColKey = "alamat" | "rating" | "telepon" | "email" | "sosmed" | "kecamatan" | "prospek" | "jam";
const COL_DEFS: { key: ColKey; label: string; hint: string }[] = [
  { key: "alamat", label: "Alamat", hint: "Alamat lengkap + desa/kelurahan" },
  { key: "rating", label: "Rating", hint: "Bintang + jumlah ulasan" },
  { key: "telepon", label: "Telepon", hint: "Nomor telepon (klik untuk dial)" },
  { key: "email", label: "Email", hint: "Hasil pencarian email" },
  { key: "sosmed", label: "Sosmed", hint: "IG / FB / TikTok" },
  { key: "kecamatan", label: "Kecamatan", hint: "Wilayah kecamatan" },
  { key: "prospek", label: "Prospek", hint: "Status CRM lead" },
  { key: "jam", label: "Jam Buka", hint: "Jam operasional" },
];

/** waktu relatif id-ID ringkas ("2 jam lalu", "3 hari lalu") */
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "baru saja";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} hari lalu`;
  return fmtDate(ts);
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
}
function fmtDur(s: number): string {
  if (s < 60) return `${s.toFixed(0)} dtk`;
  const m = Math.floor(s / 60);
  return `${m} mnt ${Math.round(s % 60)} dtk`;
}

/** 08979062595 → 628979062595 (untuk link WhatsApp) */
function waNumber(digits: string): string | null {
  if (!digits) return null;
  const d = digits.replace(/\D/g, "");
  if (d.startsWith("62")) return d;
  if (d.startsWith("8")) return "62" + d;
  if (d.startsWith("0")) return "62" + d.slice(1);
  return null;
}

/** v9: ekstrak @username dari URL Instagram (hanya profil — bukan /p/, /reel/, /explore/).
 *  Utk salin massal & DM broadcast: "https://instagram.com/toko_abc/?hl=id" → "@toko_abc" */
const IG_JUNK_HANDLES = new Set(["whatsapp", "instagram", "facebook", "tiktok", "youtube", "google"]);
function igHandle(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
  if (!m) return null;
  const user = m[1].replace(/\.$/, "");
  if (["p", "reel", "reels", "explore", "stories", "tv", "accounts"].includes(user.toLowerCase())) return null;
  if (IG_JUNK_HANDLES.has(user.toLowerCase())) return null; // akun resmi platform, bukan akun bisnis
  if (user.length < 2 || user.length > 40) return null;
  return `@${user}`;
}

/** v10: ekstrak @username dari URL TikTok — utk DM broadcast / kolab konten.
 *  "https://www.tiktok.com/@toko_abc" → "@toko_abc"; link pendek vt.tiktok.com tidak bisa diekstrak. */
const TT_RESERVED_PATHS = ["video", "user", "discover", "tag", "music", "embed", "foryou", "foryoupage", "explore", "search", "live", "upload", "trending", "news"];
const TT_JUNK_HANDLES = new Set(["whatsapp", "tiktok", "instagram", "facebook", "youtube", "google"]);
function ttHandle(url: string | undefined | null): string | null {
  if (!url) return null;
  const at = url.match(/tiktok\.com\/@([A-Za-z0-9_.]{1,40})/i);
  if (at) {
    const user = at[1].replace(/\.$/, "");
    if (TT_JUNK_HANDLES.has(user.toLowerCase())) return null;
    return `@${user}`;
  }
  // link pendek (vt.tiktok.com/…) tidak memuat username — jangan coba diekstrak
  if (/\bvt\.tiktok\.com/i.test(url)) return null;
  const m = url.match(/(?:www\.|m\.)?tiktok\.com\/([A-Za-z0-9_.]{2,40})(?:[/?#]|$)/i);
  if (!m) return null;
  const user = m[1];
  if (TT_RESERVED_PATHS.includes(user.toLowerCase())) return null;
  if (TT_JUNK_HANDLES.has(user.toLowerCase())) return null;
  return `@${user}`;
}

/** v10: penanda sel kosong — titik halus, menggantikan "—" yang memenuhi tabel (kurang noise visual) */
function Dash() {
  return <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-muted-foreground/40 align-middle" />;
}

/** salin teks ke clipboard dengan fallback execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------- CityCombobox ----------
const POPULAR_CITIES = [
  "Jakarta Selatan", "Jakarta Pusat", "Bandung", "Surabaya",
  "Semarang", "Yogyakarta", "Medan", "Makassar", "Denpasar",
  "Bekasi", "Tangerang", "Bogor", "Depok", "Malang", "Subang"
];

function CityCombobox({ value, onChange, invalid, shakeSeq = 0 }: { value: string; onChange: (v: string) => void; invalid?: boolean; shakeSeq?: number }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const normalizedQuery = search.toLowerCase().trim();

  const grouped = React.useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const item of ALL_KABUPATEN) {
      if (!normalizedQuery || item.label.toLowerCase().includes(normalizedQuery) || item.provinsi.toLowerCase().includes(normalizedQuery)) {
        if (!result[item.provinsi]) result[item.provinsi] = [];
        result[item.provinsi].push(item.label);
      }
    }
    return result;
  }, [normalizedQuery]);

  const totalResults = Object.values(grouped).reduce((a, b) => a + b.length, 0);

  const exactMatch = ALL_KABUPATEN.some(
    (item) => item.label.toLowerCase() === normalizedQuery
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id="city"
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls="city-combobox-panel"
          aria-label="Pilih kota atau kabupaten"
          className={`group flex h-11 w-full items-center justify-between rounded-md border bg-background/80 dark:bg-[#2a2a2a] px-3 py-2 text-sm shadow-xs transition-all duration-150 outline-none select-none cursor-pointer ${
            invalid ? `kf-required ${shakeSeq % 2 === 1 ? "kf-alt" : ""}` : open
              ? "border-emerald-500/80 ring-2 ring-emerald-500/20"
              : value
              ? "border-emerald-500/40 hover:border-emerald-500/70"
              : "border-input hover:border-emerald-500/40"
          }`}
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
              value ? "text-emerald-500" : "text-muted-foreground"
            }`}>
              <MapPin className="h-4 w-4" />
            </span>
            <span className={`truncate text-left ${value ? "font-medium text-foreground" : "text-zinc-500 dark:text-zinc-500"}`}>
              {value || "cth: subang, bandung, kabupaten purwakarta…"}
            </span>
          </span>

          <span className="flex items-center gap-1 shrink-0 ml-2">
            {value && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange("");
                  setSearch("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onChange("");
                    setSearch("");
                  }
                }}
                title="Hapus pilihan"
                className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors" />
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        id="city-combobox-panel"
        className="p-0 border border-border/80 bg-popover text-popover-foreground shadow-2xl rounded-xl overflow-hidden min-w-[320px] max-w-[480px] z-50"
        style={{ width: "var(--radix-popover-trigger-width)" }}
        align="start"
        sideOffset={4}
      >
        {/* Header pencarian tanpa outline bocor */}
        <div className="flex h-11 items-center gap-2.5 border-b border-border/60 bg-muted/20 px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            data-slot="command-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (totalResults > 0) {
                  const firstCity = Object.values(grouped)[0]?.[0];
                  if (firstCity) {
                    onChange(firstCity);
                    setOpen(false);
                    setSearch("");
                  }
                } else if (search.trim()) {
                  onChange(search.trim());
                  setOpen(false);
                  setSearch("");
                }
              }
            }}
            placeholder="Cari kota, kabupaten, atau provinsi..."
            className="flex-1 bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none border-none shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none"
            autoFocus
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
              title="Reset pencarian"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <span className="shrink-0 rounded bg-muted/70 px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground">
            {totalResults} {totalResults === 1 ? "kota" : "wilayah"}
          </span>
        </div>

        {/* Opsi Custom Location jika mengetik kata kunci baru */}
        {normalizedQuery && !exactMatch && (
          <div className="border-b border-border/40 bg-emerald-500/10 px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onChange(search.trim());
                setOpen(false);
                setSearch("");
              }}
              className="flex w-full items-center gap-2 text-left text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 transition-colors cursor-pointer"
            >
              <MapPinned className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Gunakan lokasi kustom: <strong>&quot;{search.trim()}&quot;</strong></span>
            </button>
          </div>
        )}

        {/* Chips Populer saat belum mengetik */}
        {!normalizedQuery && (
          <div className="border-b border-border/40 bg-muted/10 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Sering Dicari:
            </div>
            <div className="flex flex-wrap gap-1">
              {POPULAR_CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onChange(c);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`rounded-md border px-2 py-0.5 text-xs transition-colors cursor-pointer ${
                    value === c
                      ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-semibold"
                      : "border-border/60 bg-background/80 text-foreground/70 hover:border-emerald-500/40 hover:text-foreground hover:bg-muted"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* List Scrollable dengan Custom Scrollbar & Sticky Province Header.
            Tanpa padding atas (px-1 pb-1) supaya header sticky menempel rata
            dgn tepi geser — baris yang lewat tidak muncul di celah atasnya. */}
        <div className="max-h-[280px] overflow-y-auto custom-scrollbar px-1 pb-1">
          {totalResults === 0 ? (
            <div className="py-7 px-4 text-center">
              <MapPin className="mx-auto h-7 w-7 text-muted-foreground/30 mb-2" />
              <p className="text-[13px] font-semibold text-foreground">Tidak ada wilayah &quot;{search}&quot;</p>
              <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                Tetap bisa mencari dengan kata kunci area ini.
              </p>
              <button
                type="button"
                onClick={() => {
                  onChange(search.trim());
                  setOpen(false);
                  setSearch("");
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3 py-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <Check className="h-3 w-3" /> Gunakan &quot;{search.trim()}&quot;
              </button>
            </div>
          ) : (
            Object.entries(grouped).map(([provinsi, cities]) => (
              <div key={provinsi} className="mb-2 last:mb-0">
                {/* Sticky Province Header */}
                <div className="sticky top-0 z-10 flex items-center justify-between bg-popover px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 border-b border-border/40">
                  <span>{provinsi}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{cities.length}</span>
                </div>

                {/* City Items */}
                <div className="pt-0.5 space-y-0.5">
                  {cities.map((cityName) => {
                    const isSelected = value === cityName;
                    return (
                      <button
                        key={cityName}
                        type="button"
                        onClick={() => {
                          onChange(cityName);
                          setOpen(false);
                          setSearch("");
                        }}
                        className={`w-full group flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-left transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold border border-emerald-500/30"
                            : "text-foreground hover:bg-muted/70 hover:text-foreground"
                        }`}
                      >
                        {isSelected ? (
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        ) : (
                          <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground" />
                        )}
                        <span className="truncate flex-1">{cityName}</span>
                        <span className="shrink-0 rounded bg-muted/70 px-1 py-0.5 text-[10px] text-muted-foreground border border-border/40">
                          {provinsi}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer Informatif */}
        <div className="flex items-center justify-between border-t border-border/50 bg-muted/20 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5 truncate">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
            514 kabupaten & kota se-Indonesia
          </span>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setSearch("");
              }}
              className="text-rose-500 hover:text-rose-400 font-medium transition-colors shrink-0 ml-2 cursor-pointer"
            >
              Hapus pilihan
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------- komponen kecil ----------

/** Animasi angka naik (count-up) — dari nilai sebelumnya ke nilai baru, easing halus */
function useCountUp(target: number, duration = 700): number {
  const [val, setVal] = useState(0);
  const prevRef = useRef(0);
  useEffect(() => {
    const from = prevRef.current;
    prevRef.current = target;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    // animasi berjalan asinkron via requestAnimationFrame (bukan setState sinkron di effect)
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function StatMini({ icon: Icon, label, value, sub, tone = "emerald" }: {
  icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; sub?: string; tone?: string;
}) {
  const numeric = typeof value === "number" ? value : null;
  const anim = useCountUp(numeric ?? 0);
  const display =
    numeric === null
      ? value
      : Number.isInteger(numeric)
      ? Math.round(anim).toLocaleString("id-ID")
      : anim.toFixed(2).replace(".", ",");
  return (
    <div className="rounded-xl border border-border/60 bg-card p-2.5 sm:p-3.5 flex items-center gap-2.5 sm:gap-3 transition-all hover:shadow-md hover:border-emerald-500/25 hover:-translate-y-0.5">
      <div className={`h-8 w-8 sm:h-9 sm:w-9 shrink-0 rounded-lg flex items-center justify-center bg-${tone}-500/10 text-${tone}-600 dark:text-${tone}-400`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-base sm:text-lg font-bold leading-tight tabular-nums text-foreground">{display}</div>
        <div className="text-[10px] sm:text-[11px] text-muted-foreground leading-snug line-clamp-2">{label}</div>
        {sub && <div className="text-[9px] sm:text-[10px] text-emerald-600/80 dark:text-emerald-400/70 tabular-nums mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

/** Bar segmented funnel prospek */
function LeadFunnel({ places }: { places: Place[] }) {
  const counts = useMemo(() => {
    const c: Record<LeadStatus, number> = { "baru": 0, "dihubungi": 0, "prospek": 0, "deal": 0, "tidak-tertarik": 0 };
    for (const p of places) c[p.leadStatus ?? "baru"]++;
    return c;
  }, [places]);
  const total = places.length || 1;
  const touched = counts.dihubungi + counts.prospek + counts.deal + counts["tidak-tertarik"];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Manajemen Prospek
        </div>
        {touched > 0 && (
          <Badge variant="secondary" className="h-5 text-[10px] gap-1">
            {touched} sudah ditindaklanjuti dari {places.length}
          </Badge>
        )}
      </div>
      {places.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic py-1">Belum ada data tempat.</div>
      ) : (
        <>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-muted gap-px" role="img" aria-label="Proporsi status prospek">
            {LEAD_ORDER.map((s) => {
              const pct = (counts[s] / total) * 100;
              if (pct <= 0) return null;
              return <div key={s} className={LEAD_META[s].bar} style={{ width: `${pct}%` }} title={`${LEAD_META[s].label}: ${counts[s]}`} />;
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2.5">
            {LEAD_ORDER.map((s) => (
              <button
                key={s}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer tabular-nums"
                onClick={() => { /* info saja */ }}
                aria-label={`${LEAD_META[s].label}: ${counts[s]} tempat`}
              >
                <span className={`h-2 w-2 rounded-full ${LEAD_META[s].dot}`} />
                {LEAD_META[s].label} <b className="text-foreground">{counts[s]}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Histogram distribusi rating */
function RatingBars({ places }: { places: Place[] }) {
  const buckets = useMemo(() => {
    // [5.0, 4.5–4.9, 4.0–4.4, 3.0–3.9, 1.0–2.9, tanpa rating]
    const b = [0, 0, 0, 0, 0, 0];
    for (const p of places) {
      const r = p.rating;
      if (r === 5) b[0]++;
      else if (r != null && r >= 4.5) b[1]++;
      else if (r != null && r >= 4) b[2]++;
      else if (r != null && r >= 3) b[3]++;
      else if (r != null) b[4]++;
      else b[5]++;
    }
    return b;
  }, [places]);
  const labels: [string, string][] = [
    ["5.0", "bg-amber-500 dark:bg-amber-400"],
    ["4.5 – 4.9", "bg-amber-400 dark:bg-amber-400"],
    ["4.0 – 4.4", "bg-amber-300 dark:bg-amber-400/90"],
    ["3.0 – 3.9", "bg-amber-200 dark:bg-amber-400/80"],
    ["1.0 – 2.9", "bg-zinc-400 dark:bg-zinc-500"],
    ["Tanpa rating", "bg-zinc-200 dark:bg-zinc-700"],
  ];
  const max = Math.max(...buckets, 1);
  const rated = places.length - buckets[5];
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <StarHalf className="h-3.5 w-3.5" /> Distribusi Rating
        </div>
        {rated > 0 && (
          <Badge variant="secondary" className="h-5 text-[10px] gap-1 tabular-nums">
            {rated} tempat ber-rating
          </Badge>
        )}
      </div>
      {places.length === 0 ? (
        <div className="text-[11px] text-muted-foreground italic py-1">Belum ada data tempat.</div>
      ) : (
        <div className="space-y-1.5">
          {buckets.map((v, i) => (
            <div key={labels[i][0]} className="flex items-center gap-2" title={`${labels[i][0]}: ${v} tempat`}>
              <span className="w-16 shrink-0 text-[10px] text-muted-foreground text-right tabular-nums">{labels[i][0]}</span>
              <div className="flex-1 h-3.5 rounded-full bg-muted overflow-hidden">
                {v > 0 && (
                  <div
                    className={`h-full rounded-full ${labels[i][1]} transition-[width] duration-500`}
                    style={{ width: `${Math.max((v / max) * 100, 4)}%` }}
                  />
                )}
              </div>
              <span className="w-8 shrink-0 text-[10px] font-semibold tabular-nums text-foreground">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Panel cakupan per kata kunci (batch): berapa tempat yang HANYA ditemukan tiap kata —
 *  bukti langsung misi "ambil semua tanpa tersisa" (sinonim menambah tempat berbeda). */
function KeywordCoverage({ keywords, places }: { keywords: string[]; places: Place[] }) {
  const coverage = useMemo(() => {
    // cocokkan sourceQuery (cth "binatu di subang") ke kata kunci — kata terpanjang diprioritaskan
    const sorted = [...keywords].sort((a, b) => b.length - a.length);
    const counts: Record<string, number> = {};
    for (const p of places) {
      const q = (p.sourceQuery ?? "").toLowerCase();
      const kw = sorted.find(
        (k) => q.startsWith(k.toLowerCase() + " ") || q.startsWith(k.toLowerCase() + " di ")
      );
      if (kw) counts[kw] = (counts[kw] ?? 0) + 1;
    }
    return keywords.map((k) => ({ kw: k, count: counts[k] ?? 0 }));
  }, [keywords, places]);
  const max = Math.max(...coverage.map((c) => c.count), 1);
  const total = places.length || 1;
  const matched = coverage.reduce((a, c) => a + c.count, 0);
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Cakupan Kata Kunci
        </div>
        <Badge variant="secondary" className="h-5 text-[10px] gap-1 tabular-nums shrink-0">
          {matched}/{total} terpetakan
        </Badge>
      </div>
      <div className="space-y-2">
        {coverage.map(({ kw, count }, i) => (
          <div key={kw} className="flex items-center gap-2.5" title={kw + ": " + count + " tempat"}>
            <span className="w-24 sm:w-36 shrink-0 text-[11px] font-medium truncate">"{kw}"</span>
            <div className="flex-1 h-4 rounded-full bg-muted overflow-hidden" role="img" aria-label={`Kata kunci ${kw}: ${count} tempat`}>
              <div
                className="h-full rounded-full coverage-bar transition-[width] duration-500"
                style={{ width: count > 0 ? `${Math.max((count / max) * 100, 4)}%` : "0%" }}
              />
            </div>
            <span className="w-32 shrink-0 text-right text-[11px] tabular-nums">
              <b className="text-foreground">{count}</b>
              <span className="text-muted-foreground"> tempat{i === 0 ? "" : " tambahan"}</span>
            </span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground dark:text-zinc-300/90 mt-2.5 flex items-start gap-1 leading-snug">
        <Info className="h-3 w-3 mt-px shrink-0" />
        Angka = tempat yang <b>hanya</b> ditemukan kata kunci tersebut (tidak muncul di kata sebelumnya) — sinonim Google memang mengindeks himpunan tempat berbeda.
      </p>
    </div>
  );
}

/** Panel sebaran tempat per kecamatan — geo-inteligens cepat (di mana konsentrasi target?) */
function KecamatanBars({ places }: { places: Place[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      const k = p.kecamatan || "(tanpa kecamatan)";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [places]);
  const max = Math.max(...rows.map(([, v]) => v), 1);
  const distinct = new Set(places.map((p) => p.kecamatan || "-")).size;
  if (distinct < 2) return null; // tidak informatif bila cuma 1 kecamatan
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3.5 sm:p-4">
      <div className="flex items-center justify-between mb-2.5 gap-2">
        <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" /> Sebaran Kecamatan
        </div>
        <Badge variant="secondary" className="h-5 text-[10px] gap-1 tabular-nums shrink-0">
          {distinct} kecamatan
        </Badge>
      </div>
      <div className="space-y-1.5">
        {rows.map(([kec, v]) => (
          <BarRow key={kec} label={kec} value={v} max={max} tone="teal" />
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground mt-2.5 flex items-start gap-1 leading-snug">
        <Info className="h-3 w-3 mt-px shrink-0" />
        8 kecamatan teratas — klik filter “Kecamatan” di tabel utk memfokuskan aksi per wilayah.
      </p>
    </div>
  );
}

/** Bar horizontal kecil utk sebaran (kota / kategori) di panel master */
function BarRow({ label, value, max, tone = "emerald" }: { label: string; value: number; max: number; tone?: "emerald" | "teal" }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 3) : 0;
  return (
    <div className="flex items-center gap-2.5" title={`${label}: ${value} tempat`}>
      <span className="w-28 sm:w-36 shrink-0 text-[11px] font-medium truncate">{label}</span>
      <div className="flex-1 h-3.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${tone === "teal" ? "bg-gradient-to-r from-teal-500 to-emerald-400" : "coverage-bar"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}



/** Blok skeleton animasi */
function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`rounded-lg bg-muted animate-pulse ${className ?? ""}`} aria-hidden="true" />;
}

/** Skeleton monitor job saat full job masih dimuat */
function MonitorSkeleton() {
  return (
    <section className="mb-6 sm:mb-8" aria-busy="true" aria-label="Memuat data job">
      <Card className="border-border/60">
        <CardContent className="p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2 flex-1">
              <SkeletonBlock className="h-6 w-64 max-w-full" />
              <SkeletonBlock className="h-3.5 w-44 max-w-full" />
            </div>
            <SkeletonBlock className="h-9 w-36 shrink-0" />
          </div>
          <SkeletonBlock className="h-2.5 w-full" />
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonBlock key={i} className="h-[62px] w-full" />
            ))}
          </div>
          <div className="grid gap-3.5 lg:grid-cols-2">
            <SkeletonBlock className="h-32 w-full" />
            <SkeletonBlock className="h-32 w-full" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/** Skeleton tabel hasil */
function TableSkeleton() {
  return (
    <section className="mb-6 sm:mb-8" aria-busy="true" aria-label="Memuat tabel hasil">
      <Card className="border-border/60">
        <CardContent className="p-5 sm:p-6 space-y-3">
          <SkeletonBlock className="h-6 w-48" />
          <SkeletonBlock className="h-9 w-full max-w-md" />
          <div className="space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <SkeletonBlock className="h-10 w-10 shrink-0 rounded-xl" />
                <SkeletonBlock className="h-10 flex-1" />
                <SkeletonBlock className="h-10 w-24 shrink-0 hidden sm:block" />
                <SkeletonBlock className="h-10 w-20 shrink-0 hidden md:block" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function LogTerminal({ logs }: { logs: JobLog[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length]);
  const colorFor = (level: JobLog["level"]) =>
    level === "success" ? "text-emerald-400" :
    level === "warn" ? "text-amber-400" :
    level === "error" ? "text-red-400" : "text-slate-300";
  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 border-b border-zinc-800">
        <span className="h-2 w-2 rounded-full bg-red-500/70" />
        <span className="h-2 w-2 rounded-full bg-amber-500/70" />
        <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
        <span className="ml-2 text-[10px] font-mono text-zinc-500">log — klienflow-engine</span>
      </div>
      <div ref={ref} className="max-h-52 overflow-y-auto bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed custom-scrollbar" role="log" aria-label="Log proses scraping">
        {logs.length === 0 && <div className="text-zinc-500 italic">Menunggu log…</div>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-zinc-600 shrink-0 tabular-nums">{fmtTime(l.t)}</span>
            <span className={String(colorFor(l.level)) + " break-all"}>{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tombol salin kecil dengan status centang */
function CopyChip({ text, label, className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-7 px-2 gap-1 text-[11px] ${className ?? ""}`}
      onClick={async (e) => {
        e.stopPropagation();
        const ok = await copyText(text);
        if (ok) {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }
      }}
      aria-label={`Salin ${label ?? text}`}
    >
      {done ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {label && <span className="tabular-nums">{label}</span>}
    </Button>
  );
}

/** Dialog detail lengkap satu tempat + kontrol prospek */
function PlaceDialog({ place, onClose, onSaveLead, saving }: {
  place: Place | null;
  onClose: () => void;
  onSaveLead: (cid: string, patch: { leadStatus?: LeadStatus; leadNote?: string }) => void;
  saving: boolean;
}) {
  const [note, setNote] = useState("");
  const [noteDirty, setNoteDirty] = useState(false);

  // reset state saat tempat berganti (pola "adjust state saat render" — tanpa effect)
  const placeKey = place ? `${place.cid}:${place.leadUpdatedAt ?? 0}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (placeKey !== prevKey) {
    setPrevKey(placeKey);
    setNote(place?.leadNote ?? "");
    setNoteDirty(false);
  }

  if (!place) return null;
  const lead = place.leadStatus ?? "baru";
  const wa = waNumber(place.phoneDigits);
  const info: [string, string][] = ([
    ["Desa/Kelurahan", place.desa],
    ["Kecamatan", place.kecamatan],
    ["Kabupaten/Kota", place.kabupaten],
    ["Provinsi", place.provinsi],
    ["Kode Pos", place.postalCode],
    ["Plus Code", place.plusCode],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <Dialog open={!!place} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 gap-0 custom-scrollbar">
        {/* header dialog */}
        <div className="relative px-5 pt-5 pb-4 border-b border-border/50 bg-gradient-to-br from-emerald-500/8 via-transparent to-teal-500/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-lg leading-snug flex items-center gap-2 flex-wrap">
                <span className="truncate">{place.name}</span>
                {place.businessStatus === "Tutup Permanen" && (
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 shrink-0">
                    <XCircle className="h-3 w-3" /> Tutup Permanen
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="mt-1.5 flex items-center gap-2 flex-wrap">
                {place.categories.map((c) => (
                  <Badge key={c} variant="secondary" className="h-5 text-[10px] font-normal">{c}</Badge>
                ))}
                {place.categories.length === 0 && <span className="italic">tanpa kategori</span>}
              </DialogDescription>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-sm">
                {place.rating != null && (
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                    <span className="tabular-nums">{place.rating.toFixed(1)}</span>
                    {place.reviewsCount != null && (
                      <span className="text-xs text-muted-foreground font-normal tabular-nums">({place.reviewsCount} ulasan)</span>
                    )}
                  </span>
                )}
                {place.businessStatus && place.businessStatus !== "Tutup Permanen" && (
                  <Badge variant="outline" className="h-5 text-[10px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" /> {place.businessStatus}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* isi — scrollable */}
        <div className="overflow-y-auto max-h-[calc(90vh-11rem)] px-5 py-4 space-y-5 custom-scrollbar">
          {/* kontak */}
          <section aria-label="Kontak">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> Kontak
            </h4>
            {place.phone || place.website ? (
              <div className="space-y-2">
                {place.phone && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold tabular-nums flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        {place.phoneIntl || place.phone}
                      </div>
                      {place.phoneDigits && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">murni: {place.phoneDigits}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CopyChip text={place.phoneDigits || place.phone} label="Salin" />
                      {wa && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <a
                              href={`https://wa.me/${wa}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-7 inline-flex items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-600 px-2.5 text-[11px] font-semibold shadow-sm shadow-emerald-500/25 transition-colors"
                            >
                              <MessageCircle className="h-3 w-3" /> WA
                            </a>
                          </TooltipTrigger>
                          <TooltipContent>Chat via WhatsApp</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                )}
                {!place.phone && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-2">
                    <PhoneOff className="h-4 w-4" /> Tidak ada nomor telepon di Google Maps
                  </div>
                )}
                {place.website && (
                  <a
                    href={place.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 hover:border-emerald-500/30 transition-colors group"
                  >
                    <span className="text-sm truncate flex items-center gap-2 min-w-0">
                      <Globe className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="truncate">{place.website.replace(/^https?:\/\//, "")}</span>
                    </span>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-emerald-600 shrink-0" />
                  </a>
                )}
                {place.email ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                    <a
                      href={`mailto:${place.email.split(";")[0].trim()}`}
                      className="text-sm truncate flex items-center gap-2 min-w-0 text-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="truncate" title={place.email}>{place.email}</span>
                    </a>
                    <CopyChip text={place.email} className="shrink-0" />
                  </div>
                ) : place.website ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-2">
                    <Mail className="h-3.5 w-3.5" /> Email belum dicari — jalankan <b className="text-foreground/80">Cari Email</b> pada job ini
                  </div>
                ) : null}
                {(place.instagram || place.facebook || place.tiktok) ? (
                  <div className="flex items-center gap-2 flex-wrap rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 shrink-0">
                      <Megaphone className="h-3.5 w-3.5" /> Sosmed:
                    </span>
                    {place.instagram && (
                      <a href={place.instagram} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 transition-colors">
                        <Instagram className="h-3 w-3" /> {igHandle(place.instagram) ?? "Instagram"}
                      </a>
                    )}
                    {place.facebook && (
                      <a href={place.facebook} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors">
                        <Facebook className="h-3 w-3" /> Facebook
                      </a>
                    )}
                    {place.tiktok && (
                      <a href={place.tiktok} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-500/20 transition-colors">
                        <Music2 className="h-3 w-3" /> {ttHandle(place.tiktok) ?? "TikTok"}
                      </a>
                    )}
                  </div>
                ) : place.website && (!place.socialStatus || place.socialStatus === "none" || place.socialStatus === "pending") ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-dashed border-border/60 px-3 py-2">
                    <Instagram className="h-3.5 w-3.5" /> Sosmed belum dicari — jalankan <b className="text-foreground/80">Cari Sosmed</b> pada job ini
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">Belum ada data kontak.</div>
            )}
          </section>

          {/* alamat */}
          <section aria-label="Alamat">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> Alamat
            </h4>
            <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5">
              <div className="text-sm leading-relaxed">{place.fullAddress || place.area || "—"}</div>
              {place.mapsUrl && (
                <a
                  href={place.mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  <Navigation className="h-3 w-3" /> Buka lokasi di Google Maps
                </a>
              )}
            </div>
            {info.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-2">
                {info.map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-border/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">{k}</div>
                    <div className="text-xs font-medium truncate" title={v}>{v}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* jam buka */}
          <section aria-label="Jam buka">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Jam Buka
            </h4>
            {place.hours.length > 0 ? (
              <div className="rounded-lg border border-border/50 overflow-hidden">
                {place.hours.map((h, i) => (
                  <div
                    key={h.day}
                    className={`flex items-center justify-between px-3 py-1.5 text-xs ${i !== place.hours.length - 1 ? "border-b border-border/40" : ""} ${i % 2 === 1 ? "bg-muted/30" : ""}`}
                  >
                    <span className="font-medium">{h.day}</span>
                    <span className={`tabular-nums ${/tutup/i.test(h.time) ? "text-rose-500" : ""}`}>{h.time}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">Jam buka tidak tersedia.</div>
            )}
          </section>

          {/* data teknis */}
          {(place.lat != null || place.timezone || place.sourceQuery) && (
            <section aria-label="Data teknis">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5" /> Data Teknis
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {place.lat != null && place.lng != null && (
                  <div className="rounded-lg border border-border/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Koordinat</div>
                    <div className="text-xs font-medium tabular-nums">{place.lat.toFixed(5)}, {place.lng.toFixed(5)}</div>
                  </div>
                )}
                {place.timezone && (
                  <div className="rounded-lg border border-border/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Zona Waktu</div>
                    <div className="text-xs font-medium">{place.timezone}</div>
                  </div>
                )}
                {place.sourceQuery && (
                  <div className="rounded-lg border border-border/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Ditemukan via</div>
                    <div className="text-xs font-medium truncate" title={place.sourceQuery}>"{place.sourceQuery}"</div>
                  </div>
                )}
                {place.placeId && (
                  <div className="rounded-lg border border-border/40 px-2.5 py-1.5">
                    <div className="text-[10px] text-muted-foreground">Place ID</div>
                    <div className="text-[10px] font-mono truncate" title={place.placeId}>{place.placeId}</div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* manajemen prospek */}
          <section aria-label="Manajemen prospek" className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] p-3.5 space-y-3">
            <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide flex items-center gap-1.5">
              <NotebookPen className="h-3.5 w-3.5" /> Status Prospek & Catatan
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
              {LEAD_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => onSaveLead(place.cid, { leadStatus: s })}
                  className={`rounded-lg border px-2 py-2 text-[11px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    lead === s
                      ? `${LEAD_META[s].chip} ring-1 ring-inset scale-[1.02] shadow-sm`
                      : "border-border/50 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground bg-background"
                  }`}
                  aria-pressed={lead === s}
                >
                  <span className={`h-2 w-2 rounded-full ${LEAD_META[s].dot} ${lead === s ? "" : "opacity-50"}`} />
                  {LEAD_META[s].label}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-note" className="text-xs">Catatan (tersimpan di file export)</Label>
              <Textarea
                id="lead-note"
                value={note}
                onChange={(e) => { setNote(e.target.value); setNoteDirty(true); }}
                placeholder="cth: sudah dikirim WA tgl 3, minat tapi minta harga grosir…"
                className="min-h-20 text-sm bg-background resize-y"
                maxLength={500}
              />
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground tabular-nums">{note.length}/500</span>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white"
                  disabled={!noteDirty || saving}
                  onClick={() => onSaveLead(place.cid, { leadNote: note })}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Simpan Catatan
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* footer aksi cepat */}
        <DialogFooter className="px-5 py-3 border-t border-border/50 bg-muted/30 sm:justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {place.phoneDigits && <CopyChip text={place.phoneDigits} label="Salin Telp" />}
            <CopyChip text={place.name} label="Salin Nama" />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={onClose}>
            <X className="h-4 w-4" /> Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- dialog WhatsApp (pairing kode + status) ----------
function WaDialog({ open, onOpenChange, info, phone, setPhone, busy, error, onPair, onUnpair }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  info: { status: string; phone: string | null; pairingCode: string | null; pairingPhone: string | null } | null;
  phone: string;
  setPhone: (v: string) => void;
  busy: boolean;
  error: string;
  onPair: () => void;
  onUnpair: () => void;
}) {
  const connected = info?.status === "connected";
  const code = info?.pairingCode ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WhatsAppIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-400"}`} />
            WhatsApp {connected ? "Terhubung" : "Belum Terhubung"}
          </DialogTitle>
          <DialogDescription>
            Verifikasi berlapis: dengan sesi terhubung, pemeriksaan memakai protokol WhatsApp resmi (paling akurat). Tanpa sesi, lewat halaman WhatsApp web.
          </DialogDescription>
        </DialogHeader>

        {connected ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
              Terhubung sebagai <b>+{info?.phone}</b>
            </div>
            <p className="text-xs text-muted-foreground">
              Saat sesi terhubung, semua nomor diperiksa via protokol WhatsApp resmi — hasilnya sama persis dengan aplikasi di ponsel Anda.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={onUnpair} disabled={busy}>
                {busy ? "Memproses…" : "Putuskan Sesi"}
              </Button>
            </DialogFooter>
          </div>
        ) : code ? (
          <div className="space-y-3">
            <div className="text-center">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Kode pairing untuk +{info?.pairingPhone}</div>
              <div className="font-mono text-3xl font-bold tracking-[0.2em] text-emerald-600 dark:text-emerald-400">{code}</div>
            </div>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Buka WhatsApp di ponsel Anda</li>
              <li>Menu ⋮ → <b>Perangkat Tertaut</b></li>
              <li><b>Tautkan perangkat</b> → <b>Tautkan dengan nomor telepon sebagai gantinya</b></li>
              <li>Masukkan kode di atas</li>
            </ol>
            <p className="text-[11px] text-muted-foreground">
              Gunakan nomor WhatsApp Anda sendiri. Status akan berubah otomatis setelah ditautkan.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="wa-phone">Nomor WhatsApp Anda</Label>
              <Input
                id="wa-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="cth: 081234567890"
                inputMode="tel"
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <DialogFooter>
              <Button onClick={onPair} disabled={busy || phone.trim().length < 9} className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white">
                {busy ? "Meminta kode…" : "Dapatkan Kode Pairing"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- halaman utama ----------
export default function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // tab awal dibaca dari URL (?tab=media / ?tab=penawaran) di sisi server — reload
  // langsung menampilkan tab terakhir tanpa kedipan pindah tab
  const sp = React.use(searchParams);
  const initialTab: "prospek" | "media" | "penawaran" =
    sp.tab === "penawaran" ? "penawaran" : sp.tab === "media" ? "media" : "prospek";
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [mounted, setMounted] = useState(false);

  // form
  const [keyword, setKeyword] = useState("");
  const [city, setCity] = useState("");
  const [deepMode, setDeepMode] = useState(true);
  // filter review minimal — tempat ber-ulasan di bawah nilai ini tidak diambil (default 10)
  const [minReviews, setMinReviews] = useState("1");
  // wajib WhatsApp — tempat tanpa nomor WhatsApp aktif otomatis dibuang.
  // Persist localStorage: keadaan saklar bertahan walau halaman direload —
  // mati tetap mati sampai dinyalakan sendiri, begitu juga sebaliknya.
  // Pembacaan memakai useLayoutEffect DI KLIEN (sebelum paint pertama) supaya
  // tidak ada kedipan menyala-sekejap; di SSR fallback ke useEffect (no-op).
  const [requireWa, setRequireWa] = useState(true);
  // JAMINAN TANPA KEDIPAN: saklar disembunyikan (opacity-0) di HTML SSR dan baru
  // tampil setelah useLayoutEffect membaca preferensi tersimpan — efek itu jalan
  // sebelum paint pasca-hydration, jadi frame pertama yang terlihat mata selalu
  // keadaan yang benar (mati tetap mati), tanpa bergantung pada CSS/skrip awal.
  const [waSwitchReady, setWaSwitchReady] = useState(false);
  const readWaPref = typeof window === "undefined" ? useEffect : useLayoutEffect;
  readWaPref(() => {
    try {
      if (localStorage.getItem("mapminer_require_wa") === "0") setRequireWa(false);
    } catch {}
    // buka gerbang SATU FRAME SETELAH state selesai berpindah (selama tersembunyi,
    // transisi dikunci CSS via data-wa-pending) — saat tampil, thumb sudah diam di
    // posisi final; yang berubah hanya opacity, tidak ada geser kanan→kiri
    const raf = requestAnimationFrame(() => setTimeout(() => setWaSwitchReady(true), 0));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("mapminer_require_wa", requireWa ? "1" : "0");
      // selaraskan atribut <html> yang dipakai CSS prapaint (layout.tsx) — tanpa
      // ini CSS terus memaksa tampilan mati setelah saklar dinyalakan tanpa reload
      document.documentElement.setAttribute("data-require-wa", requireWa ? "1" : "0");
    } catch {}
  }, [requireWa]);
  // sesi WhatsApp (protokol resmi) — status/pairing utk verifikasi berlapis
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [waInfo, setWaInfo] = useState<{ status: string; phone: string | null; pairingCode: string | null; pairingPhone: string | null } | null>(null);
  const [waChecked, setWaChecked] = useState(false); // true setelah pemeriksaan status WA pertama (cegah kedipan peringatan)
  const [waPhone, setWaPhone] = useState("");
  const [waBusy, setWaBusy] = useState(false);
  const [waError, setWaError] = useState("");
  const [starting, setStarting] = useState(false);

  // navigasi tab: Cari Prospek / Unduh Media / Penawaran Massal — dipersist di URL + localStorage.
  // Tab awal dari URL dirender server (HTML pertama sudah benar); localStorage
  // hanya fallback untuk URL tanpa ?tab, ditopang CSS awal via atribut <html>.
  const [tab, setTab] = useState<"prospek" | "media" | "penawaran">(initialTab);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("mapminer_tab");
      if ((saved === "prospek" || saved === "media" || saved === "penawaran") && saved !== initialTab) {
        setTab(saved);
        const u = new URL(window.location.href);
        if (saved === "prospek") u.searchParams.delete("tab");
        else u.searchParams.set("tab", saved);
        window.history.replaceState(null, "", u);
      }
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem("mapminer_tab", tab); } catch {} }, [tab]);
  // ganti tab + selaraskan URL & atribut <html> agar reload menampilkan tab yang sama
  const switchTab = (t: "prospek" | "media" | "penawaran") => {
    setTab(t);
    document.documentElement.setAttribute("data-mm-tab", t);
    try {
      const u = new URL(window.location.href);
      if (t === "prospek") u.searchParams.delete("tab");
      else u.searchParams.set("tab", t);
      window.history.replaceState(null, "", u);
    } catch {}
  };

  // data
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [runningJob, setRunningJob] = useState<JobSummary | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fullJob, setFullJob] = useState<JobFull | null>(null);
  const [serviceUp, setServiceUp] = useState(true);
  const [serviceStats, setServiceStats] = useState<ServiceStats | null>(null);

  // basis data master (gabungan seluruh job selesai)
  const [master, setMaster] = useState<MasterSummary | null>(null);
  const [masterExporting, setMasterExporting] = useState<string | null>(null);
  // ekspor cepat dari riwayat (tanpa harus buka job)
  const [exportingJobId, setExportingJobId] = useState<string | null>(null);
  // periksa ulang WhatsApp sebuah job (id yang sedang diproses)
  const [waRechecking, setWaRechecking] = useState<string | null>(null);
  // konfirmasi hapus permanen job — delete baru dieksekusi setelah user yakin
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  // v9: rentang tanggal job utk filter agregat & export master ("" = tanpa batas)
  const [masterFrom, setMasterFrom] = useState("");
  const [masterTo, setMasterTo] = useState("");
  const masterRangeActive = !!(masterFrom || masterTo);
  // v10: filter kota master — klik bar kota utk fokus satu kota/kabupaten ("" = semua kota)
  const [masterCity, setMasterCity] = useState("");

  // v10: deteksi viewport mobile — placeholder & label adaptif (bukan cuma sembunyikan elemen)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const upd = () => setIsMobile(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  // polling hanya saat tab browser terlihat — tab di latar belakang = benar-benar diam
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const upd = () => setTabVisible(document.visibilityState === "visible");
    upd();
    document.addEventListener("visibilitychange", upd);
    return () => document.removeEventListener("visibilitychange", upd);
  }, []);

  // tabel
  const [filter, setFilter] = useState("");
  const [kecamatan, setKecamatan] = useState("all");
  const [needPhone, setNeedPhone] = useState(false);
  const [needWebsite, setNeedWebsite] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const [needSocial, setNeedSocial] = useState(false);
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [sortKey, setSortKey] = useState<"name" | "rating" | "reviews" | "phone">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [exporting, setExporting] = useState<string | null>(null);

  // v8.1: visibilitas kolom tabel — pengguna bisa menyembunyikan kolom opsional (persist localStorage)
  const [hiddenCols, setHiddenCols] = useState<Set<ColKey>>(() => {
    try {
      const raw = localStorage.getItem("mapminer_hidden_cols");
      return new Set<ColKey>(raw ? (JSON.parse(raw) as ColKey[]) : []);
    } catch { return new Set(); }
  });
  useEffect(() => {
    try { localStorage.setItem("mapminer_hidden_cols", JSON.stringify([...hiddenCols])); } catch {}
  }, [hiddenCols]);
  const toggleCol = (k: ColKey) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  const colOn = (k: ColKey) => !hiddenCols.has(k);

  // v8.1: petunjuk gulir horizontal tabel hanya saat tabel benar-benar meluap (cek reaktif)
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableOverflows, setTableOverflows] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = tableScrollRef.current;
      setTableOverflows(!!el && el.scrollWidth > el.clientWidth + 4);
    };
    check();
    const t = setTimeout(check, 300); // setelah font/data settle
    window.addEventListener("resize", check);
    return () => { clearTimeout(t); window.removeEventListener("resize", check); };
  }, [fullJob, hiddenCols]);

  // v8: seleksi massal — aksi banyak tempat sekaligus (status prospek / salin / ekspor terpilih)
  const [selectedCids, setSelectedCids] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState<string | null>(null); // status yang sedang diterapkan
  const lastClickedRef = useRef<string | null>(null); // cid terakhir di-klik (utk seleksi rentang Shift)

  // bersihkan seleksi saat ganti job
  useEffect(() => { setSelectedCids(new Set()); lastClickedRef.current = null; }, [selectedId]);
  // Esc = bersihkan seleksi
  useEffect(() => {
    if (selectedCids.size === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectedCids(new Set()); lastClickedRef.current = null; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCids.size]);

  // dialog detail tempat
  const [detailPlace, setDetailPlace] = useState<Place | null>(null);
  const [leadSaving, setLeadSaving] = useState(false);

  // mode gabung job
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // penanda wajib isi: field yang kosong saat submit — border merah + getar, tanpa toast
  // shakeSeq: selang-seling keyframes alt tiap klik agar getar diputar ulang walau field masih merah
  const [missingField, setMissingField] = useState<"keyword" | "city" | "both" | null>(null);
  const [shakeSeq, setShakeSeq] = useState(0);
  const missingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagMissing = (which: "keyword" | "city" | "both") => {
    if (missingTimer.current) clearTimeout(missingTimer.current);
    setMissingField(which);
    setShakeSeq((s) => s + 1);
    missingTimer.current = setTimeout(() => setMissingField(null), 2000);
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (historySearch.trim()) {
        const q = historySearch.toLowerCase().trim();
        const matchKw = j.keyword.toLowerCase().includes(q);
        const matchCity = j.city.toLowerCase().includes(q);
        return matchKw || matchCity;
      }
      return true;
    });
  }, [jobs, historySearch]);
  // v7: panel "Cara Kerja" bisa dilipat — terbuka default di desktop, tertutup di mobile
  const [howOpen, setHowOpen] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setHowOpen(true);
  }, []);

  // notifikasi browser saat job selesai — pantau transisi status antar polling
  const jobStatusRef = useRef<Record<string, JobStatus | "gone">>({});

  const isActive = (j: JobSummary | null) => j !== null && (j.status === "running" || j.status === "queued");

  // parse kata kunci batch dari string input (koma/titik-koma)
  const keywordParts = useMemo(
    () => keyword.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    [keyword]
  );

  // job yang bisa digabung (selesai + punya data)
  const mergeableJobs = useMemo(
    () => jobs.filter((j) => j.status === "completed" && j.placesCount > 0),
    [jobs]
  );

  // saran "cerdas" dari Google Suggest (via /api/ai/synonyms) — selalu diambil untuk kata
  // kunci pertama (debounce 700ms, cache per kata kunci). Bila kamus/fallback gagal relevan,
  // saran Google yang benar-benar dicari orang tetap masuk daftar.
  const [aiSyns, setAiSyns] = useState<Record<string, string[]>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const firstPart = keywordParts[0]?.trim().toLowerCase() ?? "";

  useEffect(() => {
    if (!firstPart || firstPart.length < 3) return;
    if (aiSyns[firstPart] || aiLoading === firstPart) return;
    const t = setTimeout(async () => {
      setAiLoading(firstPart);
      try {
        const r = await fetch("/api/ai/synonyms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: firstPart, city: city.trim() || undefined }),
        });
        const d = await r.json();
        if (d.ok && Array.isArray(d.suggestions) && d.suggestions.length > 0) {
          setAiSyns((prev) => ({ ...prev, [firstPart]: d.suggestions as string[] }));
        }
      } catch {
        // layanan saran tidak tersedia — saran kamus/fallback tetap tampil
      } finally {
        setAiLoading((p) => (p === firstPart ? null : p));
      }
    }, 700);
    return () => clearTimeout(t);
  }, [firstPart, city, aiSyns, aiLoading]);

  // daftar saran sinonim — digabung dari SEMUA kata kunci yang diketik (bukan kata pertama saja),
  // tanpa dipotong: dropdown sudah scroll sehingga saran lengkap tetap terlihat.
  // Saran Google/AI (bila ada) digabung lalu diurutkan berdasar relevansi dgn kata kunci:
  // mengandung frasa lengkap = 2, berbagi kata = 1 — agar saran paling pas selalu di atas.
  const synonymList = useMemo(() => {
    const raw = keyword.trim();
    if (!raw) return [];

    const lowerParts = keywordParts.map((p) => p.toLowerCase());
    const firstLow = firstPart;
    const firstWords = firstLow ? firstLow.split(" ").filter((w) => w.length >= 3) : [];
    const scoreOf = (s: string) => {
      const low = s.toLowerCase();
      if (firstLow && low.includes(firstLow)) return 2;
      const words = low.split(" ");
      return firstWords.some((w) => words.includes(w)) ? 1 : 0;
    };

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const part of keywordParts) {
      for (const s of getSynonymsForKeyword(part.trim())) {
        const low = s.toLowerCase();
        if (!lowerParts.includes(low) && !seen.has(low)) {
          seen.add(low);
          merged.push(s);
        }
      }
    }
    // v13.5: saran Google/AI wajib RELEVAN — berbagi ≥1 kata bermakna (≥3 huruf,
    // bukan kata generik) dgn salah satu kata kunci yang diketik. Mencegah saran
    // lintas kategori ("salon" padahal mencari "toko topi") walau lolos dari sumber.
    const GENERIC_MERGE = new Set(["toko", "tempat", "jasa", "servis", "service", "agen", "pusat", "kantor", "terdekat", "near", "the", "dan", "di"]);
    const partWords = keywordParts.flatMap((p) => p.toLowerCase().split(" ").filter((w) => w.length >= 3 && !GENERIC_MERGE.has(w)));
    const relevantToKeyword = (s: string) => {
      if (partWords.length === 0) return true;
      const words = new Set(s.toLowerCase().split(" "));
      return partWords.some((w) => words.has(w));
    };
    const ai = firstPart ? aiSyns[firstPart] ?? [] : [];
    for (const s of ai) {
      const low = s.toLowerCase();
      if (lowerParts.includes(low) || seen.has(low) || !relevantToKeyword(s)) continue;
      seen.add(low);
      merged.push(s);
    }
    return merged
      .map((s, i) => ({ s, i, score: scoreOf(s) }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.s);
  }, [keyword, keywordParts, aiSyns, firstPart]);

  const allSynonymsChecked = useMemo(() => {
    return synonymList.length > 0 && synonymList.every((s) => keywordParts.some((p) => p.toLowerCase() === s.toLowerCase()));
  }, [synonymList, keywordParts]);

  const checkedSynonymCount = useMemo(() => {
    return synonymList.filter((s) => keywordParts.some((p) => p.toLowerCase() === s.toLowerCase())).length;
  }, [synonymList, keywordParts]);

  // chip kata kunci: toggle tambah/hapus (untuk membangun batch) — tanpa batas jumlah
  const toggleKeywordChip = (k: string) => {
    const parts = keyword.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === k.toLowerCase());
    if (idx >= 0) parts.splice(idx, 1);
    else parts.push(k);
    setKeyword(parts.join(", "));
  };

  // ===== WhatsApp (lapis verifikasi protokol resmi) =====
  const loadWaStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/scraper/wa/status", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setWaInfo(d.wa ?? null);
    } catch {}
    finally { setWaChecked(true); }
  }, []);
  useEffect(() => {
    if (!tabVisible) return;
    loadWaStatus();
    const t = setInterval(loadWaStatus, waDialogOpen ? 3000 : 60000);
    return () => clearInterval(t);
  }, [loadWaStatus, waDialogOpen, tabVisible]);

  const waPair = async () => {
    setWaBusy(true); setWaError("");
    try {
      const r = await fetch("/api/scraper/wa/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: waPhone }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      await loadWaStatus();
    } catch (e: any) {
      setWaError(e?.message ?? "Gagal meminta kode pairing");
    } finally { setWaBusy(false); }
  };
  const waUnpair = async () => {
    setWaBusy(true);
    try { await fetch("/api/scraper/wa/unpair", { method: "POST" }); await loadWaStatus(); } finally { setWaBusy(false); }
  };

  // notifikasi: tembak saat job berubah dari running → selesai/gagal (antar polling)
  const notifyJobDone = useCallback((j: JobSummary) => {    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const ok = j.status === "completed";
    const n = new Notification(ok ? "KlienFlow — Scraping selesai ✅" : "KlienFlow — Job gagal ⚠️", {
      body: ok
        ? `"${j.keyword}" di ${j.city}: ${j.placesCount} tempat ditemukan. Klik untuk membuka hasil.`
        : `"${j.keyword}" di ${j.city} gagal${j.error ? ": " + j.error.slice(0, 90) : ""}`,
      tag: j.id,
    });
    n.onclick = () => { window.focus(); setSelectedId(j.id); };
  }, []);

  // muat daftar job + status service
  const loadJobs = useCallback(async (selectRunning = false) => {
    try {
      const r = await fetch("/api/scraper/jobs", { cache: "no-store" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setJobs(d.jobs ?? []);
      setRunningJob(d.running ?? null);
      setQueuedCount(d.queued ?? 0);
      setServiceUp(true);
      // deteksi transisi running → completed/failed utk notifikasi
      const prev = jobStatusRef.current;
      const next: Record<string, JobStatus | "gone"> = {};
      for (const j of d.jobs ?? []) {
        next[j.id] = j.status;
        if (prev[j.id] === "running" && (j.status === "completed" || j.status === "failed")) {
          notifyJobDone(j);
        }
      }
      jobStatusRef.current = next;
      if (selectRunning) {
        // hanya pilih otomatis job yang sedang BERJALAN — jangan pilih job selesai
        // agar tidak ada baris hijau yang muncul sendiri tanpa diklik pengguna
        const target = d.running ?? null;
        if (target) setSelectedId((p) => p ?? target.id);
      }
    } catch {
      setServiceUp(false);
    }
  }, [notifyJobDone]);

  // muat statistik layanan (agregat)
  const loadStats = useCallback(async () => {
    try {
      const r = await fetch("/api/scraper/stats", { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setServiceStats(d.stats ?? null);
    } catch {}
  }, []);

  // muat ringkasan Basis Data Master (gabungan semua job selesai, dedup by cid)
  // v9: from/to (YYYY-MM-DD, opsional) — batasi ke job yang dibuat dalam rentang tanggal
  // v10: city (opsional) — batasi ke tempat di kota/kabupaten terpilih
  const loadMaster = useCallback(async (from?: string, to?: string, city?: string) => {
    try {
      const qs = new URLSearchParams();
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) qs.set("from", from);
      if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) qs.set("to", to);
      if (city) qs.set("city", city);
      const s = qs.toString();
      const r = await fetch(`/api/scraper/master${s ? `?${s}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setMaster(d.master ?? null);
    } catch {}
  }, []);

  // muat job terpilih (full)
  const loadFull = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/scraper/jobs/${id}?full=1`, { cache: "no-store" });
      const d = await r.json();
      if (d.ok) setFullJob(d.job);
    } catch {}
  }, []);

  useEffect(() => { setMounted(true); loadJobs(true); loadStats(); loadMaster(); }, [loadJobs, loadStats, loadMaster]);

  // v7: gulir halus ke monitor saat job dipilih (dari riwayat / job baru dimulai)
  const monitorAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId) monitorAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  // v7: pintasan keyboard "/" → fokus ke filter tabel
  const filterInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t instanceof HTMLInputElement) && !(t instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        filterInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // polling daftar job — hanya saat tab terlihat: 2 dtk saat job berjalan (progress hidup),
  // idle cukup 30 dtk; stats/master disegarkan saat tab kembali terlihat atau job selesai
  useEffect(() => {
    if (!tabVisible) return;
    const interval = isActive(runningJob) ? 2000 : 30000;
    const t = setInterval(() => loadJobs(false), interval);
    return () => clearInterval(t);
  }, [tabVisible, runningJob?.status, runningJob?.id, serviceUp, loadJobs]);

  // tab kembali terlihat → segarkan data langsung (tidak menunggu tick berikutnya)
  useEffect(() => {
    if (!tabVisible) return;
    loadJobs(false);
    if (!isActive(runningJob)) {
      loadStats();
      loadMaster(masterFrom, masterTo, masterCity || undefined);
    }
  }, [tabVisible]);

  // v9: muat ulang master saat rentang tanggal berubah; v10: juga saat filter kota berubah
  useEffect(() => { loadMaster(masterFrom, masterTo, masterCity || undefined); }, [masterFrom, masterTo, masterCity, loadMaster]);

  // polling job terpilih — hanya saat tab terlihat & job masih berjalan
  useEffect(() => {
    if (!selectedId || !tabVisible) return;
    loadFull(selectedId);
    const active = fullJob ? isActive(fullJob) : true;
    const interval = active ? 2000 : 0;
    if (!interval) return;
    const t = setInterval(() => loadFull(selectedId), interval);
    return () => clearInterval(t);
  }, [selectedId, fullJob?.status, loadFull, tabVisible]);

  // pilih otomatis job berjalan
  const lastRunningIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (runningJob && runningJob.id !== lastRunningIdRef.current) {
      lastRunningIdRef.current = runningJob.id;
      const sel = jobs.find((j) => j.id === selectedId);
      if (!selectedId || !sel || (!isActive(sel) && sel.id !== runningJob.id)) {
        setSelectedId(runningJob.id);
      }
    }
  }, [runningJob?.id, jobs, selectedId]);

  // aksi: mulai job
  const startJob = async () => {
    const kw = keyword.trim();
    const ct = city.trim();
    if (!kw || !ct) {
      flagMissing(!kw && !ct ? "both" : !kw ? "keyword" : "city");
      return;
    }
    // minta izin notifikasi (konteks klik pengguna) — utk pemberitahuan saat selesai
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    } catch {}
    setStarting(true);
    try {
      const r = await fetch("/api/scraper/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: kw, city: ct, deepMode, minReviews: Math.max(0, Math.floor(Number(minReviews) || 0)), requireWa }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSelectedId(d.job.id);
      setFullJob(null);
      setFilter(""); setKecamatan("all"); setNeedPhone(false); setNeedWebsite(false); setNeedEmail(false); setLeadFilter("all");
      toast({
        title: isActive(runningJob) ? "Job masuk antrian ⏳" : "Scraping dimulai! 🔎",
        description: isActive(runningJob)
          ? `"${kw}" di ${ct} akan berjalan setelah job saat ini selesai.`
          : `Mencari "${kw}" di ${ct}. Progress akan tampil otomatis — biarkan halaman ini terbuka.`,
      });
      loadJobs(false);
    } catch (e: any) {
      toast({ title: "Gagal memulai", description: e?.message ?? "Coba lagi", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  // aksi: hapus job — PERMANEN (file job di disk ikut dihapus)
  const deleteJob = async (id: string) => {
    try {
      const r = await fetch(`/api/scraper/jobs/${id}`, { method: "DELETE" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      if (selectedId === id) { setSelectedId(null); setFullJob(null); }
      loadJobs(false);
      loadStats();
      loadMaster(masterFrom, masterTo, masterCity || undefined);
      toast({ title: "Job dihapus permanen" });
    } catch (e: any) {
      toast({ title: "Gagal menghapus", description: e?.message ?? "Coba lagi", variant: "destructive" });
      loadJobs(false);
    }
  };

  // aksi: periksa ulang nomor WhatsApp sebuah job selesai — berjalan di latar
  // belakang (respons segera), status tiap nomor diperbarui otomatis di log job.
  // Tempat yang terbukti tidak terdaftar dibuang hanya bila sesi protokol resmi aktif.
  const recheckWaJob = async (id: string) => {
    setWaRechecking(id);
    try {
      const r = await fetch(`/api/scraper/jobs/${id}/wacheck`, { method: "POST" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      toast({ title: "Pemeriksaan WhatsApp berjalan 🔄", description: "Status nomor diperbarui otomatis — pantau log job di bawah." });
      let tries = 0;
      const t = setInterval(async () => {
        tries++;
        try {
          const fd = await fetch(`/api/scraper/jobs/${id}?full=1`, { cache: "no-store" }).then((x) => x.json());
          const logs: { msg: string }[] = fd?.job?.logs ?? [];
          const last = logs.length ? logs[logs.length - 1].msg : "";
          if (last.includes("Periksa ulang WhatsApp (")) {
            clearInterval(t);
            toast({ title: "Periksa ulang selesai ✅", description: last });
            loadJobs(false);
            if (selectedId === id) void loadFull(id);
            setWaRechecking(null);
            return;
          }
        } catch {}
        if (tries >= 90) { clearInterval(t); setWaRechecking(null); loadJobs(false); }
      }, 5000);
    } catch (e: any) {
      toast({ title: "Gagal memulai pemeriksaan", description: e?.message ?? "Coba lagi", variant: "destructive" });
      setWaRechecking(null);
    }
  };

  // aksi: perbarui detail job selesai
  const enrichJob = async (id: string) => {
    try {
      const r = await fetch(`/api/scraper/jobs/${id}/enrich`, { method: "POST" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSelectedId(id);
      toast({ title: "Pembaruan detail dimulai 🔄", description: "Mengambil ulang telepon, website & jam buka untuk semua tempat." });
      loadJobs(false);
    } catch (e: any) {
      toast({ title: "Gagal memperbarui", description: e?.message, variant: "destructive" });
    }
  };

  // aksi: cari email dari website (job selesai)
  const scanEmails = async (id: string) => {
    try {
      const r = await fetch(`/api/scraper/jobs/${id}/emails`, { method: "POST" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSelectedId(id);
      toast({ title: "Pencarian email dimulai 📧", description: "Membuka website setiap tempat untuk mencari email kontak — progress tampil di bawah." });
      loadJobs(false);
    } catch (e: any) {
      toast({ title: "Gagal memulai pencarian email", description: e?.message, variant: "destructive" });
    }
  };

  // aksi: cari link sosmed IG/FB/TikTok dari website (job selesai)
  const scanSocials = async (id: string) => {
    try {
      const r = await fetch(`/api/scraper/jobs/${id}/socials`, { method: "POST" });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSelectedId(id);
      toast({ title: "Pencarian sosmed dimulai 📱", description: "Memindai website setiap tempat untuk link Instagram / Facebook / TikTok — progress tampil di bawah." });
      loadJobs(false);
    } catch (e: any) {
      toast({ title: "Gagal memulai pencarian sosmed", description: e?.message, variant: "destructive" });
    }
  };

  // aksi: unduh export (opsional: hanya tempat terpilih)
  const downloadExport = async (format: "xlsx" | "csv" | "json" | "html", onlySelected = false) => {
    if (!selectedId) return;
    setExporting(format);
    const subset = onlySelected && selectionCount > 0;
    try {
      const cidsParam = subset ? `&cids=${encodeURIComponent([...selectedCids].join(","))}` : "";
      const r = await fetch(`/api/scraper/jobs/${selectedId}/export?format=${format}${cidsParam}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Gagal mengekspor");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      let name = m?.[1] ? decodeURIComponent(m[1]) : `hasil-scraping.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      const n = subset ? selectionCount : (fullJob?.places.length ?? 0);
      toast({
        title: `File ${format === "html" ? "Peta HTML" : format.toUpperCase()} berhasil diunduh 📥`,
        description: format === "html"
          ? `${(blob.size / 1024).toFixed(0)} KB — peta interaktif ${n} tempat. Bisa dibuka offline (Leaflet ter-embed; tile peta butuh internet).`
          : `${(blob.size / 1024).toFixed(1)} KB — berisi ${n} baris data${format === "xlsx" ? " + sheet Ringkasan bergrafik (rating, kategori, pie prospek) + Kontak & Prospek + Sosmed" : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Ekspor gagal", description: e?.message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  // unduh export langsung dari item riwayat (tanpa harus buka job terlebih dahulu)
  const downloadJobExport = async (jobId: string, format: "xlsx" | "csv" | "json" | "html") => {
    setExportingJobId(jobId + "-" + format);
    try {
      const r = await fetch(`/api/scraper/jobs/${jobId}/export?format=${format}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Gagal mengekspor");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const name = m?.[1] ? decodeURIComponent(m[1]) : `hasil-scraping.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: `File ${format.toUpperCase()} berhasil diunduh 📥`,
        description: `${(blob.size / 1024).toFixed(1)} KB${format === "xlsx" ? " + sheet Ringkasan & Kontak Prospek" : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Ekspor gagal", description: e?.message, variant: "destructive" });
    } finally {
      setExportingJobId(null);
    }
  };

  // unduh export Basis Data Master (gabungan semua job selesai)
  // v9: ikutkan rentang tanggal aktif (from/to) bila dipilih pengguna
  // v10: ikutkan filter kota aktif bila dipilih pengguna
  const downloadMasterExport = async (format: "xlsx" | "csv" | "json" | "html") => {
    setMasterExporting(format);
    try {
      const qs = new URLSearchParams({ format });
      if (masterFrom) qs.set("from", masterFrom);
      if (masterTo) qs.set("to", masterTo);
      if (masterCity) qs.set("city", masterCity);
      const r = await fetch(`/api/scraper/master/export?${qs.toString()}`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error ?? "Gagal mengekspor basis data master");
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const name = m?.[1] ? decodeURIComponent(m[1]) : `basis-data-master.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: `Basis Data Master (${format === "html" ? "Peta HTML" : format.toUpperCase()}) terunduh 📥`,
        description: format === "html"
          ? `${(blob.size / 1024).toFixed(0)} KB — peta interaktif ${master?.totalUnique ?? 0} tempat unik${masterCity ? ` di ${masterCity}` : ""}.`
          : `${(blob.size / 1024).toFixed(1)} KB — ${master?.totalUnique ?? 0} tempat unik dari ${master?.sources ?? 0} job${masterCity ? ` di ${masterCity}` : ""}${format === "xlsx" ? " + sheet Kontak & Prospek" : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Ekspor gagal", description: e?.message ?? "Coba lagi", variant: "destructive" });
    } finally {
      setMasterExporting(null);
    }
  };

  // aksi: gabungkan beberapa job menjadi satu (dedup otomatis)
  const mergeJobs = async () => {
    if (mergeSelection.length < 2) {
      toast({ title: "Pilih minimal 2 job", description: "Centang job yang ingin digabung di riwayat.", variant: "destructive" });
      return;
    }
    setMerging(true);
    try {
      const r = await fetch("/api/scraper/jobs/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds: mergeSelection }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      setSelectedId(d.job.id);
      setFullJob(null);
      setMergeMode(false);
      setMergeSelection([]);
      resetFilters();
      loadJobs(false);
      loadStats();
      loadMaster(masterFrom, masterTo, masterCity || undefined);
      toast({
        title: "Job gabungan dibuat 🧩",
        description: `"${d.job.keyword}" — ${d.job.placesCount} tempat unik siap diekspor.`,
      });
    } catch (e: any) {
      toast({ title: "Gagal menggabungkan", description: e?.message ?? "Coba lagi", variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  // simpan status prospek / catatan (optimistik + revert saat gagal)
  const saveLead = async (cid: string, patch: { leadStatus?: LeadStatus; leadNote?: string }) => {
    if (!selectedId || !fullJob) return;
    const orig = fullJob.places.find((p) => p.cid === cid);
    if (!orig) return;
    setFullJob({ ...fullJob, places: fullJob.places.map((p) => (p.cid === cid ? { ...p, ...patch, leadUpdatedAt: Date.now() } : p)) });
    setLeadSaving(true);
    try {
      const r = await fetch(`/api/scraper/jobs/${selectedId}/places/${encodeURIComponent(cid)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      if (patch.leadStatus) {
        toast({ title: `Status → ${LEAD_META[patch.leadStatus].label}`, duration: 1500 });
      }
    } catch (e: any) {
      setFullJob((f) => (f ? { ...f, places: f.places.map((p) => (p.cid === cid ? orig : p)) } : f));
      toast({ title: "Gagal menyimpan", description: e?.message ?? "Coba lagi", variant: "destructive" });
    } finally {
      setLeadSaving(false);
    }
  };

  // data tabel: filter + sort
  const kecamatanOptions = useMemo(() => {
    const s = new Set<string>();
    for (const p of fullJob?.places ?? []) if (p.kecamatan) s.add(p.kecamatan);
    return [...s].sort((a, b) => a.localeCompare(b, "id"));
  }, [fullJob]);

  const tableRows = useMemo(() => {
    let rows = fullJob?.places ?? [];
    const q = filter.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.fullAddress.toLowerCase().includes(q) ||
        p.categories.join(" ").toLowerCase().includes(q) ||
        p.phone.includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (p.leadNote ?? "").toLowerCase().includes(q) ||
        p.kecamatan.toLowerCase().includes(q) ||
        p.desa.toLowerCase().includes(q)
      );
    }
    if (kecamatan !== "all") rows = rows.filter((p) => p.kecamatan === kecamatan);
    if (needPhone) rows = rows.filter((p) => p.phoneDigits);
    if (needWebsite) rows = rows.filter((p) => p.website);
    if (needEmail) rows = rows.filter((p) => p.email);
    if (needSocial) rows = rows.filter((p) => p.instagram || p.facebook || p.tiktok);
    if (leadFilter !== "all") rows = rows.filter((p) => (p.leadStatus ?? "baru") === leadFilter);
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === "rating") return ((b.rating ?? -1) - (a.rating ?? -1)) * (sortDir === "asc" ? 1 : -1);
      if (sortKey === "reviews") return ((b.reviewsCount ?? -1) - (a.reviewsCount ?? -1)) * (sortDir === "asc" ? 1 : -1);
      if (sortKey === "phone") return ((a.phone ? 1 : 0) - (b.phone ? 1 : 0)) * dir || a.name.localeCompare(b.name, "id") * dir;
      return a.name.localeCompare(b.name, "id") * dir;
    });
  }, [fullJob, filter, kecamatan, needPhone, needWebsite, needEmail, needSocial, leadFilter, sortKey, sortDir]);

  const filtersActive = filter.trim() !== "" || kecamatan !== "all" || needPhone || needWebsite || needEmail || needSocial || leadFilter !== "all";

  const resetFilters = () => {
    setFilter(""); setKecamatan("all"); setNeedPhone(false); setNeedWebsite(false); setNeedEmail(false); setNeedSocial(false); setLeadFilter("all");
  };

  const toggleSort = (k: typeof sortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };

  const SortHeader = ({ k, children, className }: { k: typeof sortKey; children: React.ReactNode; className?: string }) => (
    <TableHead className={className}>
      <button
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer"
        aria-label={`Urutkan berdasarkan ${children}`}
      >
        {children}
        {sortKey === k ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />) : null}
      </button>
    </TableHead>
  );

  // ---- v8: logika seleksi massal ----
  const selectionCount = selectedCids.size;
  const filteredSelectedCount = useMemo(
    () => tableRows.reduce((a, p) => a + (selectedCids.has(p.cid) ? 1 : 0), 0),
    [tableRows, selectedCids]
  );
  const allFilteredSelected = tableRows.length > 0 && filteredSelectedCount === tableRows.length;
  const someFilteredSelected = filteredSelectedCount > 0 && !allFilteredSelected;
  const selectedPlaces = useMemo(
    () => (fullJob?.places ?? []).filter((p) => selectedCids.has(p.cid)),
    [fullJob, selectedCids]
  );

  const togglePlaceSelection = (cid: string, shift = false, index = -1) => {
    setSelectedCids((prev) => {
      const next = new Set(prev);
      if (shift && lastClickedRef.current && lastClickedRef.current !== cid) {
        // seleksi rentang: dari cid terakhir diklik sampai yang ini (mengikuti urutan tabel)
        const from = tableRows.findIndex((p) => p.cid === lastClickedRef.current);
        const to = index >= 0 ? index : tableRows.findIndex((p) => p.cid === cid);
        if (from >= 0 && to >= 0) {
          for (let i = Math.min(from, to); i <= Math.max(from, to); i++) next.add(tableRows[i].cid);
          return next;
        }
      }
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
    lastClickedRef.current = cid;
  };

  const toggleSelectAllFiltered = () => {
    setSelectedCids((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const p of tableRows) next.delete(p.cid);
      } else {
        for (const p of tableRows) next.add(p.cid);
      }
      return next;
    });
  };

  const clearSelection = () => { setSelectedCids(new Set()); lastClickedRef.current = null; };

  // aksi massal: ubah status prospek semua tempat terpilih sekaligus
  const applyBulkStatus = async (status: LeadStatus) => {
    if (!selectedId || selectedCids.size === 0) return;
    setBulkSaving(status);
    try {
      const r = await fetch(`/api/scraper/jobs/${selectedId}/places/bulk`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cids: [...selectedCids], leadStatus: status }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error);
      // update lokal (server sudah persist — UI langsung mencerminkan)
      setFullJob((prev) =>
        prev
          ? {
              ...prev,
              places: prev.places.map((p) =>
                selectedCids.has(p.cid) ? { ...p, leadStatus: status, leadUpdatedAt: Date.now() } : p
              ),
            }
          : prev
      );
      toast({
        title: `${d.updated} tempat → ${LEAD_META[status].label} ✅`,
        description: "Status prospek massal tersimpan & ikut ke Basis Data Master.",
      });
    } catch (e: any) {
      toast({ title: "Gagal memperbarui status massal", description: e?.message ?? "Coba lagi", variant: "destructive" });
    } finally {
      setBulkSaving(null);
    }
  };

  // salin kanal kontak — seragam utk semua jenis (telepon / WA / email / sosmed / username IG / username TikTok)
  const copyChannel = async (kind: "phone" | "wa" | "email" | "website" | "instagram" | "facebook" | "tiktok" | "iguser" | "ttuser", only?: "selected") => {
    const src = only === "selected" ? selectedPlaces : (fullJob?.places ?? []);
    let items: string[] = [];
    let title = "";
    let desc = "";
    if (kind === "phone") {
      items = src.map((p) => p.phoneIntl || p.phone).filter(Boolean);
      title = "nomor telepon";
      desc = "Tempel (Ctrl+V) di Excel, WhatsApp, atau aplikasi lain.";
    } else if (kind === "wa") {
      items = src.map((p) => waNumber(p.phoneDigits)).filter(Boolean) as string[];
      title = "nomor WA";
      desc = "Format 62… — siap tempel di tool WhatsApp broadcast atau Excel.";
    } else if (kind === "email") {
      items = src.flatMap((p) => (p.email ?? "").split(";").map((s) => s.trim()).filter(Boolean));
      title = "email";
      desc = "Tempel (Ctrl+V) di aplikasi email atau spreadsheet.";
    } else if (kind === "website") {
      items = [...new Set(src.map((p) => p.website).filter(Boolean))];
      title = "link website";
      desc = "Siap untuk outreach via form kontak website / analisis lebih lanjut.";
    } else if (kind === "iguser") {
      // v9: @username Instagram murni (tanpa URL) — siap DM broadcast / kolab
      items = [...new Set(src.map((p) => igHandle(p.instagram)).filter(Boolean) as string[])];
      title = "username Instagram";
      desc = "Format @username — siap tempel di tool DM Instagram atau spreadsheet.";
    } else if (kind === "ttuser") {
      // v10: @username TikTok murni (tanpa URL) — siap DM broadcast / kolab konten
      items = [...new Set(src.map((p) => ttHandle(p.tiktok)).filter(Boolean) as string[])];
      title = "username TikTok";
      desc = "Format @username — siap tempel di DM TikTok atau spreadsheet.";
    } else {
      items = src.map((p) => (p[kind] ?? "")).filter(Boolean);
      title = kind === "instagram" ? "link Instagram" : kind === "facebook" ? "link Facebook" : "link TikTok";
      desc = "Siap untuk kampanye DM / kolaborasi konten.";
    }
    // email bisa berisi 2 per tempat ("a@b; c@d") → dedup
    if (kind === "email") items = [...new Set(items)];
    if (items.length === 0) {
      toast({ title: `Tidak ada ${title}`, description: only === "selected" ? "Tempat terpilih tidak punya kanal ini." : "Job ini belum punya data tersebut.", variant: "destructive" });
      return;
    }
    const ok = await copyText(items.join("\n"));
    if (ok) {
      toast({ title: `${items.length} ${title} disalin 📋`, description: desc });
    } else {
      toast({ title: "Gagal menyalin", variant: "destructive" });
    }
  };

  const job = fullJob;
  const activeStatus = job ? STATUS_META[job.status] : null;
  // email: website yang bisa dipindai & email yang sudah ditemukan
  const emailScannable = job && job.status === "completed" ? job.places.filter((p) => p.website && !p.email && (p.emailStatus === "none" || p.emailStatus === "pending" || !p.emailStatus)).length : 0;
  const emailFound = job ? job.places.filter((p) => p.email).length : 0;
  // sosmed: website yang bisa dipindai & sosmed yang sudah ditemukan
  const socialScannable = job && job.status === "completed" ? job.places.filter((p) => p.website && (p.socialStatus ?? "none") !== "found" && (!p.socialStatus || p.socialStatus === "none" || p.socialStatus === "pending")).length : 0;
  const socialFound = job ? job.places.filter((p) => p.instagram || p.facebook || p.tiktok).length : 0;
  // hitungan kanal utk menu "Salin" & aksi massal
  const igCount = job ? job.places.filter((p) => p.instagram).length : 0;
  // v9: jumlah @username Instagram unik (siap DM broadcast)
  const igUserCount = job ? new Set(job.places.map((p) => igHandle(p.instagram)).filter(Boolean) as string[]).size : 0;
  // v10: jumlah @username TikTok unik (siap DM broadcast)
  const ttUserCount = job ? new Set(job.places.map((p) => ttHandle(p.tiktok)).filter(Boolean) as string[]).size : 0;
  const fbCount = job ? job.places.filter((p) => p.facebook).length : 0;
  const ttCount = job ? job.places.filter((p) => p.tiktok).length : 0;
  const waCount = job ? job.places.filter((p) => waNumber(p.phoneDigits)).length : 0;
  const phoneCount = job ? job.places.filter((p) => p.phoneDigits).length : 0;
  const websiteCount = job ? job.places.filter((p) => p.website).length : 0;
  // v8.1: jumlah kolom tabel yang tampil (colSpan empty state mengikuti preferensi kolom)
  const visibleColCount =
    3 + (job?.status === "completed" ? 1 : 0) +
    (["alamat", "rating", "telepon", "kecamatan", "prospek", "jam"] as ColKey[]).filter(colOn).length +
    (emailFound > 0 && colOn("email") ? 1 : 0) +
    (socialFound > 0 && colOn("sosmed") ? 1 : 0);

  // v11.2: mode sederhana dihapus — aplikasi selalu terbuka langsung di dashboard lengkap
  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen flex flex-col bg-gradient-to-b from-emerald-50/60 via-background to-background dark:from-emerald-950/20 dark:via-background dark:to-background">
        {/* ---------- HEADER ---------- */}
        <header className="sticky top-0 z-40 border-b border-border dark:border-zinc-600/70 bg-background/80 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <svg viewBox="0 0 120 120" role="img" aria-label="KlienFlow" className="h-11 w-11 shrink-0 drop-shadow-[0_4px_12px_rgba(16,185,129,0.4)]">
                <defs>
                  <linearGradient id="kfTileHeader" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#10D9A0"/>
                    <stop offset="1" stopColor="#05916B"/>
                  </linearGradient>
                </defs>
                <rect width="120" height="120" rx="28" fill="url(#kfTileHeader)"/>
                <g fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M38 30V90"/>
                  <path d="M38 62C56 62 62 36 80 33"/>
                  <path d="M38 62C56 62 62 86 80 89"/>
                </g>
                <circle cx="90" cy="32" r="6.5" fill="#fff"/>
                <circle cx="90" cy="90" r="6.5" fill="#fff"/>
              </svg>
              <div className="min-w-0">
                <div className="text-2xl font-extrabold leading-none tracking-tight">
                  Klien<span className="text-emerald-600 dark:text-emerald-400">Flow</span>
                </div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Intelijen Bisnis Lokal
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {jobs.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="hidden md:inline-flex gap-1.5 px-2.5 border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400 tabular-nums">
                      <Database className="h-3 w-3" />
                      {jobs.reduce((sum, j) => sum + (j.placesCount ?? 0), 0).toLocaleString("id-ID")} tempat · {jobs.length} job
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Total tempat dari semua {jobs.length} job di riwayat</TooltipContent>
                </Tooltip>
              )}
              <Badge variant="outline" className={`gap-1.5 px-2.5 ${serviceUp ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-red-500/30 bg-red-500/10 text-red-600"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${serviceUp ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
                <span className="hidden sm:inline">{serviceUp ? (isActive(runningJob) ? "Sedang scraping" : "Siap") : "Offline"}</span>
              </Badge>

              {/* Verifikasi WhatsApp berlapis — buka dialog status/pairing */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`h-9 w-9 relative ${waInfo?.status === "connected" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
                    onClick={() => { setWaDialogOpen(true); loadWaStatus(); }}
                    aria-label="Verifikasi WhatsApp"
                  >
                    <WhatsAppIcon className="h-5 w-5" />
                    <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${waInfo?.status === "connected" ? "bg-emerald-500" : "bg-zinc-400"}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {waInfo?.status === "connected"
                    ? `WhatsApp terhubung (+${waInfo.phone}) — verifikasi via protokol resmi`
                    : "Hubungkan WhatsApp — verifikasi nomor paling akurat via protokol resmi"}
                </TooltipContent>
              </Tooltip>

              {mounted && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Ganti tema">
                      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Tema {theme === "dark" ? "terang" : "gelap"}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </header>

        {/* ---------- NAVIGASI TAB ---------- */}
        <nav aria-label="Navigasi fitur">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => switchTab("prospek")}
              aria-current={tab === "prospek" ? "page" : undefined}
              className={`h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-medium transition-all cursor-pointer ${
                tab === "prospek"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/60"
              }`}
            >
              <Radar className="h-4 w-4" />
              Cari Prospek
            </button>
            <button
              type="button"
              onClick={() => switchTab("penawaran")}
              aria-current={tab === "penawaran" ? "page" : undefined}
              className={`h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-medium transition-all cursor-pointer ${
                tab === "penawaran"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/60"
              }`}
            >
              <WhatsAppIcon className="h-[18px] w-[18px]" />
              Penawaran Massal
            </button>
            <button
              type="button"
              onClick={() => switchTab("media")}
              aria-current={tab === "media" ? "page" : undefined}
              className={`h-10 px-4 rounded-xl flex items-center gap-2 text-sm font-medium transition-all cursor-pointer ${
                tab === "media"
                  ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/70 border border-border/60"
              }`}
            >
              <Images className="h-4 w-4" />
              Unduh Media
            </button>
          </div>
        </nav>

        {/* ---------- KONTEN ---------- */}
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 pt-0 pb-20 sm:pb-28">
          {/* tampilan tab Cari Prospek — konten lama tetap ter-mount saat pindah tab (state aman) */}
          <div data-mm-pane="prospek" className={tab === "prospek" ? "contents" : "hidden"}>
          {/* hero + form */}
          <section className="mb-6 sm:mb-8" aria-label="Formulir pencarian">
            <Card className="animate-fade-up pt-4 sm:pt-4.5 pb-6 gap-4 sm:gap-4.5">
              <CardContent className="relative space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="keyword" className="text-sm font-medium">Jenis usaha / kata kunci</Label>
                      {keywordParts.length > 1 && (
                        <Badge variant="outline" className="h-5 gap-1 px-1.5 text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 shrink-0">
                          <Layers3 className="h-2.5 w-2.5" /> batch ×{keywordParts.length}
                        </Badge>
                      )}
                    </div>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="keyword"
                        name="keyword_search_no_autofill"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        data-form-type="other"
                        data-lpignore="true"
                        placeholder="cth: barbershop, toko sepatu, distro… (boleh beberapa, pisah koma)"
                        value={keyword}
                        onChange={(e) => {
                          setKeyword(e.target.value);
                          if (e.target.value.trim() && missingField) {
                            setMissingField((cur) => (cur === "both" ? "city" : cur === "keyword" ? null : cur));
                          }
                        }}
                        onKeyDown={(e) => e.key === "Enter" && startJob()}
                        className={`pl-9 h-11 bg-background/80 dark:bg-[#2a2a2a] placeholder:text-zinc-500 dark:placeholder:text-zinc-400 ${
                          missingField === "keyword" || missingField === "both" ? `kf-required ${shakeSeq % 2 === 1 ? "kf-alt" : ""}` : ""
                        }`}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="city" className="text-sm font-medium">Kota / kabupaten / area</Label>
                    <CityCombobox
                      value={city}
                      invalid={missingField === "city" || missingField === "both"}
                      shakeSeq={shakeSeq}
                      onChange={(v) => {
                        setCity(v);
                        if (v.trim() && missingField) {
                          setMissingField((cur) => (cur === "both" ? "keyword" : cur === "city" ? null : cur));
                        }
                      }}
                    />
                  </div>
                </div>


                <Separator className="bg-border/60" />

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Mode Mendalam selalu aktif — toggle UI dihapus */}

                    {/* Filter Review Minimal — tempat ber-ulasan di bawah nilai ini tidak diambil */}
                    <div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-muted/20 dark:bg-[#2a2a2a] px-3.5 h-11 shrink-0">
                      <Star className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      <Label htmlFor="minReviews" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                        Review minimal
                      </Label>
                      <Input
                        id="minReviews"
                        type="number"
                        min={0}
                        max={100000}
                        step={1}
                        value={minReviews}
                        onChange={(e) => setMinReviews(e.target.value === "" ? "0" : Math.max(0, Math.floor(Number(e.target.value))).toString())}
                        className="h-7 w-16 text-center text-sm tabular-nums px-1.5"
                        aria-label="Jumlah ulasan minimal tempat yang diambil"
                      />
                    </div>

                    {/* Wajib WhatsApp — buang tempat tanpa nomor WhatsApp aktif */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/20 dark:bg-[#2a2a2a] px-3.5 h-11 shrink-0">
                          <Switch
                            id="requireWa"
                            checked={requireWa}
                            onCheckedChange={setRequireWa}
                            data-wa-pending={waSwitchReady ? undefined : ""}
                            className={waSwitchReady ? undefined : "opacity-0"}
                          />
                          <Label htmlFor="requireWa" className="text-sm font-medium cursor-pointer whitespace-nowrap">
                            WhatsApp
                          </Label>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        {waInfo?.status === "connected"
                          ? "Pemeriksaan via protokol WhatsApp resmi — hanya nomor tidak terdaftar yang dibuang"
                          : "Nomor dicek via halaman WhatsApp; yang belum pasti tetap disimpan — hubungkan WhatsApp (ikon di header) agar pemilahan memakai protokol resmi"}
                      </TooltipContent>
                    </Tooltip>

                    {/* Tombol Popover Intelijen Bisnis Lokal (Hanya tombol saat belum diklik, buka popover saat diklik) */}
                    {synonymList.length > 0 && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            className={`h-11 rounded-xl px-3.5 gap-2 border font-medium text-xs transition-all cursor-pointer shadow-xs ${
                              checkedSynonymCount > 0
                                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20"
                                : "border-border/70 bg-muted/20 dark:bg-[#2a2a2a] hover:bg-muted/40 text-foreground"
                            }`}
                          >
                            <Sparkles className="h-4 w-4 text-emerald-500" />
                            <span>Sinonim</span>
                            <Badge
                              variant="secondary"
                              className={`h-5 px-1.5 text-[10px] font-mono tabular-nums ${
                                checkedSynonymCount > 0
                                  ? "bg-emerald-500 text-white font-semibold"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {checkedSynonymCount > 0 ? `${checkedSynonymCount}/${synonymList.length}` : synonymList.length}
                            </Badge>
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground opacity-70" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="bottom"
                          sideOffset={6}
                          className="w-72 sm:w-80 p-3 rounded-xl border border-emerald-500/35 bg-popover/95 backdrop-blur-md shadow-xl space-y-2.5 animate-in fade-in-0 zoom-in-95"
                        >
                          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                            <div>
                              <div className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                                <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
                                Intelijen Bisnis Lokal
                                {aiLoading && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                                    <Loader2 className="h-3 w-3 animate-spin" /> saran Google…
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Centang untuk menambahkan ke pencarian
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const missing = synonymList.filter(
                                  (s) => !keywordParts.some((p) => p.toLowerCase() === s.toLowerCase())
                                );
                                if (missing.length > 0) {
                                  setKeyword([...keywordParts, ...missing].join(", "));
                                }
                                setDeepMode(true);
                              }}
                              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-all cursor-pointer inline-flex items-center gap-1 active:scale-95 shrink-0 ${
                                allSynonymsChecked
                                  ? "bg-emerald-700 hover:bg-emerald-800 text-white shadow-xs"
                                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                              }`}
                            >
                              {allSynonymsChecked ? (
                                <><Check className="h-2.5 w-2.5 stroke-[2.5]" /> Semua Terpilih</>
                              ) : (
                                <><Zap className="h-2.5 w-2.5" /> Centang Semua</>
                              )}
                            </button>
                          </div>

                          {/* Daftar checklist memanjang ke bawah dengan scroll jika panjang */}
                          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                            {synonymList.map((s) => {
                              const isChecked = keywordParts.some(
                                (p) => p.toLowerCase() === s.toLowerCase()
                              );
                              return (
                                <label
                                  key={s}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    toggleKeywordChip(s);
                                  }}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-all select-none capitalize ${
                                    isChecked
                                      ? "bg-emerald-500/20 border-emerald-500/60 text-emerald-900 dark:text-emerald-200 shadow-xs"
                                      : "bg-muted/30 border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                                  }`}
                                >
                                  <span
                                    className={`h-4 w-4 rounded flex items-center justify-center border shrink-0 transition-all ${
                                      isChecked
                                        ? "bg-emerald-500 border-emerald-500 text-white"
                                        : "border-muted-foreground/40 bg-background"
                                    }`}
                                  >
                                    {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                  </span>
                                  <span className="truncate">{s}</span>
                                </label>
                              );
                            })}
                          </div>

                          <div className="pt-1.5 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              <b>{checkedSynonymCount}</b> dari {synonymList.length} terpilih
                            </span>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                  <Button
                    size="lg"
                    onClick={startJob}
                    disabled={starting || !serviceUp}
                    className="group relative overflow-hidden h-11 px-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 font-semibold w-full sm:w-auto active:scale-[0.98] transition-transform"
                  >
                    <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent group-hover:translate-x-full transition-transform duration-700" aria-hidden="true" />
                    {starting ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Memulai…</>
                    ) : isActive(runningJob) ? (
                      <><Clock className="h-4 w-4" /> Tambah ke Antrian</>
                    ) : (
                      <><Search className="h-4 w-4" /> Mulai Ambil Data</>
                    )}
                  </Button>
                </div>
                {queuedCount > 0 && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    {queuedCount} job menunggu dalam antrian — job baru akan berjalan otomatis setelahnya.
                  </div>
                )}
              </CardContent>
            </Card>


          </section>



          {/* ---------- RIWAYAT ---------- */}
          <section aria-label="Riwayat pekerjaan" className="animate-fade-up">
            <Card className="border-border/70 shadow-sm overflow-hidden p-0 gap-0">
              <CardHeader className="px-4 sm:px-6 py-3 [.border-b]:pb-3 border-b border-border/40 bg-muted/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2.5 text-lg">
                      <span className="flex h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 items-center justify-center">
                        <History className="h-5.5 w-5.5" />
                      </span>
                      Riwayat Pencarian
                      <Badge variant="secondary" className="tabular-nums font-mono">{jobs.length}</Badge>
                    </CardTitle>
                    {(mergeMode || jobs.length === 0) && (
                      <CardDescription className="mt-1">
                        {mergeMode
                          ? "Centang 2–10 job lalu klik Gabungkan — duplikat dihapus otomatis, status prospek terpelihara."
                          : "Belum ada riwayat — mulai pencarian pertama Anda di atas."}
                      </CardDescription>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {jobs.length > 3 && !mergeMode && (
                      <div className="relative w-56 sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
                        <input
                          value={historySearch}
                          onChange={(e) => setHistorySearch(e.target.value)}
                          placeholder="Cari riwayat (kata kunci / kota)..."
                          className="w-full h-9 pl-9 pr-8 text-sm rounded-lg border border-border/60 bg-background/80 dark:bg-[#2a2a2a] placeholder:text-muted-foreground outline-none focus:border-emerald-500/60 dark:focus:border-emerald-400/60 transition-colors"
                        />
                        {historySearch && (
                          <button
                            type="button"
                            onClick={() => setHistorySearch("")}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                    {mergeableJobs.length >= 2 && (
                    mergeMode ? (
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" className="h-9 cursor-pointer" onClick={() => { setMergeMode(false); setMergeSelection([]); }} disabled={merging}>
                          <X className="h-4 w-4" /> Batal
                        </Button>
                        <Button
                          size="sm"
                          className="h-9 gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white cursor-pointer shadow-xs"
                          onClick={mergeJobs}
                          disabled={mergeSelection.length < 2 || merging}
                        >
                          {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                          Gabungkan {mergeSelection.length > 0 ? `(${mergeSelection.length})` : ""}
                        </Button>
                      </div>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="outline" size="sm" className="h-9 gap-1.5 cursor-pointer hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors" onClick={() => { setMergeMode(true); setMergeSelection([]); }}>
                            <GitMerge className="h-4 w-4" /> Gabungkan Hasil
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Gabungkan hasil beberapa pencarian jadi satu daftar master (dedup otomatis)</TooltipContent>
                      </Tooltip>
                    )
                  )}
                  </div>
                </div>

                {mergeMode && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{mergeSelection.length} dipilih</span>
                    <span className="h-3 w-px bg-border" />
                    <button
                      className="text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                      onClick={() => setMergeSelection(mergeableJobs.map((j) => j.id))}
                    >
                      pilih semua
                    </button>
                    <button
                      className="text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                      onClick={() => setMergeSelection([])}
                    >
                      kosongkan
                    </button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-4 sm:px-6 pt-2 pb-4 sm:pb-6">
                {jobs.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/70 py-10 text-center text-muted-foreground">
                    <MapIcon className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <div className="text-sm font-medium">Riwayat kosong</div>
                    <div className="text-xs text-muted-foreground mt-1">Mulai pencarian bisnis pertama Anda di atas.</div>
                  </div>
                ) : (
                  <>
                    {filteredJobs.length === 0 ? (
                      <div className="py-8 text-center text-sm text-muted-foreground border border-dashed border-border/60 rounded-xl my-2">
                        Tidak ada riwayat yang cocok dengan &quot;{historySearch}&quot;
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[312px] overflow-y-auto overflow-x-hidden custom-scrollbar pr-1.5 scroll-smooth">
                        {/* tinggi pas 4 baris — lebih dari 4 item → scroll, halaman tidak memanjang */}
                        {filteredJobs.map((j) => {
                          const meta = STATUS_META[j.status];
                          const kwCount = j.keywords?.length ?? 1;
                          const sel = selectedId === j.id;
                          const checked = mergeSelection.includes(j.id);
                          const mergeable = mergeMode && j.status === "completed" && j.placesCount > 0;
                          return (
                            <div
                              key={j.id}
                              className={`group rounded-xl border p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all duration-150 cursor-pointer overflow-hidden ${
                                mergeable && checked
                                  ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30 shadow-xs"
                                  : sel
                                  ? "border-emerald-500/60 bg-emerald-500/[0.08] ring-1 ring-emerald-500/25 shadow-xs"
                                  : "border-border/60 bg-muted/40 dark:bg-[#2a2a2a] hover:border-emerald-500/40 hover:bg-muted/60 dark:hover:bg-[#323232]"
                              }`}
                              onClick={() => {
                                if (mergeable) {
                                  setMergeSelection((cur) =>
                                    cur.includes(j.id) ? cur.filter((x) => x !== j.id) : [...cur, j.id]
                                  );
                                } else if (mergeMode) {
                                  toast({ title: "Job ini tidak bisa digabung", description: "Hanya job selesai yang punya data.", variant: "destructive" });
                                } else {
                                  setSelectedId(j.id); setFullJob(null); setDetailPlace(null); resetFilters();
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLElement).click(); }}
                              aria-label={`${mergeable ? "Pilih untuk digabung" : "Buka job"} ${j.keyword} di ${j.city}`}
                              aria-current={!mergeMode && sel ? "true" : undefined}
                              aria-pressed={mergeable ? checked : undefined}
                            >
                              {/* Sisi Kiri: Ikon Status + Informasi Utama */}
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {mergeable ? (
                                  <div className="h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 transition-all bg-card shadow-xs">
                                    <Checkbox
                                      checked={checked}
                                      tabIndex={-1}
                                      className="pointer-events-none data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                                    />
                                  </div>
                                ) : (
                                  <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 transition-colors shadow-xs ${
                                    sel
                                      ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/30"
                                      : j.status === "completed"
                                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : j.status === "running"
                                      ? "bg-amber-500/15 text-amber-500"
                                      : "bg-muted text-muted-foreground"
                                  }`}>
                                    {j.status === "completed" ? (
                                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0">
                                        <path d="M4.5 12.8 L9.9 18.2 L19.5 6.5" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    ) : j.status === "running" ? (
                                      <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                      <MapPin className="h-5 w-5" />
                                    )}
                                  </div>
                                )}

                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                                    <span className="font-semibold text-sm text-foreground truncate max-w-[240px] sm:max-w-[340px]">
                                      &quot;{j.keyword}&quot;
                                    </span>
                                    <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium truncate max-w-[160px]">
                                      di {j.city}
                                    </span>
                                    {j.status !== "completed" && (
                                      <Badge variant="outline" className={`${meta.cls} h-5 text-[10px] font-medium`}>
                                        {meta.label}
                                      </Badge>
                                    )}
                                    <Badge variant="outline" className="h-5 text-[10px] gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                                      <Layers3 className="h-2.5 w-2.5" /> {kwCount} kata kunci
                                    </Badge>
                                  </div>

                                  <div className="text-xs text-muted-foreground flex items-center gap-2 sm:gap-3 flex-wrap">
                                    <span className="flex items-center gap-1">
                                      <CalendarRange className="h-3 w-3 opacity-60" />
                                      {fmtDate(j.createdAt)} {fmtTime(j.createdAt)}
                                    </span>
                                    {j.finishedAt && j.startedAt && j.finishedAt > j.startedAt && (
                                      <span className="hidden sm:flex items-center gap-1">
                                        <Clock className="h-3 w-3 opacity-60" />
                                        {fmtDur((j.finishedAt - j.startedAt) / 1000)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Sisi Kanan: Metrik Data + Tombol Aksi */}
                              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center pl-13 sm:pl-0">
                                {j.placesCount > 0 && (
                                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-xs tabular-nums">
                                    <Database className="h-3.5 w-3.5" />
                                    <span>{j.placesCount.toLocaleString("id-ID")} tempat</span>
                                  </div>
                                )}

                                {/* Tombol Excel cepat — ekspor langsung tanpa buka job */}
                                {j.status === "completed" && j.placesCount > 0 && !mergeMode && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        className="h-8 gap-1.5 px-2.5 text-xs rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-xs shrink-0 cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); downloadJobExport(j.id, "xlsx"); }}
                                        disabled={exportingJobId === j.id + "-xlsx"}
                                        aria-label={`Unduh Excel ${j.keyword}`}
                                      >
                                        {exportingJobId === j.id + "-xlsx"
                                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                          : <FileSpreadsheet className="h-3.5 w-3.5" />}
                                        <span className="hidden sm:inline">Excel</span>
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Unduh Excel (.xlsx) langsung</TooltipContent>
                                  </Tooltip>
                                )}

                                {!mergeMode && (
                                  <div className="flex items-center gap-1 ml-1">
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground/50 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: j.id, label: `"${j.keyword}" di ${j.city}` }); }}
                                          aria-label={`Hapus job ${j.keyword}`}
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Hapus permanen</TooltipContent>
                                    </Tooltip>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </section>
          </div>

          {/* tampilan tab Unduh Media — tetap ter-mount agar progres unduhan tidak hilang saat pindah tab */}
          <div data-mm-pane="media" className={tab === "media" ? "" : "hidden"}>
            <UnduhMedia />
          </div>

          {/* tampilan tab Penawaran Massal — tetap ter-mount agar antrian kirim tidak hilang saat pindah tab */}
          <div data-mm-pane="penawaran" className={tab === "penawaran" ? "" : "hidden"}>
            <PenawaranMassal
              waStatus={waInfo?.status ?? null}
              waChecked={waChecked}
              onOpenWa={() => { setWaDialogOpen(true); loadWaStatus(); }}
            />
          </div>
        </main>

        {/* ---------- v8: BAR AKSI MASSAL (muncul saat ada tempat terpilih) ---------- */}
        {tab === "prospek" && selectionCount > 0 && job && (
          <div className="fixed bottom-0 inset-x-0 z-50 animate-bulk-in" role="toolbar" aria-label="Aksi massal tempat terpilih">
            <div className="mx-auto max-w-5xl px-3 sm:px-6 pb-3 sm:pb-4">
              <div className="rounded-2xl border border-emerald-500/30 bg-background/95 backdrop-blur-xl shadow-2xl shadow-emerald-900/10 px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="flex items-center gap-2 shrink-0">
                  <span className="h-7 w-7 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-md shadow-emerald-500/20">
                    <ListChecks className="h-4 w-4 text-white" />
                  </span>
                  <div className="leading-tight">
                    <div className="text-sm font-bold tabular-nums">{selectionCount} dipilih</div>
                    <div className="text-[10px] text-muted-foreground">
                      {selectedPlaces.filter((p) => p.phoneDigits).length} telp
                      {(() => { const n = selectedPlaces.filter((p) => p.instagram || p.facebook || p.tiktok).length; return n > 0 ? ` · ${n} sosmed` : ""; })()}
                      {(() => { const n = selectedPlaces.filter((p) => p.email).length; return n > 0 ? ` · ${n} email` : ""; })()}
                      {" · " + job.places.length + " total"}
                    </div>
                  </div>
                </div>
                <span className="hidden sm:block h-6 w-px bg-border" />
                <div className="flex items-center gap-1 flex-wrap" role="group" aria-label="Tandai status massal">
                  <span className="text-[11px] text-muted-foreground mr-0.5 hidden sm:inline">Tandai:</span>
                  {LEAD_ORDER.map((s) => (
                    <button
                      key={s}
                      onClick={() => applyBulkStatus(s)}
                      disabled={bulkSaving !== null}
                      className={`rounded-full border px-2.5 h-8 inline-flex items-center gap-1.5 text-[11px] font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-wait ${LEAD_META[s].chip}`}
                    >
                      {bulkSaving === s ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${LEAD_META[s].dot}`} />}
                      {LEAD_META[s].short}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 ml-auto">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => copyChannel("phone", "selected")}>
                        <Phone className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Salin Telp</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Salin nomor telepon {selectedPlaces.filter((p) => p.phoneDigits).length} tempat terpilih</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8 gap-1.5 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10" onClick={() => copyChannel("wa", "selected")}>
                        <MessageCircle className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Salin WA</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Salin nomor WA (62…) {selectedPlaces.filter((p) => waNumber(p.phoneDigits)).length} tempat terpilih — siap broadcast</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => downloadExport("csv", true)} disabled={exporting !== null}>
                        {exporting === "csv" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} CSV
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ekspor hanya {selectionCount} tempat terpilih (CSV)</TooltipContent>
                  </Tooltip>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-md shadow-emerald-500/20"
                    onClick={() => downloadExport("xlsx", true)}
                    disabled={exporting !== null}
                  >
                    {exporting === "xlsx" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Excel Terpilih</span><span className="sm:hidden">XLSX</span>
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={clearSelection} aria-label="Bersihkan pilihan (Esc)">
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Bersihkan pilihan (Esc)</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- FOOTER (sticky bottom) ---------- */}
        <footer className="mt-auto border-t border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              {/* logo tile KlienFlow — sama dgn header (id gradasi unik agar tidak bentrok) */}
              <svg viewBox="0 0 120 120" role="img" aria-label="KlienFlow" className="h-5 w-5 shrink-0">
                <defs>
                  <linearGradient id="kfTileFooter" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#10D9A0"/>
                    <stop offset="1" stopColor="#05916B"/>
                  </linearGradient>
                </defs>
                <rect width="120" height="120" rx="28" fill="url(#kfTileFooter)"/>
                <g fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M38 30V90"/>
                  <path d="M38 62C56 62 62 36 80 33"/>
                  <path d="M38 62C56 62 62 86 80 89"/>
                </g>
                <circle cx="90" cy="32" r="6.5" fill="#fff"/>
                <circle cx="90" cy="90" r="6.5" fill="#fff"/>
              </svg>
              <span>
                <b className="text-foreground">KlienFlow</b> — Intelijen Bisnis Lokal
                <Badge variant="outline" className="ml-2 h-4 px-1.5 text-[9px] tabular-nums border-emerald-500/25 text-emerald-600 dark:text-emerald-400">v10.0</Badge>
                {serviceStats?.version && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">engine {serviceStats.version}</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>Gunakan data secara bertanggung jawab sesuai ketentuan &amp; UU PDP 🇮🇩</span>
            </div>
          </div>
        </footer>

        {/* dialog detail tempat */}
        <PlaceDialog
          place={detailPlace}
          onClose={() => setDetailPlace(null)}
          onSaveLead={(cid, patch) => { void saveLead(cid, patch); }}
          saving={leadSaving}
        />

        {/* dialog verifikasi WhatsApp berlapis */}
        <WaDialog
          open={waDialogOpen}
          onOpenChange={setWaDialogOpen}
          info={waInfo}
          phone={waPhone}
          setPhone={setWaPhone}
          busy={waBusy}
          error={waError}
          onPair={() => { void waPair(); }}
          onUnpair={() => { void waUnpair(); }}
        />

        {/* konfirmasi hapus permanen job */}
        <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Hapus permanen job ini?</AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.label} akan dihapus total — termasuk data tempatnya di Basis Data Master — dan tidak bisa dikembalikan.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="cursor-pointer">Batal</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 text-white hover:bg-red-700 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault(); // jangan tutup dialog sebelum aksi selesai
                  const t = deleteTarget;
                  setDeleteTarget(null);
                  if (t) void deleteJob(t.id);
                }}
              >
                Ya, Hapus Permanen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
