import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

// Proxy unduhan export Basis Data Master (xlsx/csv/json/html) dari mini-service.
// from/to (YYYY-MM-DD, opsional): batasi export ke job yang dibuat dalam rentang tanggal.
// city (opsional, v10): batasi export ke kota/kabupaten terpilih.
export async function GET(req: NextRequest) {
  const format = (req.nextUrl.searchParams.get("format") ?? "xlsx").toLowerCase();
  const qs = new URLSearchParams({ format });
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const city = req.nextUrl.searchParams.get("city");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) qs.set("from", from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) qs.set("to", to);
  if (city && city.length <= 80) qs.set("city", city);
  const url = `${SERVICE_URL}/api/master/export?${qs.toString()}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) {
      const text = await resp.text();
      let msg = "Gagal mengekspor basis data master";
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
