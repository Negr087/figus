#!/usr/bin/env node
// Convierte las imágenes de ./public a WebP para reducir el tráfico de Vercel.
// Hace backup de cada original en ./public/backup/<misma-ruta-relativa> antes
// de borrarlo, y reescribe las referencias .jpg/.jpeg/.png a .webp en el código
// fuente (src/, app/, components/, pages/ — los que existan en el repo).
//
// Uso:
//   node scripts/optimize-images.mjs           # convierte y borra originales
//   node scripts/optimize-images.mjs --dry-run # solo genera los .webp, no toca originales ni código
import { readdir, stat, mkdir, copyFile, unlink, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const BACKUP_DIR = path.join(PUBLIC_DIR, "backup");
const DRY_RUN = process.argv.includes("--dry-run");

// ─── Reglas de conversión por categoría ───────────────────────────────────────
// `box`: redimensiona para entrar en un cuadro de NxN (sin agrandar imágenes chicas).
// `maxWidth`: limita solo el ancho, alto proporcional (sin agrandar).
// Sin ninguna de las dos: no redimensiona, solo recodifica a WebP.
const RULES = [
  {
    name: "faces",
    quality: 70,
    box: 150,
    test: (rel) => rel.startsWith("faces/") && /\.jpe?g$/i.test(rel),
  },
  {
    name: "fwc",
    quality: 80,
    maxWidth: 600,
    test: (rel) => /^fwc-\d+\.png$/i.test(rel),
  },
  {
    name: "shield",
    quality: 85,
    box: 200,
    test: (rel) => /^shield-.*\.png$/i.test(rel),
  },
  {
    name: "ostrich",
    quality: 80,
    box: 400,
    test: (rel) => /^ostrich.*\.(png|jpe?g)$/i.test(rel),
  },
  {
    name: "squad",
    quality: 80,
    box: 500,
    test: (rel) => /^squad(-.*)?\.png$/i.test(rel),
  },
  {
    name: "logo",
    quality: 90,
    box: 400,
    test: (rel) => /^logomundial\.png$/i.test(rel),
  },
  {
    name: "other-png",
    quality: 80,
    test: (rel) => ["muestra.png", "screenshot.png", "nwc-logo.png"].includes(rel),
  },
];

function matchRule(rel) {
  return RULES.find((r) => r.test(rel)) ?? null;
}

// ─── Recorrido recursivo de ./public, saltando backup/ y archivos no-imagen ──
async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (abs === BACKUP_DIR) continue;
      await walk(abs, base, out);
    } else {
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  }
  return out;
}

async function convertOne(rel, rule) {
  const inputPath = path.join(PUBLIC_DIR, rel);
  const parsed = path.parse(rel);
  const outRel = path.join(parsed.dir, `${parsed.name}.webp`).split(path.sep).join("/");
  const outputPath = path.join(PUBLIC_DIR, outRel);

  const before = (await stat(inputPath)).size;

  let img = sharp(inputPath);
  if (rule.box) {
    img = img.resize({ width: rule.box, height: rule.box, fit: "inside", withoutEnlargement: true });
  } else if (rule.maxWidth) {
    img = img.resize({ width: rule.maxWidth, withoutEnlargement: true });
  }
  await img.webp({ quality: rule.quality }).toFile(outputPath);

  const after = (await stat(outputPath)).size;

  if (!DRY_RUN) {
    const backupPath = path.join(BACKUP_DIR, rel);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(inputPath, backupPath);
    await unlink(inputPath);
  }

  return { rel, outRel, before, after };
}

