/**
 * Generates the installable-app icons from the same chevron mark as src/app/icon.svg.
 *
 *   npx tsx scripts/admin/generatePwaIcons.ts
 *
 * Writes public/icons/icon-192.png, icon-512.png, icon-512-maskable.png and
 * src/app/apple-icon.png (Next emits <link rel="apple-touch-icon"> for that one — iOS
 * ignores manifest icons). Re-run only when the mark changes; the PNGs are committed.
 * Run from the repo root.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const NAVY = "#0A1828";
const ROOT = process.cwd();

interface MarkOpts {
  /** Drop the rounded corners: the launcher (or iOS) applies its own mask. */
  bleed: boolean;
  /** Shrink the chevron about the centre; maskable icons keep content in the central 80%. */
  scale: number;
}

/** The favicon's chevron on a navy square, in the favicon's own 32-unit coordinate space. */
function markSvg(size: number, { bleed, scale }: MarkOpts): string {
  const rx = bleed ? 0 : 6;
  const t = `translate(16 16) scale(${scale}) translate(-16 -16)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="${rx}" fill="${NAVY}"/>
  <polyline transform="${t}" points="20,7 11,16 20,25" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

async function write(file: string, size: number, opts: MarkOpts): Promise<void> {
  const png = await sharp(Buffer.from(markSvg(size, opts))).png().toBuffer();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`wrote ${path.relative(ROOT, file)} (${size}px, ${png.length} bytes)`);
}

async function main(): Promise<void> {
  const icons = path.join(ROOT, "public", "icons");
  await write(path.join(icons, "icon-192.png"), 192, { bleed: false, scale: 1 });
  await write(path.join(icons, "icon-512.png"), 512, { bleed: false, scale: 1 });
  await write(path.join(icons, "icon-512-maskable.png"), 512, { bleed: true, scale: 0.72 });
  await write(path.join(ROOT, "src", "app", "apple-icon.png"), 180, { bleed: true, scale: 0.9 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
