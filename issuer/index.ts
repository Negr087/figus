import "dotenv/config";
import http from "http";
import { verifyEvent, type Event } from "nostr-tools";
import {
  RELAYS, ALBUM_ID, pool, publish, issuerPubkey, now, tag,
  manageSubscription, startSubscriptionWatchdog, closeManagedSubscriptions,
} from "./lib";
import { CATALOG, ALL_NUMBERS, rollSticker } from "../src/lib/catalog";
import {
  parseMatch, parseCommit, parseBlock, parseReveal, deriveMatchState,
} from "../src/lib/penalty";
import { handleBetLock, handleBetCancel, loadBetState, settleBetsForMatch, payLnAddress, getLud16 } from "./bets";
import { startFootballPoller } from "./football";
import { getPayments } from "./payments";
import { getTournament, viewTournament, resetTournament, isRegistered, registerPlayer, processCommit, processBlock, processReveal, timeoutStaleMatches, findTournamentById, ENTRY_SATS } from "./tournament";
import { listenNwcPayments } from "../src/lib/nwc-server";
import {
  getOrder, putOrder, updateOrder, pendingOrders, pruneOrders,
  wasProcessed, markProcessed, getWatermark, setWatermark,
  getCachedOwnership, setCachedOwnership, getOwnershipForPubkey,
  hasClaimRecord, reserveClaimRecord, confirmClaimRecord, releaseClaimRecord,
  flushSync, acquireProcessLock, releaseProcessLock,
  type Order, type OrderAction,
} from "./store";

const KIND = {
  OWNERSHIP: 30100,
  GRANT: 1573,
  LISTING: 30200,
  SETTLEMENT: 1574,
  ZAP_RECEIPT: 9735,
  FREE_PACK_CLAIM: 30110,
  ORDER_REQUEST:  1583,
  ORDER_INVOICE:  1584,
  PENALTY_MATCH:  30301,
  PENALTY_COMMIT: 1576,
  PENALTY_BLOCK:  1577,
  PENALTY_REVEAL: 1578,
  STEAL_CLAIM:    1580,
  BET_CANCEL:     1593,
  TOURNEY_MATCH:  30305,
};

// Precios de los sobres (sats). Verificados al cobrar la factura propia.
const PACK_PRICE = { "open-pack": 21, "open-pack-10": 189 } as const;
const PACK_COUNT = { "open-pack": 1, "open-pack-10": 10 } as const;
const MARKET_FEE_RATE = 0.02; // 2% al vendedor en el mercado P2P

const ISSUER = issuerPubkey();
const payments = getPayments();

// Pubkey Nostr de la Lightning Address del issuer (puede diferir de ISSUER).
// rizful.com y otros providers tienen su propia keypair para publicar receipts.
let LN_PUBKEY: string | null = null;

async function resolveLnPubkey(): Promise<void> {
  const addr = process.env.NEXT_PUBLIC_ISSUER_LN_ADDRESS;
  if (!addr?.includes("@")) return;
  const [name, domain] = addr.split("@");
  try {
    const res = await fetch(`https://${domain}/.well-known/lnurlp/${name}`);
    const data = await res.json() as { nostrPubkey?: string };
    if (data.nostrPubkey) {
      LN_PUBKEY = data.nostrPubkey;
      console.log(`   LN pubkey (${addr}): ${LN_PUBKEY.slice(0, 12)}…`);
    }
  } catch (e) {
    console.log("   ⚠️ No se pudo resolver la pubkey de la LN address");
  }
}

/**
 * Lee la cantidad vigente de una figu para un usuario (último 30100).
 * El cache persiste en disco (data/ownership.json): el issuer es el único autor
 * de los 30100, así que su espejo local sobrevive reinicios y solo consulta a
 * relays la primera vez que ve una combinación usuario+figu.
 */
function ownKey(pk: string, num: number) {
  return `${pk}:${num}`;
}

async function getOwnership(pk: string, num: number): Promise<number> {
  const key = ownKey(pk, num);
  const cached = getCachedOwnership(key);
  if (cached !== undefined) return cached;
  // consultar a relays (solo en frío: primera vez para este usuario+figu)
  const evs = await listOnce([
    { kinds: [KIND.OWNERSHIP], authors: [ISSUER], "#p": [pk], "#d": [`${pk}:${ALBUM_ID}:${num}`] },
  ]);
  const latest = evs.sort((a, b) => b.created_at - a.created_at)[0];
  const count = latest ? Number(tag(latest, "count") || "0") : 0;
  setCachedOwnership(key, count);
  return count;
}

async function setOwnership(pk: string, num: number, count: number) {
  setCachedOwnership(ownKey(pk, num), count);
  await publish({
    kind: KIND.OWNERSHIP,
    created_at: now(),
    content: "",
    tags: [
      ["d", `${pk}:${ALBUM_ID}:${num}`],
      ["p", pk],
      ["sticker", `${ALBUM_ID}:${num}`],
      ["count", String(count)],
      ["pasted", count > 0 ? "true" : "false"],
    ],
  });
}

