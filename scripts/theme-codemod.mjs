/**
 * theme-codemod — Phase 2 light/dark migration helper.
 *
 * Rewrites the SAFE, context-independent hardcoded `slate-*` Tailwind utilities to
 * semantic tokens (see LIGHT_DARK_THEME_PLAN_2026-07-01.md) across a target directory.
 * Behaviorally invisible in dark (tokens resolve to the same values); enables light.
 *
 * Deliberately does NOT touch:
 *   - semantic accent colors (cyan/emerald/amber/rose/violet/sky/blue/orange) — reviewed by hand
 *   - hardcoded hex in charts/SVG — handled in a dedicated chart wave
 *   - git-dirty files — so in-progress WIP is never entangled
 *   - the terminal (pass only consumer dirs; the terminal stays dark by design)
 *
 * Usage:  node scripts/theme-codemod.mjs <dir> [<dir> ...]
 *         node scripts/theme-codemod.mjs --dry <dir>      # report only, no writes
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const dirs = args.filter((a) => a !== "--dry");
if (dirs.length === 0) {
  console.error("usage: node scripts/theme-codemod.mjs [--dry] <dir> [<dir> ...]");
  process.exit(1);
}

// Word-boundary anchored so `text-slate-50` never matches inside `text-slate-500`,
// and opacity suffixes (`/50`) + variant prefixes (`hover:`, `md:`) are preserved.
const MAP = [
  [/\bbg-slate-950\b/g, "bg-background"],
  [/\bbg-slate-900\b/g, "bg-card"],
  [/\bbg-slate-800\b/g, "bg-muted"],
  [/\bbg-slate-700\b/g, "bg-muted"],
  [/\btext-slate-(?:50|100|200|300)\b/g, "text-foreground"],
  [/\btext-slate-(?:400|500|600|700)\b/g, "text-muted-foreground"],
  [/\bborder-slate-(?:600|700|800|900)\b/g, "border-border"],
  [/\bdivide-slate-(?:700|800|900)\b/g, "divide-border"],
  [/\bring-slate-(?:700|800|900)\b/g, "ring-border"],
];

const dirty = new Set(
  execSync("git status --porcelain", { encoding: "utf8" })
    .split("\n")
    .map((l) => l.slice(3).trim())
    .filter(Boolean)
);

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

let totalFiles = 0;
let totalHits = 0;
for (const dir of dirs) {
  for (const file of walk(dir)) {
    const rel = file.replace(/\\/g, "/");
    if (dirty.has(rel)) {
      console.log(`  SKIP (WIP): ${rel}`);
      continue;
    }
    const src = fs.readFileSync(file, "utf8");
    let out = src;
    let hits = 0;
    for (const [re, to] of MAP) {
      out = out.replace(re, () => {
        hits++;
        return to;
      });
    }
    if (hits > 0) {
      totalFiles++;
      totalHits += hits;
      console.log(`  ${hits.toString().padStart(3)}  ${rel}`);
      if (!dry) fs.writeFileSync(file, out);
    }
  }
}
console.log(`\n${dry ? "[dry] " : ""}${totalHits} replacements across ${totalFiles} files`);
