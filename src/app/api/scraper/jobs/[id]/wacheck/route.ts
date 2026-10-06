import { NextRequest, NextResponse } from "next/server";

// Proxy "periksa ulang WhatsApp" job selesai → engine :3003
// (status diperbarui via lapis protokol resmi bila sesi terhubung, atau lapis web)

const SERVICE_URL = "http://localhost:3003";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const resp = await fetch(`${SERVICE_URL}/api/jobs/${encodeURIComponent(id)}/wacheck`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(600000),
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