// Serializa lecturas+escrituras de ownership por clave "pubkey:num": sin esto,
// dos operaciones concurrentes sobre la misma figu del mismo usuario (ej. una
// compra y un robo de penales casi simultáneos) podían leer el mismo valor
// viejo y una pisaba el incremento de la otra → figu perdida silenciosamente.
const keyLocks = new Map<string, Promise<unknown>>();

function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = keyLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn); // corre igual si la op anterior en la cola falló
  const chained = run.catch(() => {}); // no trabar la cola por un error
  keyLocks.set(key, chained);
  chained.finally(() => {
    if (keyLocks.get(key) === chained) keyLocks.delete(key); // nadie más encoló detrás
  });
  return run;
}

async function bump(pk: string, num: number, delta: number) {
  await withKeyLock(ownKey(pk, num), async () => {
    const cur = await getOwnership(pk, num);
    await setOwnership(pk, num, Math.max(0, cur + delta));
  });
}

async function listOnce(filters: any[]): Promise<Event[]> {
  const results = await Promise.all(
    filters.map((f) => pool.querySync(RELAYS, f, { maxWait: 3000 }))
  );
  const byId = new Map<string, Event>();
  for (const arr of results) for (const ev of arr) byId.set(ev.id, ev);
  return Array.from(byId.values());
}

// Extrae el zap request (9734) embebido en el campo description del receipt
function extractZapRequest(receipt: Event): Event | null {
  const desc = tag(receipt, "description");
  if (!desc) return null;
  try {
    return JSON.parse(desc) as Event;
  } catch {
    return null;
  }
}

async function handleOpenPack(buyer: string, packCount = 1): Promise<number[]> {
  const drawn = Array.from({ length: 7 * packCount }, rollSticker);

  await publish({
    kind: KIND.GRANT,
    created_at: now(),
    content: "",
    tags: [
      ["p", buyer],
      ...drawn.map((n) => ["sticker", `${ALBUM_ID}:${n}`] as string[]),
    ],
  });

  // Un bump por figu ÚNICA (un pack-10 trae repetidas): publica un solo 30100
  // con el count final en vez de un evento intermedio por copia.
  const perSticker = new Map<number, number>();
  for (const n of drawn) perSticker.set(n, (perSticker.get(n) ?? 0) + 1);
  for (const [n, copies] of perSticker) await bump(buyer, n, +copies);
  console.log(`🎁 grant a ${buyer.slice(0, 8)}…: ${packCount} sobre(s), figus ${drawn.join(", ")}`);
  return drawn;
}

// ─── Flujo de órdenes (Fix #1 · Opción A) ─────────────────────────────────────
// El issuer emite la factura, la cobra en SU wallet y solo concede tras confirmar
// el pago. Reemplaza la entrega basada en zap receipts no verificados.

// Valida un listing del mercado y devuelve sus datos si está vendible.
type ListingResult =
  | { ok: true; seller: string; num: number; price: number }
  | { ok: false; reason: string };

async function loadValidListing(aTag: string): Promise<ListingResult> {
  const [, seller, ...dParts] = aTag.split(":");
  const d = dParts.join(":");
  if (!seller || !d) return { ok: false, reason: "Coordenada de listing inválida" };

  const listings = await listOnce([{ kinds: [KIND.LISTING], authors: [seller], "#d": [d] }]);
  const listing = listings.sort((a, b) => b.created_at - a.created_at)[0];
  if (!listing) {
    console.log("⚠️ listing no encontrado:", aTag);
    return { ok: false, reason: "Esa figurita ya no está en venta" };
  }
  // El autor del listing debe coincidir con el seller del coordinate (Fix #4).
  if (listing.pubkey !== seller) { console.log("⚠️ listing con autor inconsistente"); return { ok: false, reason: "Listing inválido" }; }
  if (!verifyEvent(listing)) { console.log("⚠️ listing con firma inválida"); return { ok: false, reason: "Listing inválido" }; }
  if (tag(listing, "status") === "sold") {
    console.log("⚠️ listing ya vendido");
    return { ok: false, reason: "Esa figurita ya se vendió" };
  }

  const sticker = tag(listing, "sticker");
  if (!sticker) return { ok: false, reason: "Listing inválido" };
  const num = Number(sticker.split(":")[1]);
  const price = Number(tag(listing, "price") || "0");

  const sellerHas = await getOwnership(seller, num);
  if (sellerHas < 1) {
    console.log("⚠️ el vendedor no tiene la figu");
    return { ok: false, reason: "El vendedor ya no tiene esa figurita disponible" };
  }

  return { ok: true, seller, num, price };
}

// Responde de inmediato con un ORDER_INVOICE con tag "error" en vez de dejar
// que el cliente espere el timeout completo (~25-30s) sin saber por qué.
async function rejectOrder(buyer: string, evId: string, action: string, reason: string): Promise<void> {
  console.log(`⚠️ orden rechazada (${buyer.slice(0, 8)}…, ${action}): ${reason}`);
  await publish({
    kind: KIND.ORDER_INVOICE,
    created_at: now(),
    content: "",
    tags: [["p", buyer], ["e", evId], ["figus-action", action], ["error", reason]],
  });
}

