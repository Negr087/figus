// ORQUESTADOR DE TESTS — un solo comando (`npm test`) para que un jurado (o
// cualquiera clonando el repo) pueda verificar el flujo de pagos del issuer
// SIN tocar Lightning real y sin levantar nada a mano en otra terminal.
//
// Genera un issuer y un relay de prueba efímeros (cwd aislado en un dir
// temporal — nunca toca tu `data/` real ni un issuer que ya tengas corriendo),
// corre los tests de integración existentes contra ellos, y apaga todo al
// terminar. Reusa los scripts de issuer/test/ tal cual están — no duplica
// lógica de testeo, solo las orquesta.
//
// Uso: npm test   (o  npx tsx issuer/test/run-all.ts)
import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { generateSecretKey, getPublicKey, nip19 } from "nostr-tools";

const ROOT = path.join(__dirname, "..", "..");
const TSX = path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const RELAY_PORT = Number(process.env.RELAY_PORT_TEST || "7799");
const RELAYS = `ws://localhost:${RELAY_PORT}`;

const sk = generateSecretKey();
const ISSUER_NSEC = nip19.nsecEncode(sk);
const ISSUER_PK = getPublicKey(sk);

// data/ del issuer de test va a un tmp dir — jamás pisa tu data/ real.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "figus-test-"));

const baseEnv = {
  ...process.env,
  NEXT_PUBLIC_RELAYS: RELAYS,
  NEXT_PUBLIC_ISSUER_PUBKEY: ISSUER_PK,
  NEXT_PUBLIC_ALBUM_ID: "test-album",
  ISSUER_NSEC,
  ISSUER_HTTP_PORT: "0", // HTTP API apagada — no la necesitan estos tests
};

function waitForLog(child: ChildProcessWithoutNullStreams, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const onData = (buf: Buffer) => { if (buf.toString().includes(needle)) finish(); };
    child.stdout.on("data", onData);
    setTimeout(finish, timeoutMs); // no bloquear para siempre si el log no aparece
  });
}

function spawnLong(script: string, env: NodeJS.ProcessEnv, cwd = ROOT): ChildProcessWithoutNullStreams {
  // El script siempre se referencia con ruta ABSOLUTA: cwd se usa solo para
  // aislar los archivos data/*.json del issuer (process.cwd() en store.ts),
  // no para resolver el módulo — si no, tsx no lo encuentra al cambiar cwd.
  const abs = path.join(ROOT, script);
  const child = spawn(TSX, [abs], { cwd, env }) as ChildProcessWithoutNullStreams;
  const label = path.basename(script);
  child.stdout.on("data", (b) => process.stdout.write(`   [${label}] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`   [${label}] ${b}`));
  return child;
}

function runOnce(script: string, env: NodeJS.ProcessEnv): Promise<{ name: string; pass: boolean }> {
  const name = path.basename(script, ".ts");
  return new Promise((resolve) => {
    const child = spawn(TSX, [script], { cwd: ROOT, env });
    let out = "";
    child.stdout.on("data", (b) => { out += b; process.stdout.write(`   [${name}] ${b}`); });
    child.stderr.on("data", (b) => { out += b; process.stderr.write(`   [${name}] ${b}`); });
    child.on("close", (code) => resolve({ name, pass: code === 0 }));
  });
}

async function main() {
  console.log(`🧪 Suite de tests Figus — issuer + relay efímeros (pubkey ${ISSUER_PK.slice(0, 12)}…, data en ${dataDir})\n`);

  console.log("🛰️  Levantando relay de test…");
  const relay = spawnLong("issuer/test/relay.ts", { ...baseEnv, RELAY_PORT: String(RELAY_PORT) });
  await waitForLog(relay, "escuchando", 5_000);

  const results: { name: string; pass: boolean }[] = [];

  console.log("\n⚡ Levantando issuer (modo mock)…");
  let issuer = spawnLong("issuer/index.ts", { ...baseEnv, ISSUER_PAYMENTS: "mock", ORDER_POLL_MS: "2000" }, dataDir);
  await waitForLog(issuer, "Issuer listo", 10_000);

  console.log("\n▶️  test:order — camino feliz (compra de sobre)");
  results.push(await runOnce("issuer/test/order-flow.ts", baseEnv));

  console.log("\n▶️  test:forge — exploit con zap receipt forjado (debe bloquearse)");
  results.push(await runOnce("issuer/test/forge-attack.ts", baseEnv));

  issuer.kill();

  console.log("\n⚡ Reiniciando issuer con lookup lento (test de re-entrada del poller)…");
  issuer = spawnLong(
    "issuer/index.ts",
    { ...baseEnv, ISSUER_PAYMENTS: "mock", ORDER_POLL_MS: "3000", MOCK_LOOKUP_DELAY_MS: "9000" },
    dataDir,
  );
  await waitForLog(issuer, "Issuer listo", 10_000);

  console.log("\n▶️  test:race — doble concesión por re-entrada (debe dar exactamente 1 GRANT)");
  results.push(await runOnce("issuer/test/double-grant.ts", baseEnv));

  issuer.kill();
  relay.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });

  console.log("\n" + "─".repeat(50));
  console.log("📋 Resultado final:");
  for (const r of results) console.log(`   ${r.pass ? "✅" : "❌"} ${r.name}`);
  const allPass = results.every((r) => r.pass);
  console.log(allPass ? "\n✅ TODO PASS" : "\n❌ HAY FALLAS");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error("💥", e); process.exit(1); });
