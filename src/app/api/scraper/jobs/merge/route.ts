import { NextRequest, NextResponse } from "next/server";

const SERVICE_URL = "http://localhost:3003";

// Proxy penggabungan beberapa job menjadi satu (dedup by cid)
export async function POST(req: NextRequest) {
  let body: string;
  try {
    body = JSON.stringify(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Body JSON tidak valid" }, { status: 400 });
  }
  try {
    const resp = await fetch(`${SERVICE_URL}/api/jobs/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30000),
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
