// Kinds custom del juego (ver docs/figus-modelo-datos-nostr.md)
export const KIND = {
  ALBUM: 30050, // addressable · issuer · definición del álbum
  STICKER: 30051, // addressable · issuer · plantilla de figurita
  PACK: 30052, // addressable · issuer · definición de sobre
  OWNERSHIP: 30100, // addressable · issuer · propiedad vigente
  GRANT: 1573, // regular · issuer · figus entregadas al abrir sobre
  LISTING: 30200, // addressable · usuario · oferta de venta
  SETTLEMENT: 1574, // regular · issuer · transferencia P2P confirmada
  CLAIM: 1575, // regular · issuer · premio con zap split
  FREE_PACK_CLAIM: 30110, // addressable · usuario · prueba de que ya reclamó su sobre gratis
  PENALTY_PLAY:   30300, // addressable · usuario · resultado de penal (d = "penalty:YYYY-MM-DD")
  PENALTY_MATCH:  30301, // addressable · desafiante · partida PvP (d = "pmatch:{pk8}:{ts}")
  PENALTY_COMMIT: 1576,  // regular · pateador · compromiso de zona (hash)
  PENALTY_BLOCK:  1577,  // regular · arquero · elección de columna
  PENALTY_REVEAL: 1578,  // regular · pateador · revelación zona + nonce
  REWARD_CLAIM:   1579,  // regular · usuario · solicitud de premio por página/álbum completo
  STEAL_CLAIM:    1580,  // regular · ganador · reclama figurita robada al rival tras ganar penalty
  ORDER_REQUEST:  1583,  // regular · usuario · pide factura para comprar sobre/figu (figus-action)
  ORDER_INVOICE:  1584,  // regular · issuer · responde con bolt11 que el issuer cobrará y verificará
  PRONO:          30302, // addressable · usuario · pronóstico de partido (d = "prono:{albumId}:{matchId}")
  BET_OFFER:      30400, // addressable · apostador A · oferta de apuesta (d = bet ID)
  BET_ACCEPT:     1591,  // regular · apostador B · acepta oferta
  BET_SETTLE:     1592,  // regular · issuer · liquidación (pago confirmado)
  BET_CANCEL:     1593,  // regular · apostador A · solicitud de cancelación
  TOURNEY_MATCH:  30305, // addressable · issuer · partido de torneo interactivo
  ZAP_REQUEST: 9734, // NIP-57
  ZAP_RECEIPT: 9735, // NIP-57
} as const;

export const ALBUM_ID = process.env.NEXT_PUBLIC_ALBUM_ID || "mundial-2026";

export const ISSUER_PUBKEY = process.env.NEXT_PUBLIC_ISSUER_PUBKEY || "";
export const ISSUER_LN_ADDRESS = process.env.NEXT_PUBLIC_ISSUER_LN_ADDRESS || "";

export const RELAYS = (process.env.NEXT_PUBLIC_RELAYS ||
  "wss://relay.lacrypta.ar,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nostr.mom")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

// Helper para construir el coordinate "a" de un evento addressable
export function addr(kind: number, pubkey: string, d: string): string {
  return `${kind}:${pubkey}:${d}`;
}