// Recibe un ORDER_REQUEST firmado, valida, emite la factura y responde con ORDER_INVOICE.
async function handleOrderRequest(ev: Event) {
  if (!verifyEvent(ev)) return console.log("⚠️ order request con firma inválida");
  if (wasProcessed("order-req", ev.id)) return;
  markProcessed("order-req", ev.id);

  const action = tag(ev, "figus-action") as OrderAction | undefined;
  const buyer = ev.pubkey;
  if (action !== "open-pack" && action !== "open-pack-10" && action !== "buy-sticker" && action !== "tournament-register") {
    return console.log("⚠️ order request con acción desconocida:", action);
  }

  if (action === "tournament-register") {
    const t = getTournament();
    const rejectReason =
      t.status !== "registering" ? "El torneo ya comenzó" :
      isRegistered(buyer)        ? "Ya estás inscripto en este torneo" :
      t.registrations.length >= t.maxPlayers ? "El torneo está lleno" :
      null;
    if (rejectReason) {
      console.log(`⚠️ torneo-register rechazado (${buyer.slice(0, 8)}): ${rejectReason}`);
      await publish({
        kind: KIND.ORDER_INVOICE,
        created_at: now(),
        content: "",
        tags: [["p", buyer], ["e", ev.id], ["figus-action", action], ["error", rejectReason]],
      });
      return;
    }
  }

  let amountSats: number;
  let listingCoord: string | undefined;
  let seller: string | undefined;
  let stickerNum: number | undefined;
  let scheduledAt: number | undefined;
  let maxPlayers: number | undefined;

  if (action === "buy-sticker") {
    const aTag = tag(ev, "a");
    if (!aTag) return console.log("⚠️ buy-sticker sin coordinate 'a'");
    const listing = await loadValidListing(aTag);
    if (!listing.ok) {
      // Antes esto solo logueaba y dejaba al comprador esperando ~25-30s hasta
      // el timeout del cliente (la "figurita fantasma": parece comprable pero
      // ya no lo es) — ahora se le avisa al instante por qué no se puede.
      return rejectOrder(buyer, ev.id, action, listing.reason);
    }
    if (listing.seller === buyer) return rejectOrder(buyer, ev.id, action, "No podés comprar tu propia figurita");

    // El vendedor puede republicar el listing (mismo d-tag, precio nuevo) entre
    // que el comprador lo vio en pantalla y que esta orden llega — sin este
    // chequeo se le cobraba el precio vigente AHORA, distinto del que aceptó.
    // El cliente manda el precio que vio; si no coincide, se rechaza en vez de
    // cobrar de más en silencio.
    const expectedPriceRaw = tag(ev, "expectedPrice");
    const expectedPrice = expectedPriceRaw !== undefined ? Number(expectedPriceRaw) : undefined;
    if (expectedPrice !== undefined && Number.isFinite(expectedPrice) && expectedPrice !== listing.price) {
      console.log(`⚠️ precio cambió para ${aTag}: esperaba ${expectedPrice}, ahora ${listing.price}`);
      return rejectOrder(buyer, ev.id, action,
        `El precio cambió a ${listing.price} sats (era ${expectedPrice}). Volvé a intentar si todavía la querés.`);
    }

    amountSats = listing.price;
    listingCoord = aTag;
    seller = listing.seller;
    stickerNum = listing.num;
    if (amountSats <= 0) return console.log("⚠️ precio de listing inválido");
  } else if (action === "tournament-register") {
    amountSats = ENTRY_SATS;
    const rawScheduledAt = tag(ev, "scheduledAt");
    if (rawScheduledAt) {
      const parsed = Number(rawScheduledAt);
      if (Number.isFinite(parsed)) scheduledAt = parsed;
    }
    const rawMaxPlayers = tag(ev, "maxPlayers");
    if (rawMaxPlayers) {
      const parsed = Number(rawMaxPlayers);
      if (parsed === 4 || parsed === 8) maxPlayers = parsed;
    }
  } else {
    amountSats = PACK_PRICE[action as keyof typeof PACK_PRICE];
  }

  let invoice: string, paymentHash: string;
  try {
    ({ invoice, paymentHash } = await payments.makeInvoice(
      amountSats,
      `figus:${action}:${buyer.slice(0, 12)}`
    ));
  } catch (e) {
    return console.error("⚠️ no se pudo emitir factura:", (e as Error).message);
  }

  putOrder({
    paymentHash, buyer, action, amountSats, status: "pending",
    ts: now(), listingCoord, seller, stickerNum, scheduledAt, maxPlayers,
  });

  await publish({
    kind: KIND.ORDER_INVOICE,
    created_at: now(),
    content: "",
    tags: [
      ["p", buyer],
      ["e", ev.id],
      ["figus-action", action],
      ["bolt11", invoice],
      ["payment_hash", paymentHash],
      ["amount", String(amountSats)],
    ],
  });
  console.log(`🧾 factura ${action} (${amountSats} sats) para ${buyer.slice(0, 8)}… hash=${paymentHash.slice(0, 12)}…`);
}

// Conciliaciones en vuelo. Una conciliación de pack-10 tarda más que ORDER_POLL_MS
// (lookup NWC + 70 bumps con query a relays), así que sin este guard el poller
// re-entraba a fulfillOrder con la orden todavía "pending" y concedía 2-3 veces
// el mismo pago (visto en producción: 1 sobre pagado → 2 grants, 1 caja → 3 grants).
const fulfilling = new Set<string>();

