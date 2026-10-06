import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

// Ambil job by id (?full=1 untuk data places lengkap) atau hapus job
async function handle(req: NextRequest, id: string) {
  const url = `${SERVICE_URL}/api/jobs/${encodeURIComponent(id)}${req.nextUrl.search}`;
  try {
    const method = req.method === "DELETE" ? "DELETE" : "GET";
    const resp = await fetch(url, {
      method,
      headers: method === "GET" ? { Accept: "application/json" } : { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Layanan scraper tidak merespons: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(req, id);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handle(req, id);
}
