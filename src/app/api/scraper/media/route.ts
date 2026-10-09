import { NextRequest, NextResponse } from "next/server";
import { ensureScraperService } from "@/lib/scraper-keeper";

const SERVICE_URL = "http://localhost:3003";

/** Proksi tab Unduh Media: daftar job media (GET) / buat job baru (POST). */
async function proxy(path: string, init?: RequestInit) {
  try {
    const resp = await fetch(`${SERVICE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30000),
    });
    const text = await resp.text();
    return new NextResponse(text, {
      status: resp.status,
      headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
    });
  } catch (e: any) {
    // self-heal: layanan scraper mati → nyalakan otomatis lalu ulangi sekali
    try {
      if (await ensureScraperService(8000)) {
        const resp = await fetch(`${SERVICE_URL}${path}`, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers ?? {}),
          },
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

export async function GET() {
  return proxy("/api/media");
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxy("/api/media", { method: "POST", body });
}
