import "dotenv/config";
import WebSocket from "ws";

// Polyfill para Node.js 20 (no tiene WebSocket global sin --experimental-websocket)
// Debe setearse antes de que nostr-tools cree cualquier conexión
(globalThis as any).WebSocket = WebSocket;

import {
  SimplePool,
  finalizeEvent,
  getPublicKey,
  nip19,
  type EventTemplate,
  type Event,
  type Filter,
} from "nostr-tools";

export const RELAYS = (process.env.NEXT_PUBLIC_RELAYS ||
  "wss://relay.lacrypta.ar,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net,wss://nostr.mom")
  .split(",")
  .map((r) => r.trim())
  .filter(Boolean);

export const ALBUM_ID = process.env.NEXT_PUBLIC_ALBUM_ID || "mundial-2026";

// Resuelve la clave privada del issuer desde ISSUER_NSEC (nsec o hex).
// Memoizada: antes se re-decodificaba el nsec en cada publish.
let _issuerSk: Uint8Array | null = null;
export function getIssuerSk(): Uint8Array {
  if (_issuerSk) return _issuerSk;
  const raw = process.env.ISSUER_NSEC;
  if (!raw) throw new Error("Falta ISSUER_NSEC en .env");
  if (raw.startsWith("nsec")) {
    const { data } = nip19.decode(raw);
    _issuerSk = data as Uint8Array;
  } else {
    _issuerSk = Uint8Array.from(Buffer.from(raw, "hex"));
  }
  return _issuerSk;
}

export function issuerPubkey(): string {
  return getPublicKey(getIssuerSk());
}

export const pool = new SimplePool();

export async function publish(template: EventTemplate): Promise<Event> {
  const ev = finalizeEvent(template, getIssuerSk());
  await Promise.any(pool.publish(RELAYS, ev));
  return ev;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function tag(ev: Event, name: string): string | undefined {
  return ev.tags.find((t) => t[0] === name)?.[1];
}

// ── Suscripciones resilientes ─────────────────────────────────────────────────
// SimplePool no re-establece una suscripción cuando el relay corta la conexión:
// el stream muere en silencio (visto en producción — el issuer dejó de recibir
// los ORDER_REQUEST que llegaban solo por damus). El manager registra cada
// suscripción con una fábrica de filtro y un watchdog las recrea periódicamente:
// el filtro se reconstruye en cada ciclo (con el watermark actualizado como
// `since`), así la re-suscripción backfillea lo que se perdió en el medio y el
// ledger de "ya procesado" descarta los duplicados re-entregados.

interface ManagedSub {
  label: string;
  makeFilter: () => Filter;
  onevent: (ev: Event) => void;
  closer: { close: () => void } | null;
}

const managedSubs: ManagedSub[] = [];

function openSub(m: ManagedSub): void {
  try {
    m.closer?.close();
  } catch {
    /* el closer puede fallar si el socket ya murió */
  }
  m.closer = pool.subscribeMany(RELAYS, m.makeFilter() as any, { onevent: m.onevent });
}

/**
 * Suscripción administrada: se abre ya y el watchdog la renueva en cada ciclo.
 * makeFilter se invoca en cada (re)apertura — leé ahí el watermark vigente.
 */
export function manageSubscription(
  label: string,
  makeFilter: () => Filter,
  onevent: (ev: Event) => void
): void {
  const m: ManagedSub = { label, makeFilter, onevent, closer: null };
  managedSubs.push(m);
  openSub(m);
}

/**
 * Renueva todas las suscripciones administradas cada intervalMs y loguea el
 * estado de los relays cuando hay desconectados. Llamar una vez en main().
 */
export function startSubscriptionWatchdog(intervalMs = 5 * 60_000): void {
  setInterval(() => {
    const status = pool.listConnectionStatus();
    const down = [...status.entries()].filter(([, ok]) => !ok).map(([url]) => url);
    if (down.length > 0) {
      console.log(`🔄 watchdog: ${down.length}/${status.size} relays caídos (${down.map((u) => u.replace("wss://", "").replace("ws://", "")).join(", ")}) — renovando suscripciones`);
    }
    for (const m of managedSubs) openSub(m);
  }, intervalMs);
}

/** Cierra todas las suscripciones administradas (shutdown ordenado). */
export function closeManagedSubscriptions(): void {
  for (const m of managedSubs) {
    try {
      m.closer?.close();
    } catch {
      /* ignorar: estamos saliendo */
    }
  }
}
