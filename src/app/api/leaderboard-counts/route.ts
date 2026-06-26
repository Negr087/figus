import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ISSUER_API_URL    = process.env.ISSUER_API_URL;
const ISSUER_API_SECRET = process.env.ISSUER_API_SECRET;

const MAX_PUBKEYS    = 200;
const CONCURRENCY    = 10;
const FETCH_TIMEOUT  = 8000;

// Conteo de figuritas por jugador, consultado contra el issuer (data/ownership.json,
// fuente de verdad sin las limitaciones de paginación de los relays públicos —
// un usuario con muchas figuritas distintas tiene un evento 30100 addressable
// por cada una, y reconstruirlo desde relays podía quedar truncado según cómo
// cada relay maneje `until` + filtros por tag).
export async function POST(req: NextRequest) {
  if (!ISSUER_API_URL || !ISSUER_API_SECRET) {
    return NextResponse.json({ error: "Issuer API no configurada" }, { status: 503 });
  }

  let pubkeys: string[];
  try {
    const body = await req.json();
    pubkeys = Array.isArray(body?.pubkeys) ? body.pubkeys : [];
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  pubkeys = pubkeys.filter((p) => /^[0-9a-f]{64}$/.test(p)).slice(0, MAX_PUBKEYS);
  if (pubkeys.length === 0) return NextResponse.json({ counts: {} });

  const counts: Record<string, number> = {};
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= pubkeys.length) return;
      const pk = pubkeys[i];
      try {
        const res = await fetch(`${ISSUER_API_URL}/ownership/${pk}`, {
          headers: { Authorization: `Bearer ${ISSUER_API_SECRET}` },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });
        if (res.ok) {
          const data = (await res.json()) as Record<string, number>;
          counts[pk] = Object.values(data).filter((c) => c > 0).length;
        }
      } catch { /* este pubkey queda afuera del resultado — el cliente decide el fallback */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pubkeys.length) }, worker));

  return NextResponse.json({ counts });
}
