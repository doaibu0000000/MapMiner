import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

// Proxy unduhan file export (xlsx/csv) dari mini-service ke browser
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const format = (req.nextUrl.searchParams.get("format") ?? "xlsx").toLowerCase();
  // cids opsional: daftar cid terpilih (pisah koma) — ekspor subset presisi
  const cids = req.nextUrl.searchParams.get("cids");
  const qs = `format=${format}${cids ? `&cids=${encodeURIComponent(cids)}` : ""}`;
  const url = `${SERVICE_URL}/api/jobs/${encodeURIComponent(id)}/export?${qs}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) {
      const text = await resp.text();
      let msg = "Gagal mengekspor data";
      try {
        const j = JSON.parse(text);
        msg = j.error ?? msg;
      } catch {}
      return NextResponse.json({ ok: false, error: msg }, { status: resp.status });
    }
    const buf = await resp.arrayBuffer();
    const filename = resp.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    const headers: Record<string, string> = {
      "Content-Type": resp.headers.get("content-type") ?? "application/octet-stream",
    };
    if (filename) {
      headers["Content-Disposition"] = `attachment; filename*=UTF-8''${filename}`;
    }
    return new NextResponse(buf, { headers });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Gagal mengekspor: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}
