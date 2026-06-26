// RECUPERACIÓN MANUAL — reconstruye la tenencia "verdadera" de un usuario a
// partir del historial de eventos GRANT (1573, qué tocó en cada sobre) y
// SETTLEMENT (1574, cada transferencia con from/to/sticker) publicados por el
// issuer, y la compara contra el cache local (data/ownership.json).
//
// Sirve para detectar/corregir la pérdida de figuritas causada por la carrera
// en bump() (dos operaciones concurrentes sobre la misma figu pisándose entre
// sí, ya arreglada con el lock en index.ts) — GRANT/SETTLEMENT son eventos
// regulares (no reemplazables como el 30100), así que los relays deberían
// conservarlos íntegros mientras no los hayan purgado.
//
// Por defecto es de SOLO LECTURA (dry-run): solo imprime las diferencias.
// Pasá --apply para corregir el cache local y publicar el 30100 corregido.
//
// IMPORTANTE: corré esto con el issuer (`npm run issuer`) DETENIDO. El cache
// vive en memoria de cada proceso y se vuelca completo en cada flush — si el
// issuer sigue corriendo, su propio flush puede pisar la corrección que este
// script escribe a disco.
//
// Uso:
//   npx tsx issuer/reconcile-ownership.ts <pubkey>            (dry-run)
//   npx tsx issuer/reconcile-ownership.ts <pubkey> --apply    (corrige)
import fs from "fs";
import path from "path";
import type { Event } from "nostr-tools";
import { pool, RELAYS, ALBUM_ID, issuerPubkey, publish, now, tag } from "./lib";
import { getOwnershipForPubkey, setCachedOwnership, flushSync } from "./store";

const LOCK_PATH = path.join(process.cwd(), "data", "issuer.lock");

function refuseIfIssuerRunning(): void {
  if (!fs.existsSync(LOCK_PATH)) return;
  const pid = Number(fs.readFileSync(LOCK_PATH, "utf-8"));
  try {
    if (pid > 0) {
      process.kill(pid, 0); // señal 0: solo chequea existencia, no mata nada
      console.error(
        `❌ El issuer está corriendo (pid ${pid}). Detenelo antes de aplicar una ` +
        `corrección — su próximo flush puede pisarla. (dry-run sigue siendo seguro)`
      );
      if (process.argv.includes("--apply")) process.exit(1);
    }
  } catch {
    /* ESRCH: lock huérfano, no hay issuer corriendo */
  }
}

// Pagina hacia atrás con `until` hasta que una vuelta no traiga eventos
// nuevos: los relays imponen un límite por consulta (varía según relay, pero
// suele rondar 500-1000) y sin esto una cuenta activa con cientos de eventos
// se trunca en silencio — el filtro original solo veía "los últimos N", no
// todo el historial, lo que arruina el conteo reconstruido.
async function listAll(filter: Record<string, unknown>): Promise<Event[]> {
  const byId = new Map<string, Event>();
  let until: number | undefined;
  for (let page = 0; page < 200; page++) {
    const pageFilter = { ...filter, limit: 500, ...(until ? { until } : {}) };
    const evs = await pool.querySync(RELAYS, pageFilter as any, { maxWait: 5000 });
    let added = 0;
    let oldest = until;
    for (const ev of evs) {
      if (!byId.has(ev.id)) { byId.set(ev.id, ev); added++; }
      if (oldest === undefined || ev.created_at < oldest) oldest = ev.created_at;
    }
    if (added === 0 || oldest === undefined) break; // no avanzó: se acabó el historial
    until = oldest - 1; // próxima página: estrictamente más vieja, evita repetir el borde
  }
  return [...byId.values()];
}

