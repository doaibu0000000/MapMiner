import { NextRequest, NextResponse } from "next/server";

// Saran sinonim "cerdas" — dipakai UI untuk kata kunci apapun.
// Prioritas: (1) Google Suggest via layanan scraper :3003 — kata yang benar-benar dicari orang,
// cepat & tanpa kredensial; (2) LLM (z-ai-web-dev-sdk) bila Google gagal & konfigurasi tersedia.
// Semua gagal → ok:false, UI lanjut memakai saran kamus/fallback (aman).

export const runtime = "nodejs";
export const maxDuration = 30;

const SERVICE_URL = "http://localhost:3003";
const MAX_SUGGESTIONS = 12;
const LLM_TIMEOUT_MS = 15000;

function sanitize(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 60);
    if (s.length < 3) continue;
    if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Model kadang membungkus JSON dengan ```json … ``` atau menambah teks — ambil array pertama */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function fromGoogleSuggest(keyword: string, city: string): Promise<string[]> {
  const qs = new URLSearchParams({ q: keyword });
  if (city) qs.set("city", city);
  const resp = await fetch(`${SERVICE_URL}/api/suggest?${qs}`, {
    signal: AbortSignal.timeout(8000),
  });
  const data = await resp.json();
  if (!data?.ok) return [];
  return sanitize(data.suggestions);
}

async function fromLlm(keyword: string, city: string): Promise<string[]> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();

  const userPrompt =
    `Kamu ahli bisnis lokal Indonesia yang paham penamaan tempat usaha di Google Maps.` +
    (city ? ` Wilayah pencarian: ${city}.` : "") +
    `\nBerikan ${MAX_SUGGESTIONS} variasi kata kunci pencarian Google Maps yang paling sering ` +
    `dipakai sebagai nama/istilah tempat untuk kategori berikut: "${keyword}".\n` +
    `Aturan: istilah nyata dipakai di Indonesia (boleh singkatan populer seperti SMPN/SMPIT/ATM, ` +
    `pola "negeri/swasta/islam" bila relevan, tanpa nama kota, tanpa nomor urut, tanpa penjelasan).\n` +
    `Balas HANYA JSON array of strings, tanpa teks lain.`;

  const completion = (await Promise.race([
    zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "Kamu generator kata kunci pencarian Google Maps Indonesia. Balas hanya JSON array of strings." },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout AI")), LLM_TIMEOUT_MS)
    ),
  ])) as { choices?: { message?: { content?: string } }[] };

  const content = completion?.choices?.[0]?.message?.content ?? "";
  return sanitize(extractJsonArray(content));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const keyword = String(body?.keyword ?? "").trim().slice(0, 80);
    const city = String(body?.city ?? "").trim().slice(0, 80);
    if (!keyword) {
      return NextResponse.json({ ok: false, error: "keyword kosong" }, { status: 400 });
    }

    let source = "google-suggest";
    let suggestions: string[] = [];
    try {
      suggestions = await fromGoogleSuggest(keyword, city);
    } catch { /* layanan scraper mati / jaringan — lanjut ke LLM */ }

    if (suggestions.length === 0) {
      try {
        source = "ai";
        suggestions = await fromLlm(keyword, city);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ ok: false, error: `saran tidak tersedia: ${msg}` });
      }
    }

    if (suggestions.length === 0) {
      return NextResponse.json({ ok: false, error: "tidak ada saran" });
    }
    return NextResponse.json({ ok: true, suggestions, source });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `saran tidak tersedia: ${msg}` });
  }
}
