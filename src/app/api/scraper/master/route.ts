import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

// Proxy ringkasan Basis Data Master (gabungan seluruh job selesai) dari mini-service.
// from/to (YYYY-MM-DD, opsional): batasi agregat ke job yang dibuat dalam rentang tanggal.
// city (opsional, v10): batasi ke tempat di kota/kabupaten terpilih.
export async function GET(req: NextRequest) {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const city = req.nextUrl.searchParams.get("city");
  const qs = new URLSearchParams();
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) qs.set("from", from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) qs.set("to", to);
  if (city && city.length <= 80) qs.set("city", city);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    const resp = await fetch(`${SERVICE_URL}/api/master${suffix}`, {
      cache: "no-store",
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