// Concreta una orden ya pagada (idempotente vía ledger + guard de re-entrada).
// trustedSats: cuando viene de una notificación NWC (kind 23196), el pago ya
// está confirmado — saltear lookup_invoice para no consumir rate limit.
async function fulfillOrder(paymentHash: string, trustedSats?: number) {
  if (fulfilling.has(paymentHash)) return;
  const order = getOrder(paymentHash);
  if (!order || order.status !== "pending") return;
  fulfilling.add(paymentHash);
  try {
    await fulfillOrderInner(order, trustedSats);
  } finally {
    fulfilling.delete(paymentHash);
  }
}

async function fulfillOrderInner(order: Order, trustedSats?: number) {
  const { paymentHash } = order;
  let info: { settled: boolean; amountSats: number };
  if (trustedSats !== undefined) {
    // Pago confirmado por notificación NWC — no necesitamos lookup_invoice.
    info = { settled: true, amountSats: trustedSats };
  } else {
    try {
      info = await payments.lookupInvoice(paymentHash);
    } catch (e) {
      return console.log(`   lookup ${paymentHash.slice(0, 10)}… falló: ${(e as Error).message}`);
    }
    if (!info.settled) return;
  }
  // Verificar que se cobró al menos el monto esperado (Fix #1).
  if (info.amountSats > 0 && info.amountSats < order.amountSats) {
    console.log(`⚠️ pago insuficiente ${info.amountSats} < ${order.amountSats} sats — orden marcada failed`);
    updateOrder(paymentHash, { status: "failed" });
    return;
  }

  if (order.action === "buy-sticker") {
    await settleBuySticker(order);
  } else if (order.action === "tournament-register") {
    const ownedData = getOwnershipForPubkey(order.buyer);
    const ownedUnique = Object.values(ownedData).filter(c => c > 0).length;
    const result = await registerPlayer(order.buyer, ownedUnique, order.scheduledAt, order.maxPlayers);
    updateOrder(paymentHash, { status: result.ok ? "granted" : "failed" });
    console.log(`🏆 registro torneo ${order.buyer.slice(0, 8)}…: ${result.ok ? "ok" : result.error}`);
  } else {
    const drawn = await handleOpenPack(order.buyer, PACK_COUNT[order.action as keyof typeof PACK_COUNT]);
    updateOrder(paymentHash, { status: "granted", stickers: drawn });
  }
}

async function settleBuySticker(order: Order) {
  const { seller, stickerNum, listingCoord, amountSats, buyer, paymentHash } = order;
  if (!seller || stickerNum === undefined || !listingCoord) {
    updateOrder(paymentHash, { status: "failed" });
    return;
  }

  // Revalidar tenencia y descontarla en una sola operación atómica (mismo lock
  // que bump()): si no, otra venta/robo concurrente del mismo vendedor podía
  // pasar la validación y descontar igual, dejando el count en negativo-clamp.
  const sold = await withKeyLock(ownKey(seller, stickerNum), async () => {
    const sellerHas = await getOwnership(seller, stickerNum);
    if (sellerHas < 1) return false;
    await setOwnership(seller, stickerNum, sellerHas - 1);
    return true;
  });
  if (!sold) {
    console.log("⚠️ el vendedor ya no tiene la figu — orden failed (reembolso manual)");
    updateOrder(paymentHash, { status: "failed" });
    return;
  }

  await bump(buyer, stickerNum, +1);

  await publish({
    kind: KIND.SETTLEMENT,
    created_at: now(),
    content: "",
    tags: [
      ["a", listingCoord],
      ["sticker", `${ALBUM_ID}:${stickerNum}`],
      ["from", seller],
      ["to", buyer],
      ["price", String(amountSats)],
      ["payment_hash", paymentHash],
    ],
  });
  updateOrder(paymentHash, { status: "granted" });
  console.log(`🤝 settlement #${stickerNum}: ${seller.slice(0, 8)}… → ${buyer.slice(0, 8)}…`);

  // Pagar al vendedor (precio menos fee) vía su Lightning Address.
  const fee = Math.floor(amountSats * MARKET_FEE_RATE);
  const payout = amountSats - fee;
  const lud16 = await getLud16(seller);
  if (!lud16) {
    console.log(`⚠️ vendedor ${seller.slice(0, 8)}… sin lud16 — payout ${payout} sats pendiente`);
    return;
  }
  try {
    await payLnAddress(lud16, payout);
    console.log(`💸 payout ${payout} sats a ${lud16} (fee ${fee})`);
  } catch (e) {
    console.error(`❌ error pagando al vendedor: ${(e as Error).message}`);
  }
}