async function main() {
  const pubkey = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!pubkey || !/^[a-f0-9]{64}$/.test(pubkey)) {
    console.error("Uso: npx tsx issuer/reconcile-ownership.ts <pubkey-hex> [--apply]");
    process.exit(1);
  }

  refuseIfIssuerRunning();

  const ISSUER = issuerPubkey();
  console.log(`🔍 Reconciliando ${pubkey.slice(0, 12)}… contra GRANT/SETTLEMENT en relays`);
  console.log(`   relays: ${RELAYS.join(", ")}`);

  const [grants, settlements] = await Promise.all([
    listAll({ kinds: [1573], authors: [ISSUER], "#p": [pubkey] }),
    // SETTLEMENT de venta P2P no lleva tag "p" del vendedor (solo from/to en
    // el body) — hay que traer todos los del issuer y filtrar from/to a mano.
    listAll({ kinds: [1574], authors: [ISSUER] }),
  ]);
  console.log(`   ${grants.length} eventos GRANT, ${settlements.length} eventos SETTLEMENT (total issuer)`);

  const expected = new Map<number, number>();
  const bumpExpected = (num: number, delta: number) =>
    expected.set(num, (expected.get(num) ?? 0) + delta);

  for (const ev of grants) {
    for (const t of ev.tags) {
      if (t[0] !== "sticker") continue;
      const num = Number(t[1].split(":")[1]);
      if (Number.isFinite(num)) bumpExpected(num, 1);
    }
  }

  let touchedSettlements = 0;
  for (const ev of settlements) {
    const from = tag(ev, "from");
    const to = tag(ev, "to");
    const sticker = tag(ev, "sticker");
    if (!sticker || (from !== pubkey && to !== pubkey)) continue;
    const num = Number(sticker.split(":")[1]);
    if (!Number.isFinite(num)) continue;
    touchedSettlements++;
    if (from === pubkey) bumpExpected(num, -1);
    if (to === pubkey) bumpExpected(num, 1);
  }
  console.log(`   ${touchedSettlements} settlements involucran a este usuario`);

  const current = getOwnershipForPubkey(pubkey);
  const allNums = new Set<number>([...expected.keys(), ...Object.keys(current).map(Number)]);

  type Row = { num: number; expected: number; current: number; delta: number };
  const rows: Row[] = [];
  for (const num of [...allNums].sort((a, b) => a - b)) {
    const exp = Math.max(0, expected.get(num) ?? 0);
    const cur = current[num] ?? 0;
    if (exp !== cur) rows.push({ num, expected: exp, current: cur, delta: exp - cur });
  }

  if (rows.length === 0) {
    console.log("✅ Sin discrepancias — el cache coincide con el historial reconstruido.");
    return;
  }

  console.log("\n⚠️  Discrepancias encontradas:");
  console.log("   figu | cache actual | esperado (historial) | delta");
  for (const r of rows) {
    console.log(`   #${r.num}`.padEnd(8) + `| ${r.current}`.padEnd(15) + `| ${r.expected}`.padEnd(23) + `| ${r.delta > 0 ? "+" : ""}${r.delta}`);
  }

  if (!apply) {
    console.log("\nℹ️  Dry-run — no se modificó nada. Volvé a correr con --apply para corregir.");
    return;
  }

  console.log("\n✍️  Aplicando corrección…");
  for (const r of rows) {
    setCachedOwnership(`${pubkey}:${r.num}`, r.expected);
    await publish({
      kind: 30100,
      created_at: now(),
      content: "",
      tags: [
        ["d", `${pubkey}:${ALBUM_ID}:${r.num}`],
        ["p", pubkey],
        ["sticker", `${ALBUM_ID}:${r.num}`],
        ["count", String(r.expected)],
        ["pasted", r.expected > 0 ? "true" : "false"],
        ["reconcile", "true"], // marca que este 30100 vino de una corrección manual
      ],
    });
    console.log(`   #${r.num}: ${r.current} → ${r.expected}`);
  }
  flushSync();
  console.log("✅ Corrección aplicada y persistida en data/ownership.json + relays.");
}

main()
  .catch(e => { console.error("💥", e); process.exitCode = 1; })
  .finally(() => pool.close(RELAYS));
