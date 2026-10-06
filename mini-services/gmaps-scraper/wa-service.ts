// Klien layanan verifikasi WhatsApp (wa-checker service, port 3004).
// Baileys berjalan di PROSES TERPISAH — engine tidak pernah memuatnya
// (implikasi kestabilan: crash di layanan tidak menjatuhkan engine/aplikasi).

const SVC = "http://localhost:3004";

async function getJson(url: string, init?: RequestInit, timeoutMs = 15000): Promise<any | null> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
}

export interface WaServiceStatus {
  status: string;
  phone: string | null;
  pairingCode: string | null;
  pairingPhone: string | null;
  mode: string;
}

export async function waServiceStatus(): Promise<WaServiceStatus | null> {
  const d = await getJson(`${SVC}/health`, undefined, 8000);
  if (!d?.ok) return null;
  return { status: d.status, phone: d.phone ?? null, pairingCode: d.pairingCode ?? null, pairingPhone: d.pairingPhone ?? null, mode: d.mode ?? "web-render" };
}

export async function waServiceConnected(): Promise<boolean> {
  const s = await waServiceStatus();
  return s?.status === "connected";
}

export async function waServicePair(phone: string): Promise<string> {
  const d = await getJson(`${SVC}/pair`, { method: "POST", body: JSON.stringify({ phone }) }, 30000);
  if (!d?.ok) throw new Error(d?.error ?? "Layanan WhatsApp tidak merespons");
  return d.code as string;
}

export async function waServiceUnpair(): Promise<void> {
  await getJson(`${SVC}/unpair`, { method: "POST" }, 20000);
}

/** Pemeriksaan nomor via protokol resmi (butuh sesi terhubung).
 *  Return Map digit→true/false, atau null bila layanan/sesi tidak tersedia. */
export async function waServiceCheck(numbers: string[]): Promise<Map<string, boolean | null> | null> {
  const d = await getJson(`${SVC}/check`, { method: "POST", body: JSON.stringify({ numbers }) }, 120000);
  if (!d?.ok || !d?.available) return null;
  const results = d.results as Record<string, boolean | null>;
  const map = new Map<string, boolean | null>();
  for (const raw of numbers) {
    const n = raw.replace(/\D/g, "");
    // layanan mengembalikan dgn digit 62…; cocokkan dgn normalisasi sederhana
    const alt = n.startsWith("62") ? n : "62" + n.replace(/^0/, "");
    const v = results[n] ?? results[alt] ?? null;
    map.set(raw, v);
  }
  return map;
}
