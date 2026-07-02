/**
 * theme-light-polish — second Phase-2 pass to make LIGHT mode a first-class view.
 *
 * Two transforms (skips git-dirty files so WIP is never touched):
 *   1. Solid cards:  bg-card/50 -> bg-card, bg-popover/50 -> bg-popover
 *      (translucent surfaces are a dark-mode habit; on white they read washed out,
 *      and elevation shadows need a solid fill to look right).
 *   2. Vivid accents: accent TEXT `text-<accent>-400|500` -> `text-<accent>-600`
 *      with a `dark:` variant preserving the original shade — so accents are legible/
 *      saturated on white but UNCHANGED in dark. Variant prefixes (hover:, md:, …)
 *      are carried onto the dark: variant. Already-`dark:`-scoped classes are skipped.
 *
 * Usage: node scripts/theme-light-polish.mjs [--dry] <dir> [<dir> ...]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const dirs = args.filter((a) => a !== "--dry");
if (!dirs.length) { console.error("usage: node scripts/theme-light-polish.mjs [--dry] <dir>..."); process.exit(1); }

const ACCENTS = "emerald|amber|rose|sky|blue|violet|orange|red|green|cyan|teal|indigo|purple|fuchsia|lime|pink";
const accentRe = new RegExp(`(?<![\\w:-])((?:[a-z0-9-]+:)*)text-(${ACCENTS})-(400|500)\\b`, "g");

function transform(src) {
  let hits = 0;
  let out = src
    .replace(/\bbg-card\/50\b/g, () => (hits++, "bg-card"))
    .replace(/\bbg-popover\/50\b/g, () => (hits++, "bg-popover"));
  out = out.replace(accentRe, (m, prefix, color, shade) => {
    if (/\bdark:/.test(prefix)) return m;          // already dark-scoped
    hits++;
    return `${prefix}text-${color}-600 dark:${prefix}text-${color}-${shade}`;
  });
  return { out, hits };
}

const dirty = new Set(
  execSync("git status --porcelain", { encoding: "utf8" })
    .split("\n").map((l) => l.slice(3).trim()).filter(Boolean)
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

let files = 0, total = 0;
for (const dir of dirs) {
  const entries = fs.statSync(dir).isDirectory() ? walk(dir) : [dir];
  for (const file of entries) {
    const rel = file.replace(/\\/g, "/");
    if (dirty.has(rel)) { console.log(`  SKIP (WIP): ${rel}`); continue; }
    const src = fs.readFileSync(file, "utf8");
    const { out, hits } = transform(src);
    if (hits > 0) {
      files++; total += hits;
      console.log(`  ${String(hits).padStart(3)}  ${rel}`);
      if (!dry) fs.writeFileSync(file, out);
    }
  }
}
console.log(`\n${dry ? "[dry] " : ""}${total} edits across ${files} files`);