async function onReceipt(receipt: Event) {
  if (wasProcessed("receipt", receipt.id)) return;
  markProcessed("receipt", receipt.id);

  // El receipt 9735 debe ser un evento con firma válida (Fix #1/#3): un atacante ya
  // no puede inyectar un receipt arbitrario sin una firma real del relay/provider.
  if (!verifyEvent(receipt)) {
    return console.log(`   ⚠️ Receipt ${receipt.id.slice(0, 10)} con firma inválida — ignorando`);
  }

  const req = extractZapRequest(receipt);
  const action = req ? tag(req, "figus-action") : null;

  // IMPORTANTE: open-pack / open-pack-10 / buy-sticker YA NO se conceden desde un
  // receipt no verificable. Esos flujos van por ORDER_REQUEST + factura propia del
  // issuer (handleOrderRequest + fulfillOrder), que confirma el pago realmente.
  if (action === "bet-lock") {
    // El zap request embebido debe estar firmado por el pagador declarado.
    if (!req || !verifyEvent(req)) {
      return console.log("   ⚠️ bet-lock con zap request no firmado — ignorando");
    }
    try {
      await handleBetLock(req, receipt);
    } catch (e) {
      console.error("Error procesando bet-lock:", e);
    }
    return;
  }

  // Cualquier otra acción legacy (incl. open-pack) se ignora explícitamente.
  if (action) {
    console.log(`   ⚠️ Receipt con acción '${action}' ignorado — usá ORDER_REQUEST para sobres/compras`);
  }
}

// ─── Sobre gratis (Fix #5) — concedido por el issuer, una vez por pubkey ───────

async function handleFreePack(ev: Event) {
  if (!verifyEvent(ev)) return console.log("⚠️ free-pack claim con firma inválida");
  const buyer = ev.pubkey;
  const key = `free-pack:${buyer}`;
  if (wasProcessed("free-pack", buyer)) return;

  // Verificar contra relays que no se haya concedido ya (sobrevive reinicios).
  const priorGrants = await listOnce([
    { kinds: [KIND.GRANT], authors: [ISSUER], "#p": [buyer], limit: 1 },
  ]);
  if (priorGrants.length > 0) {
    markProcessed("free-pack", buyer);
    return console.log(`ℹ️ ${buyer.slice(0, 8)}… ya tenía grants — free-pack no se duplica`);
  }

  markProcessed("free-pack", buyer);
  await handleOpenPack(buyer, 1);
  console.log(`🎁 sobre gratis concedido a ${buyer.slice(0, 8)}… (${key})`);
}

// ─── Robo de figuritas (penalty match) ───────────────────────────────────────

async function handleStealClaim(ev: Event) {
  if (!verifyEvent(ev)) return console.log("⚠️ steal claim con firma inválida");
  const coord = tag(ev, "a");
  if (!coord) return console.log("⚠️ steal claim sin coord de partida");

  if (wasProcessed("steal", ev.id)) return;
  markProcessed("steal", ev.id);

  console.log(`🃏 steal claim de ${ev.pubkey.slice(0, 8)}… para ${coord} (ev ${ev.id.slice(0, 10)}…)`);

  // Verificar que no procesamos esto antes (sobrevive reinicios del issuer)
  const existingSettlements = await listOnce([{
    kinds: [KIND.SETTLEMENT], authors: [ISSUER], "#p": [ev.pubkey], "#a": [coord],
  }]);
  if (existingSettlements.some(e => tag(e, "figus-action") === "penalty-steal")) {
    return console.log(`ℹ️ steal ya procesado anteriormente: ${coord}:${ev.pubkey.slice(0, 8)}…`);
  }

  // Parsear coord: "30301:challengerPubkey:d"
  const parts = coord.split(":");
  if (parts.length < 3) return console.log("⚠️ coord inválido:", coord);
  const challengerPk = parts[1];
  const d = parts.slice(2).join(":");

  // Obtener el evento del match
  const matchEvs = await listOnce([{
    kinds: [KIND.PENALTY_MATCH], authors: [challengerPk], "#d": [d],
  }]);
  const matchEv = matchEvs.sort((a, b) => b.created_at - a.created_at)[0];
  if (!matchEv) return console.log("⚠️ match event no encontrado:", coord);
  if (!verifyEvent(matchEv)) return console.log("⚠️ match event con firma inválida");

  const match = parseMatch(matchEv);
  if (!match) return console.log("⚠️ no se pudo parsear el match");

  // Obtener eventos de juego (commits, blocks, reveals).
  // Solo aceptamos jugadas con firma válida (Fix #4): descarta movimientos forjados.
  const playEvs = (await listOnce([{
    kinds: [KIND.PENALTY_COMMIT, KIND.PENALTY_BLOCK, KIND.PENALTY_REVEAL], "#a": [coord],
  }])).filter(verifyEvent);

  const commits = playEvs
    .filter(e => e.kind === KIND.PENALTY_COMMIT)
    .flatMap(e => { const c = parseCommit(e); return c ? [c] : []; });
  const blocks = playEvs
    .filter(e => e.kind === KIND.PENALTY_BLOCK)
    .flatMap(e => { const b = parseBlock(e); return b ? [b] : []; });
  const reveals = playEvs
    .filter(e => e.kind === KIND.PENALTY_REVEAL)
    .flatMap(e => { const r = parseReveal(e); return r ? [r] : []; });

  const state = deriveMatchState(match, commits, blocks, reveals);

  if (state.phase !== "finished") {
    return console.log("⚠️ match no terminado todavía (phase:", state.phase + ")");
  }
  if (!state.winner) {
    return console.log("⚠️ empate — nadie roba");
  }
  if (state.winner !== ev.pubkey) {
    return console.log(`⚠️ ${ev.pubkey.slice(0, 8)}… no es el ganador (ganó ${state.winner.slice(0, 8)}…)`);
  }

  const winner = ev.pubkey;
  const loser = winner === match.challenger ? match.challenged : match.challenger;

  // Obtener las figuritas del perdedor
  const ownershipEvs = await listOnce([{
    kinds: [KIND.OWNERSHIP], authors: [ISSUER], "#p": [loser],
  }]);

  // Agrupar por d-tag, tomar el más reciente por figurita
  const latestByD = new Map<string, { num: number; count: number; ts: number }>();
  for (const e of ownershipEvs) {
    const dTag = tag(e, "d");
    const stickerTag = tag(e, "sticker");
    const countStr = tag(e, "count");
    if (!dTag || !stickerTag || !countStr) continue;
    const num = Number(stickerTag.split(":")[1]);
    const count = Number(countStr);
    const existing = latestByD.get(dTag);
    if (!existing || e.created_at > existing.ts) {
      latestByD.set(dTag, { num, count, ts: e.created_at });
    }
  }

  const available = [...latestByD.values()]
    .filter(({ count }) => count > 0)
    .map(({ num }) => num);

  if (available.length === 0) {
    return console.log(`ℹ️ ${loser.slice(0, 8)}… no tiene figuritas para robar`);
  }

  const stolen = available[Math.floor(Math.random() * available.length)];

  await bump(loser, stolen, -1);
  await bump(winner, stolen, +1);

  await publish({
    kind: KIND.SETTLEMENT,
    created_at: now(),
    content: "",
    tags: [
      ["e", ev.id],
      ["a", coord],
      ["figus-action", "penalty-steal"],
      ["sticker", `${ALBUM_ID}:${stolen}`],
      ["from", loser],
      ["to", winner],
      ["p", winner],
    ],
  });

  console.log(`🃏 steal: figu #${stolen} de ${loser.slice(0, 8)}… → ${winner.slice(0, 8)}…`);
}

