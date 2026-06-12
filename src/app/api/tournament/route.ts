import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ISSUER_API_URL    = process.env.ISSUER_API_URL;
const ISSUER_API_SECRET = process.env.ISSUER_API_SECRET;

export async function GET() {
  if (!ISSUER_API_URL || !ISSUER_API_SECRET) {
    return NextResponse.json({ error: "Torneo no configurado" }, { status: 503 });
  }
  try {
    const r = await fetch(`${ISSUER_API_URL}/tournament`, {
      headers: { Authorization: `Bearer ${ISSUER_API_SECRET}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch {
    return NextResponse.json({ error: "No se pudo obtener el torneo" }, { status: 503 });
  }
}
