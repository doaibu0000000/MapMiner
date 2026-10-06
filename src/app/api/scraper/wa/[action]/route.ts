import { NextRequest, NextResponse } from "next/server";

// Proxy WhatsApp (status / pair / unpair) → engine :3003
// Aksi kirim pesan (send) langsung → wa-checker :3004 (sesi Baileys terpisah)

const SERVICE_URL = "http://localhost:3003";
const WA_CHECKER_URL = "http://localhost:3004";

async function forward(path: string, init?: RequestInit) {
  try {
    const resp = await fetch(`${SERVICE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(40000),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: `Layanan scraper tidak merespons: ${msg}` }, { status: 502 });
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "status") return NextResponse.json({ ok: false, error: "Aksi tidak dikenal" }, { status: 404 });
  return forward(`/api/wa/${action}`);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (action !== "pair" && action !== "unpair" && action !== "send") {
    return NextResponse.json({ ok: false, error: "Aksi tidak dikenal" }, { status: 404 });
  }
  const body = await req.text().catch(() => "{}");
  // kirim pesan dieksekusi langsung oleh sesi Baileys di wa-checker (satu pesan per panggilan;
  // jeda antar pesan diatur sisi UI agar bisa dijeda/dihentikan kapan pun)
  if (action === "send") {
    try {
      const resp = await fetch(`${WA_CHECKER_URL}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(60000),
      });
      const text = await resp.text();
      return new NextResponse(text, {
        status: resp.status,
        headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: `Layanan WhatsApp tidak merespons: ${msg}` }, { status: 502 });
    }
  }
  return forward(`/api/wa/${action}`, { method: "POST", body });
}