// ── Torneo interactivo: penales por Nostr ─────────────────────────────────────

async function handleTourneyKick(ev: Event) {
  if (!verifyEvent(ev)) return;
  const matchCoord = tag(ev, "a");
  if (!matchCoord || !matchCoord.startsWith("30305:")) return; // not a tourney kick

  if (wasProcessed("tourney-kick", ev.id)) return;
  markProcessed("tourney-kick", ev.id);

  if (ev.kind === KIND.PENALTY_COMMIT) {
    const commitHash = ev.tags.find(t => t[0] === "commit")?.[1];
    if (!commitHash) return console.log("⚠️ tourney commit sin hash");
    const result = processCommit(matchCoord, ev.id, commitHash, ev.pubkey);
    console.log(`⚽ tourney commit ${matchCoord.split(":")[3]}… ronda ${ev.tags.find(t => t[0] === "round")?.[1]}: ${result.ok ? "ok" : result.error}`);

  } else if (ev.kind === KIND.PENALTY_BLOCK) {
    const commitId = ev.tags.find(t => t[0] === "e")?.[1];
    const colStr   = ev.tags.find(t => t[0] === "col")?.[1];
    if (!commitId || colStr === undefined) return console.log("⚠️ tourney block incompleto");
    const result = processBlock(matchCoord, commitId, Number(colStr), ev.pubkey);
    console.log(`🧤 tourney block ${matchCoord.split(":")[3]} col=${colStr}: ${result.ok ? "ok" : result.error}`);

  } else if (ev.kind === KIND.PENALTY_REVEAL) {
    const zoneStr = ev.tags.find(t => t[0] === "zone")?.[1];
    const nonce   = ev.tags.find(t => t[0] === "nonce")?.[1];
    if (zoneStr === undefined || !nonce) return console.log("⚠️ tourney reveal incompleto");
    const result = await processReveal(matchCoord, Number(zoneStr), nonce, ev.pubkey);
    console.log(`🎯 tourney reveal ${matchCoord.split(":")[3]}: ${result.ok ? "ok" : result.error}`);
  }
}

