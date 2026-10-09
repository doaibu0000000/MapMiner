import { NextRequest, NextResponse } from "next/server";
import { ensureScraperService } from "@/lib/scraper-keeper";

const SERVICE_URL = "http://localhost:3003";

/** Unduh arsip ZIP hasil tab Unduh Media — arus biner diteruskan apa adanya. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const path = `/api/media/${encodeURIComponent(id)}/zip`;
  const doFetch = () =>
    fetch(`${SERVICE_URL}${path}`, { signal: AbortSignal.timeout(120000) });
  try {
    let resp = await doFetch();
    if (!resp.ok && resp.status >= 500) {
      // self-heal lalu coba sekali lagi bila layanan sempat mati
      if (await ensureScraperService(8000)) resp = await doFetch();
    }
    if (!resp.ok) {
      const text = await resp.text();
      return new NextResponse(text, {
        status: resp.status,
        headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
      });
    }
    return new NextResponse(resp.body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": resp.headers.get("content-disposition") ?? 'attachment; filename="unduh-media.zip"',
        "Content-Length": resp.headers.get("content-length") ?? "",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal mengambil arsip: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}
