import { NextRequest, NextResponse } from "next/server";
import { ensureScraperService } from "@/lib/scraper-keeper";

const SERVICE_URL = "http://localhost:3003";

/** Proksi detail job media: status (GET) / hapus + bersihkan berkas (DELETE). */
async function proxy(id: string, method: "GET" | "DELETE") {
  const path = `/api/media/${encodeURIComponent(id)}`;
  try {
    const resp = await fetch(`${SERVICE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: any) {
    try {
      if (await ensureScraperService(8000)) {
        const resp = await fetch(`${SERVICE_URL}${path}`, {
          method,
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30000),
        });
        const text = await resp.text();
        return new NextResponse(text, {
          status: resp.status,
          headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
        });
      }
    } catch {}
    return NextResponse.json(
      { ok: false, error: `Layanan scraper tidak merespons: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxy(id, "GET");
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxy(id, "DELETE");
}