async function main() {
  acquireProcessLock(); // un solo issuer por data/ — dos a la vez duplican grants
  console.log("⚡ Issuer Figus");
  console.log("   pubkey:", ISSUER);
  console.log("   relays:", RELAYS.join(", "));
  console.log("   pagos:", payments.mode);
  await resolveLnPubkey();
  await loadBetState();
  startFootballPoller(settleBetsForMatch);

  // Listener event-driven: la wallet notifica pagos vía kind 23196 (NIP-47).
  // No hace lookup_invoice → no consume rate limit del relay NWC. El guard de
  // re-entrada de fulfillOrder hace inocuo que la notificación y el poller de
  // fallback lleguen a la vez (o que la wallet notifique duplicado).
  const nwcConn = process.env.ISSUER_NWC || process.env.REWARD_NWC;
  if (nwcConn && payments.mode === "nwc") {
    listenNwcPayments(nwcConn, (paymentHash, amountSats) => {
      console.log(`⚡ NWC payment_received: hash=${paymentHash.slice(0, 10)}… (${amountSats} sats)`);
      // Pasamos amountSats como "trusted" → fulfillOrderInner saltea lookup_invoice
      fulfillOrder(paymentHash, amountSats).catch((e) => console.error("fulfill (notification):", e));
    });
  }

  // Poller de cobro como fallback: corre cada 45s por si la notificación no
  // llega (wallet sin soporte de kind 23196, o el listener quedó zombie). El
  // cliente solo espera 90s el GRANT, así que un fallback de 5 min siempre
  // llegaba tarde — el comprador veía "no llegaron las figus" con la plata ya
  // cobrada. El barrido es SECUENCIAL, con pausa entre lookups, y nunca se
  // solapa con el anterior: cada lookup NWC mantiene un socket vivo hasta 20s y
  // las órdenes impagas se acumulan — un barrido paralelo termina saturando al
  // proveedor de la wallet (lookups que fallan → ninguna orden pagada se
  // confirma más).
  const POLL_MS = Number(process.env.ORDER_POLL_MS || "45000"); // 45s fallback
  const ORDER_TTL_S = Number(process.env.ORDER_TTL_MIN || "30") * 60;
  const LOOKUP_PACE_MS = 5000;
  let sweeping = false;
  setInterval(async () => {
    if (sweeping) return; // el barrido anterior sigue corriendo
    sweeping = true;
    try {
      for (const o of pendingOrders()) {
        // Una factura impaga no se concilia para siempre: vencida la TTL se expira
        // y deja de generar lookups NWC en cada tick. El comprador pide otra.
        // Antes de tirarla, un último lookup: si el motivo de no confirmar fueron
        // lookups fallidos (relay/wallet caída) y no que nunca se pagó, esto es
        // guita cobrada que se iba a perder en silencio — se loguea como alerta
        // distinta de "nunca pagada" para poder reconciliar a mano.
        if (now() - o.ts > ORDER_TTL_S) {
          await fulfillOrder(o.paymentHash).catch((e) => console.error("fulfill error:", e));
          const after = getOrder(o.paymentHash);
          if (after?.status === "pending") {
            updateOrder(o.paymentHash, { status: "expired" });
            console.log(`🕓 orden ${o.paymentHash.slice(0, 10)}… expirada sin pago (${o.action})`);
          }
          continue;
        }
        await fulfillOrder(o.paymentHash).catch((e) => console.error("fulfill error:", e));
        await new Promise<void>((r) => setTimeout(r, LOOKUP_PACE_MS));
      }
    } finally {
      sweeping = false;
    }
  }, POLL_MS);

  // ── Suscripciones con watermark + recuperación de eventos perdidos ──────────
  // Cada stream persiste el último created_at procesado (data/state.json). Al
  // (re)abrir la suscripción, el `since` arranca del watermark con 60s de margen
  // — acotado por maxBackfillS — así los eventos publicados mientras el issuer
  // estaba caído se recuperan, y el ledger anti-replay descarta los duplicados
  // que los relays re-entreguen.
  function subscribeStream(
    label: string,
    kinds: number[],
    handler: (ev: Event) => Promise<void> | void,
    maxBackfillS: number
  ) {
    console.log(`   Escuchando ${label} (kinds ${kinds.join(",")})…`);
    manageSubscription(
      label,
      () => {
        const wm = getWatermark(label);
        const floor = now() - maxBackfillS;
        return { kinds, since: Math.max(wm ? wm - 60 : floor, floor) };
      },
      (ev) => {
        setWatermark(label, ev.created_at);
        Promise.resolve(handler(ev)).catch(console.error);
      }
    );
  }

  // Órdenes de compra: backfill corto — una factura emitida para un request muy
  // viejo no le sirve a nadie (el comprador ya cerró la app) y expira sola.
  subscribeStream("order-requests", [KIND.ORDER_REQUEST], handleOrderRequest, 30 * 60);
  // Sobre gratis / steals / bet cancels: idempotentes y sin plata en juego al
  // backfillear — vale la pena recuperar hasta 24h de downtime.
  subscribeStream("free-pack-claims", [KIND.FREE_PACK_CLAIM], handleFreePack, 24 * 3600);
  subscribeStream("steal-claims", [KIND.STEAL_CLAIM], handleStealClaim, 24 * 3600);
  subscribeStream("bet-cancels", [KIND.BET_CANCEL], handleBetCancel, 24 * 3600);
  // Receipts de zap (solo bet-lock): el watermark reemplaza al viejo bloque de
  // recovery manual de 30 min — la suscripción ya backfillea desde donde quedó.
  subscribeStream("zap-receipts", [KIND.ZAP_RECEIPT], onReceipt, 30 * 60);
  // Penales del torneo interactivo: commit/block/reveal con tag ["tourney", ...]
  subscribeStream("tourney-kicks", [KIND.PENALTY_COMMIT, KIND.PENALTY_BLOCK, KIND.PENALTY_REVEAL], handleTourneyKick, 24 * 3600);

  // Timeout de partidos del torneo: verifica cada 60s si algún jugador superó 30 min
  setInterval(() => { timeoutStaleMatches().catch(console.error); }, 60_000);

  // Watchdog: renueva las suscripciones cada 5 min. SimplePool no re-suscribe
  // cuando un relay corta la conexión — sin esto el stream muere en silencio
  // (visto en producción: el issuer dejó de ver los requests que llegaban por
  // damus). La renovación relee el watermark, así no se pierde nada en el medio.
  startSubscriptionWatchdog(Number(process.env.SUB_WATCHDOG_MS || String(5 * 60_000)));

  // ── Housekeeping ─────────────────────────────────────────────────────────────
  // Poda diaria de órdenes terminales viejas para que data/orders.json no crezca
  // sin límite. Las pending no se tocan (las expira el poller por TTL).
  const PRUNE_MAX_AGE_S = Number(process.env.ORDER_RETENTION_DAYS || "7") * 86400;
  const pruned = pruneOrders(PRUNE_MAX_AGE_S);
  if (pruned > 0) console.log(`   🧹 ${pruned} órdenes viejas podadas del ledger`);
  setInterval(() => {
    const n = pruneOrders(PRUNE_MAX_AGE_S);
    if (n > 0) console.log(`🧹 housekeeping: ${n} órdenes viejas podadas`);
  }, 24 * 3600 * 1000);

  console.log("   ✅ Issuer listo");
}

