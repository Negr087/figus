import { NextRequest, NextResponse } from "next/server";
import { verifyEvent } from "nostr-tools/pure";
import { nwcPayServer, fetchNostrEvents } from "@/lib/nwc-server";
import { checkClaimedRemote, tryReserveRemote, confirmClaimRemote, releaseClaimRemote } from "@/lib/claim-remote";

const ISSUER_API_URL    = process.env.ISSUER_API_URL;
const ISSUER_API_SECRET = process.env.ISSUER_API_SECRET;

const claimKey = (tournamentId: string) => `tournament:${tournamentId}`;

interface TournamentSummary {
  id: string;
  status: string;
  champion: string | null;
  prizePool: number;
}

// Busca el torneo por id específico (no solo el actual) — un torneo finalizado
// se archiva en el issuer cuando el siguiente arranca, así el campeón puede
// reclamar su premio aunque ya haya un torneo nuevo en curso.
async function fetchTournament(tournamentId: string): Promise<TournamentSummary | null> {
  if (!ISSUER_API_URL || !ISSUER_API_SECRET) return null;
  try {
    const r = await fetch(`${ISSUER_API_URL}/tournament/${encodeURIComponent(tournamentId)}`, {
      headers: { Authorization: `Bearer ${ISSUER_API_SECRET}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return await r.json() as TournamentSummary;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const tournamentId = req.nextUrl.searchParams.get("tournamentId");
  const pubkey = req.nextUrl.searchParams.get("pubkey");
  if (!tournamentId || !pubkey) return err("Faltan parámetros", 400);
  const claimed = await checkClaimedRemote(pubkey, claimKey(tournamentId));
  return NextResponse.json({ claimed });
}

export async function POST(req: NextRequest) {
  try {
    return await handleClaim(req);
  } catch (e: any) {
    console.error("[claim-tournament] unhandled error:", e);
    return err(`Error interno: ${e?.message ?? "desconocido"}`, 500);
  }
}

async function handleClaim(req: NextRequest) {
  let body: { event?: unknown; tournamentId?: unknown };
  try { body = await req.json(); }
  catch { return err("Cuerpo de solicitud inválido", 400); }

  const { event: signedEvent, tournamentId } = body;
  if (!signedEvent || typeof tournamentId !== "string") return err("Faltan datos", 400);

  // ── Verify Nostr signature ──────────────────────────────────────────────────
  try {
    if (!verifyEvent(signedEvent as Parameters<typeof verifyEvent>[0])) throw 0;
  } catch {
    return err("Firma inválida", 400);
  }

  const ev = signedEvent as { pubkey: string; created_at: number; tags: string[][] };

  const ageSecs = Math.abs(Math.floor(Date.now() / 1000) - ev.created_at);
  if (ageSecs > 600) return err("Evento expirado — intentá de nuevo", 400);

  const evTournamentId = ev.tags.find((t) => t[0] === "tournament")?.[1];
  if (evTournamentId !== tournamentId) return err("Evento no coincide con el torneo", 400);

  const pubkey = ev.pubkey;

  // ── Verify this pubkey is actually the champion of a finished tournament ────
  const t = await fetchTournament(tournamentId);
  if (!t) return err("No se encontró ese torneo", 404);
  if (t.status !== "finished") return err("El torneo todavía no terminó", 409);
  if (t.champion !== pubkey) return err("Solo el campeón puede reclamar este premio", 403);
  if (t.prizePool <= 0) return err("El pozo del torneo está vacío", 422);

  const key = claimKey(tournamentId);

  // ── Anti-double-claim ───────────────────────────────────────────────────────
  if (await checkClaimedRemote(pubkey, key)) {
    return err("Ya reclamaste este premio anteriormente", 409);
  }

  const mock = (process.env.REWARD_PAYMENTS || "").toLowerCase() === "mock";
  const nwcStr = process.env.REWARD_NWC;
  if (!mock && !nwcStr) return err("Premios no configurados en el servidor", 503);

  const lud16 = await fetchUserLud16(pubkey);
  if (!lud16) {
    return err(
      "No encontramos una dirección Lightning en tu perfil Nostr. " +
      "Agregá tu lud16 en tu perfil (ej: usuario@wallet.com) y volvé a intentar.",
      422
    );
  }

  const reserved = await tryReserveRemote(pubkey, key, t.prizePool);
  if (reserved === "error") return err("No se pudo registrar el reclamo, intentá de nuevo", 503);
  if (!reserved) return err("Ya reclamaste este premio anteriormente", 409);

  if (mock) {
    await confirmClaimRemote(pubkey, key);
    return NextResponse.json({
      ok: true,
      message: `🧪 [mock] Premio de torneo de ${t.prizePool} sats registrado para ${lud16} (sin pago real)`,
    });
  }

  let invoice: string;
  try {
    invoice = await getInvoice(lud16, t.prizePool);
  } catch (e: any) {
    await releaseClaimRemote(pubkey, key);
    return err(`No se pudo generar la factura Lightning: ${e.message}`, 502);
  }

  try {
    await nwcPayServer(invoice, nwcStr!);
  } catch (e: any) {
    await releaseClaimRemote(pubkey, key);
    return err(`Error al enviar el pago: ${e.message}`, 502);
  }

  await confirmClaimRemote(pubkey, key);

  return NextResponse.json({
    ok: true,
    message: `¡Premio de torneo pagado! ⚡ ${t.prizePool} sats enviados a ${lud16}`,
  });
}

function err(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function fetchUserLud16(pubkey: string): Promise<string | null> {
  const relays = (process.env.NEXT_PUBLIC_RELAYS ?? "wss://relay.lacrypta.ar,wss://relay.damus.io,wss://nos.lol")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  for (const relay of relays) {
    try {
      const events = await fetchNostrEvents(
        relay,
        { kinds: [0], authors: [pubkey], limit: 1 },
        6_000
      );
      if (!events.length) continue;
      const ev = events[0] as { content: string };
      const profile = JSON.parse(ev.content) as Record<string, string>;
      if (profile.lud16) return profile.lud16;
    } catch {}
  }
  return null;
}

async function getInvoice(lnAddress: string, amountSats: number): Promise<string> {
  const [user, domain] = lnAddress.split("@");
  if (!user || !domain) throw new Error("Dirección Lightning inválida");

  const lnurlRes = await fetch(`https://${domain}/.well-known/lnurlp/${user}`);
  if (!lnurlRes.ok) throw new Error(`LNURL error ${lnurlRes.status}`);
  const lnurlData = (await lnurlRes.json()) as {
    callback: string;
    minSendable: number;
    maxSendable: number;
  };
  if (!lnurlData.callback) throw new Error("LNURL sin callback");

  const amountMs = amountSats * 1000;
  if (amountMs < lnurlData.minSendable || amountMs > lnurlData.maxSendable) {
    throw new Error(
      `Monto ${amountSats} sats fuera del rango permitido ` +
      `(${lnurlData.minSendable / 1000}–${lnurlData.maxSendable / 1000} sats)`
    );
  }

  const cbUrl = new URL(lnurlData.callback);
  cbUrl.searchParams.set("amount", String(amountMs));
  const invRes = await fetch(cbUrl.toString());
  if (!invRes.ok) throw new Error(`Callback error ${invRes.status}`);
  const invData = (await invRes.json()) as { pr?: string; reason?: string };
  if (!invData.pr) throw new Error(invData.reason || "No se recibió la factura");

  return invData.pr;
}
