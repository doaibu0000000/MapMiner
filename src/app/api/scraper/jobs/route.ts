import { NextRequest, NextResponse } from "next/server";
import { ensureScraperService } from "@/lib/scraper-keeper";

const SERVICE_URL = "http://localhost:3003";

/** Gagal koneksi (layanan mati) ≠ timeout endpoint lambat. Retry hanya boleh
 *  dilakukan pada koneksi gagal — POST yang timeout justru tidak boleh diulang
 *  agar tidak membuat job duplikat. */
function isConnFailure(e: any): boolean {
  return !(e?.name === "TimeoutError" || e?.name === "AbortError");
}

async function attempt(path: string, init?: RequestInit) {
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

async function proxy(req: NextRequest, path: string, init?: RequestInit) {
  try {
    return await attempt(path, init);
  } catch (e: any) {
    // self-heal: layanan scraper mati → nyalakan otomatis lalu ulangi sekali
    if (isConnFailure(e) && (await ensureScraperService(8000))) {
      try {
        return await attempt(path, init);
      } catch {}
    }
    return NextResponse.json(
      { ok: false, error: `Layanan scraper tidak merespons: ${e?.message ?? e}` },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  return proxy(req, "/api/jobs");
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  return proxy(req, "/api/jobs", { method: "POST", body });
}