// ── HTTP API (para Vercel u otro cliente externo) ─────────────────────────────
// Requiere Authorization: Bearer <ISSUER_API_SECRET>.
// Solo arranca si ISSUER_HTTP_PORT > 0 e ISSUER_API_SECRET están configurados.
//
// Rutas:
//   GET  /ownership/:pubkey            → { num: count, ... }
//   GET  /claims/:pubkey/:pageId       → { claimed: bool }
//   POST /claims/:pubkey/:pageId       → reserva atómica (200 ok / 409 conflict)
//   PATCH /claims/:pubkey/:pageId      → { action: "confirm" | "release" }

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

{
  const port   = Number(process.env.ISSUER_HTTP_PORT || "0");
  const secret = process.env.ISSUER_API_SECRET || "";
  if (port > 0 && secret) {
    http.createServer(async (req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.headers.authorization !== `Bearer ${secret}`) {
        res.writeHead(401); res.end('{"error":"Unauthorized"}'); return;
      }

      const url    = req.url ?? "";
      const method = req.method ?? "GET";

      // GET /ownership/:pubkey
      const mOwn = url.match(/^\/ownership\/([a-f0-9]{64})$/);
      if (mOwn && method === "GET") {
        res.writeHead(200);
        res.end(JSON.stringify(getOwnershipForPubkey(mOwn[1])));
        return;
      }

      // /claims/:pubkey/:pageId
      const mClaim = url.match(/^\/claims\/([a-f0-9]{64})\/([^/]+)$/);
      if (mClaim) {
        const [, pubkey, pageId] = mClaim;

        if (method === "GET") {
          res.writeHead(200);
          res.end(JSON.stringify({ claimed: hasClaimRecord(pubkey, pageId) }));
          return;
        }

        if (method === "POST") {
          let body: { amountSats?: number } = {};
          try { const raw = await readBody(req); if (raw) body = JSON.parse(raw); } catch {}
          const ok = reserveClaimRecord(pubkey, pageId, body.amountSats ?? 0);
          res.writeHead(ok ? 200 : 409);
          res.end(JSON.stringify(ok ? { ok: true } : { error: "Already claimed" }));
          return;
        }

        if (method === "PATCH") {
          let body: { action?: string } = {};
          try { const raw = await readBody(req); if (raw) body = JSON.parse(raw); } catch {}
          if (body.action === "confirm") confirmClaimRecord(pubkey, pageId);
          else if (body.action === "release") releaseClaimRecord(pubkey, pageId);
          res.writeHead(200); res.end('{"ok":true}');
          return;
        }
      }

      // GET /tournament
      if (url === "/tournament" && method === "GET") {
        res.writeHead(200);
        // viewTournament reads from disk without auto-creating a new one,
        // so a finished tournament's results remain visible until the next registration.
        res.end(JSON.stringify(viewTournament() ?? { status: "none" }));
        return;
      }

      // POST /tournament/reset  (admin: fuerza un torneo nuevo)
      if (url === "/tournament/reset" && method === "POST") {
        resetTournament();
        res.writeHead(200); res.end('{"ok":true}');
        return;
      }

      // GET /tournament/:id  → busca por id, en el actual o en el historial de
      // finalizados (un torneo finalizado se archiva cuando el siguiente arranca,
      // así su campeón/premio siguen siendo consultables para el claim).
      const mTid = url.match(/^\/tournament\/([a-z0-9]+)$/);
      if (mTid && method === "GET") {
        const t = findTournamentById(mTid[1]);
        res.writeHead(t ? 200 : 404);
        res.end(JSON.stringify(t ?? { error: "Tournament not found" }));
        return;
      }

      res.writeHead(404); res.end('{"error":"Not found"}');
    }).listen(port, () => console.log(`🌐 Issuer API en puerto ${port}`));
  }
}

// ── Shutdown ordenado ───────────────────────────────────────────────────────
// pm2 manda SIGINT al reiniciar: volcamos el estado pendiente a disco y cerramos
// las suscripciones para no perder watermarks ni marcas de procesado.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`\n${sig} recibido — guardando estado…`);
    try {
      flushSync();
      closeManagedSubscriptions();
      releaseProcessLock();
    } catch (e) {
      console.error("error en shutdown:", e);
    }
    process.exit(0);
  });
}

main();
