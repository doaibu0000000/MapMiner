import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

export async function GET(req: NextRequest) {
  try {
    const resp = await fetch(`${SERVICE_URL}/api/stats`, {
      signal: AbortSignal.timeout(10000),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: `Layanan scraper tidak merespons: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}
