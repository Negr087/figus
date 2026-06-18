// Server-only: claim ledger que prefiere el issuer VPS (disco durable) sobre el
// fallback local (/tmp en Vercel se borra en cada redeploy). Usado tanto por el
// claim de premios de página/álbum como por el de premio de torneo — misma
// mecánica de reserva atómica, distinta claimKey.
import { hasClaimed, reserveClaim, confirmClaim, releaseClaim } from "./claim-ledger";

const ISSUER_API_URL    = process.env.ISSUER_API_URL;
const ISSUER_API_SECRET = process.env.ISSUER_API_SECRET;
const TIMEOUT_MS = 8000;

export async function checkClaimedRemote(pubkey: string, claimKey: string): Promise<boolean> {
  if (ISSUER_API_URL && ISSUER_API_SECRET) {
    try {
      const r = await fetch(`${ISSUER_API_URL}/claims/${pubkey}/${encodeURIComponent(claimKey)}`, {
        headers: { Authorization: `Bearer ${ISSUER_API_SECRET}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.ok) return (await r.json() as { claimed: boolean }).claimed;
    } catch { /* API no disponible — caer al local */ }
  }
  return hasClaimed(pubkey, claimKey);
}

/** Devuelve true si reservó, false si ya estaba reclamado, "error" si la API falló. */
export async function tryReserveRemote(pubkey: string, claimKey: string, amountSats: number): Promise<true | false | "error"> {
  if (ISSUER_API_URL && ISSUER_API_SECRET) {
    try {
      const r = await fetch(`${ISSUER_API_URL}/claims/${pubkey}/${encodeURIComponent(claimKey)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ISSUER_API_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amountSats }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (r.status === 409) return false;
      if (r.ok) return true;
      return "error";
    } catch { return "error"; }
  }
  return reserveClaim(pubkey, claimKey, amountSats);
}

export async function confirmClaimRemote(pubkey: string, claimKey: string): Promise<void> {
  if (ISSUER_API_URL && ISSUER_API_SECRET) {
    try {
      await fetch(`${ISSUER_API_URL}/claims/${pubkey}/${encodeURIComponent(claimKey)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ISSUER_API_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { /* best effort */ }
  }
  confirmClaim(pubkey, claimKey);
}

export async function releaseClaimRemote(pubkey: string, claimKey: string): Promise<void> {
  if (ISSUER_API_URL && ISSUER_API_SECRET) {
    try {
      await fetch(`${ISSUER_API_URL}/claims/${pubkey}/${encodeURIComponent(claimKey)}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${ISSUER_API_SECRET}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release" }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch { /* best effort */ }
  }
  releaseClaim(pubkey, claimKey);
}