// ─── Reescritura de referencias en el código fuente ──────────────────────────
// Cada patrón exige el prefijo de ruta de la categoría (faces/, squad, shield-,
// ostrich, logomundial, fwc-N, o el nombre exacto de los PNGs sueltos) para no
// tocar extensiones .png/.jpg ajenas a estos assets (p. ej. flagcdn.com/...png).
const CODE_REPLACEMENTS = [
  { re: /(\/faces\/[^'"`]*?)\.jpe?g/g, to: "$1.webp" },
  { re: /(\/squad(?:-[^'"`]*?)?)\.png/g, to: "$1.webp" },
  { re: /(\/shield-[^'"`]*?)\.png/g, to: "$1.webp" },
  { re: /(\/ostrich[^'"`]*?)\.(?:png|jpe?g)/g, to: "$1.webp" },
  { re: /(\/logomundial)\.png/g, to: "$1.webp" },
  { re: /(\/fwc-\d+)\.png/g, to: "$1.webp" },
  { re: /(\/(?:muestra|screenshot|nwc-logo))\.png/g, to: "$1.webp" },
];

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const CODE_ROOT_DIRS = ["src", "app", "components", "pages"].filter((d) =>
  existsSync(path.join(ROOT, d))
);

async function walkCode(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      await walkCode(abs, out);
    } else if (CODE_EXTS.has(path.extname(entry.name))) {
      out.push(abs);
    }
  }
  return out;
}

async function updateCodeReferences() {
  let filesChanged = 0;
  let totalReplacements = 0;
  for (const dir of CODE_ROOT_DIRS) {
    for (const file of await walkCode(path.join(ROOT, dir))) {
      const original = await readFile(file, "utf-8");
      let updated = original;
      let fileReplacements = 0;
      for (const { re, to } of CODE_REPLACEMENTS) {
        const matches = updated.match(re);
        if (matches) fileReplacements += matches.length;
        updated = updated.replace(re, to);
      }
      if (updated !== original) {
        filesChanged++;
        totalReplacements += fileReplacements;
        console.log(`   📝 ${path.relative(ROOT, file)} (${fileReplacements} referencia${fileReplacements === 1 ? "" : "s"})`);
        if (!DRY_RUN) await writeFile(file, updated, "utf-8");
      }
    }
  }
  return { filesChanged, totalReplacements };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function main() {
  console.log(`⚡ Optimizando imágenes en ./public${DRY_RUN ? " (dry-run, no se borra ni edita nada)" : ""}`);

  const allFiles = await walk(PUBLIC_DIR);
  const targets = [];
  for (const rel of allFiles) {
    if (rel.endsWith(".webp")) continue; // ya convertido
    const rule = matchRule(rel);
    if (rule) targets.push({ rel, rule });
  }

  console.log(`   ${targets.length} archivo(s) para convertir\n`);

  const byCategory = new Map();
  let totalBefore = 0;
  let totalAfter = 0;

  for (const { rel, rule } of targets) {
    try {
      const { outRel, before, after } = await convertOne(rel, rule);
      totalBefore += before;
      totalAfter += after;
      const cat = byCategory.get(rule.name) ?? { count: 0, before: 0, after: 0 };
      cat.count++;
      cat.before += before;
      cat.after += after;
      byCategory.set(rule.name, cat);
      console.log(`   ✅ ${rel} → ${outRel} (${fmtMB(before)}MB → ${fmtMB(after)}MB)`);
    } catch (e) {
      console.error(`   ⚠️ falló ${rel}:`, e.message);
    }
  }

  console.log(`\n📂 Actualizando referencias en el código (${CODE_ROOT_DIRS.join(", ")})…`);
  const { filesChanged, totalReplacements } = await updateCodeReferences();

  console.log("\n── Resumen por categoría ──────────────────────────────");
  for (const [name, c] of byCategory) {
    console.log(`   ${name.padEnd(10)} ${String(c.count).padStart(4)} archivos   ${fmtMB(c.before).padStart(8)}MB → ${fmtMB(c.after).padStart(8)}MB`);
  }

  const savedMB = fmtMB(totalBefore - totalAfter);
  const pct = totalBefore > 0 ? ((1 - totalAfter / totalBefore) * 100).toFixed(1) : "0.0";

  console.log("\n── Resumen total ──────────────────────────────────────");
  console.log(`   Antes:   ${fmtMB(totalBefore)} MB`);
  console.log(`   Después: ${fmtMB(totalAfter)} MB`);
  console.log(`   Ahorro:  ${savedMB} MB (${pct}%)`);
  console.log(`   Código:  ${filesChanged} archivo(s), ${totalReplacements} referencia(s) actualizada(s)`);
  if (!DRY_RUN) console.log(`   Backups: ${path.relative(ROOT, BACKUP_DIR)}/`);
}

main().catch((e) => {
  console.error("💥", e);
  process.exit(1);
});
