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
//   npx tsx issuer/reconcile-ownership.ts <pubkey>                  (dry-run)
//   npx tsx issuer/reconcile-ownership.ts <pubkey> --apply          (corrige)
//   npx tsx issuer/reconcile-ownership.ts <pubkey> --explain=<num>  (timeline de una figu puntual, para auditar a mano)
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

  const explainArg = process.argv.find(a => a.startsWith("--explain="));
  if (explainArg) {
    const explainNum = Number(explainArg.slice("--explain=".length));
    type TimelineEntry = { ts: number; line: string; delta: number };
    const timeline: TimelineEntry[] = [];
    for (const ev of grants) {
      const copies = ev.tags.filter(t => t[0] === "sticker" && Number(t[1].split(":")[1]) === explainNum).length;
      if (copies > 0) timeline.push({ ts: ev.created_at, line: `GRANT  ${ev.id.slice(0, 10)}… +${copies}`, delta: copies });
    }
    for (const ev of settlements) {
      const from = tag(ev, "from"), to = tag(ev, "to"), sticker = tag(ev, "sticker");
      if (!sticker || Number(sticker.split(":")[1]) !== explainNum) continue;
      if (from !== pubkey && to !== pubkey) continue;
      const action = tag(ev, "figus-action") ?? "buy-sticker";
      if (from === pubkey) timeline.push({ ts: ev.created_at, line: `SETTLE ${ev.id.slice(0, 10)}… (${action}) -1 → ${to?.slice(0, 10)}…`, delta: -1 });
      if (to === pubkey) timeline.push({ ts: ev.created_at, line: `SETTLE ${ev.id.slice(0, 10)}… (${action}) +1 ← ${from?.slice(0, 10)}…`, delta: +1 });
    }
    timeline.sort((a, b) => a.ts - b.ts);
    console.log(`\n📜 Timeline figu #${explainNum} para ${pubkey.slice(0, 12)}…`);
    let running = 0;
    for (const t of timeline) {
      running += t.delta;
      console.log(`   ${new Date(t.ts * 1000).toISOString()}  ${t.line}  (running: ${running})`);
    }
    console.log(`   total reconstruido: ${Math.max(0, running)} · cache actual: ${getOwnershipForPubkey(pubkey)[explainNum] ?? 0}`);
    return;
  }

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

  // Solo se devuelven figuritas (delta > 0: el cache tiene MENOS de lo que el
  // historial prueba que le tocó y nunca vendió/perdió). Los delta < 0 son
  // casos donde el cache tiene MÁS de lo reconstruido — restar stock ahí
  // depende de que la reconstrucción esté 100% completa (si un relay perdió
  // un GRANT viejo, parece "exceso" sin serlo), así que requieren revisión
  // manual con --explain=<num> antes de tocarlos; no se aplican automático.
  const gains = rows.filter(r => r.delta > 0);
  const excess = rows.filter(r => r.delta < 0);
  if (excess.length > 0) {
    console.log(`\nℹ️  ${excess.length} figus con cache por ENCIMA del historial reconstruido — no se tocan automáticamente (revisar con --explain=<num>):`);
    console.log(`   ${excess.map(r => `#${r.num} (${r.delta})`).join(", ")}`);
  }

  if (!apply) {
    console.log(`\nℹ️  Dry-run — no se modificó nada. Volvé a correr con --apply para devolver las ${gains.length} figus de delta positivo.`);
    return;
  }
  if (gains.length === 0) {
    console.log("\nℹ️  No hay figus para devolver (todas las discrepancias son de exceso, requieren revisión manual).");
    return;
  }

  console.log(`\n✍️  Devolviendo ${gains.length} figus de delta positivo…`);
  for (const r of gains) {
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
