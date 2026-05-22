/**
 * Build the province-wide Ontario schools dataset for school-aware listing search.
 *
 * Source: Ontario "School Information and Student Demographics" (SIF) data table on
 * data.ontario.ca — Open Government Licence – Ontario (commercial use OK, attribution
 * required). The single XLSX already contains Latitude/Longitude AND EQAO results, so
 * NO geocoding is needed.
 *
 * NOTE: the latest *finalized* SIF release suppresses most EQAO results; the latest
 * *preliminary* release carries full EQAO coverage (~4.3k rated schools). We use the
 * preliminary file deliberately for that reason.
 *
 * Output: data/ontario-schools.json — [{ id, name, level, system, language, lat, lng,
 *   score, address }]. `score` is a deterministic 0–10 "PureProperty School Score"
 *   derived from EQAO % at provincial standard (hardcoded math, no AI — CLAUDE.md §4).
 *   `score` is null when a school has no EQAO results; such schools are kept for the
 *   target-school search but excluded from nearest-RATED-school scoring downstream.
 *
 * Usage:
 *   npx.cmd tsx scripts/admin/build-schools-dataset.ts            # use cached XLSX if present
 *   npx.cmd tsx scripts/admin/build-schools-dataset.ts --refresh  # force re-download source
 */
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

// "Preliminary 2025-2026" resource (latest; full EQAO coverage). OGL-Ontario.
const SOURCE_URL =
  'https://data.ontario.ca/dataset/d85f68c5-fcb0-4b4d-aec5-3047db47dcd5/resource/1e604bf9-49c5-49a1-a8b7-297147c771d0/download/new_sif_data_table_2024_25prelim_en_april2026.xlsx';
const CACHE_DIR = path.join(process.cwd(), '.cache', 'schools');
const CACHE_FILE = path.join(CACHE_DIR, 'sif_latest.xlsx');
const OUT_FILE = path.join(process.cwd(), 'data', 'ontario-schools.json');
const REFRESH = process.argv.includes('--refresh');

// EQAO achievement columns (exact SIF header names; values are fractions 0–1 = % at
// the provincial standard). The "Change ... Over Three Years" delta columns are ignored.
const ELEM_COLS = [
  'Percentage of Grade 3 Students Achieving the Provincial Standard in Reading',
  'Percentage of Grade 3 Students Achieving the Provincial Standard in Writing',
  'Percentage of Grade 3 Students Achieving the Provincial Standard in Mathematics',
  'Percentage of Grade 6 Students Achieving the Provincial Standard in Reading',
  'Percentage of Grade 6 Students Achieving the Provincial Standard in Writing',
  'Percentage of Grade 6 Students Achieving the Provincial Standard in Mathematics',
];
const SEC_COLS = [
  'Percentage of Grade 9 Students Achieving the Provincial Standard in Mathematics',
  'Percentage of Students That Passed the Grade 10 OSSLT on Their First Attempt',
];

// "NA" / "N/D" / "N/R" / blank -> null; numeric strings -> number.
const numOrNull = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// Deterministic 0–10 score = mean of available EQAO % at standard, ×10. null if none.
function computeScore(row: Record<string, any>, cols: string[]): number | null {
  const vals = cols.map((c) => numOrNull(row[c])).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length; // 0–1
  return Math.round(mean * 10 * 100) / 100; // 0–10, 2 decimals
}

async function ensureSource() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CACHE_FILE) && !REFRESH) {
    console.log(`Using cached source: ${path.relative(process.cwd(), CACHE_FILE)}`);
    return;
  }
  console.log('Downloading Ontario SIF source (OGL-Ontario)...');
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(CACHE_FILE, buf);
  console.log(`Saved ${(buf.length / 1024 / 1024).toFixed(1)} MB → ${path.relative(process.cwd(), CACHE_FILE)}`);
}

async function main() {
  await ensureSource();
  const wb = XLSX.readFile(CACHE_FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: null });
  console.log(`Parsed ${rows.length} rows from sheet "${wb.SheetNames[0]}"`);

  const SYSTEM: Record<string, 'public' | 'catholic'> = { Public: 'public', Catholic: 'catholic' };
  const LEVEL: Record<string, 'elementary' | 'secondary'> = { Elementary: 'elementary', Secondary: 'secondary' };

  type School = {
    id: string;
    name: string;
    level: 'elementary' | 'secondary';
    system: 'public' | 'catholic';
    language: string;
    lat: number;
    lng: number;
    score: number | null;
    address: string;
  };

  const out: School[] = [];
  let skippedType = 0;
  let skippedGeo = 0;
  let rated = 0;

  for (const r of rows) {
    const system = SYSTEM[String(r['School Type'] ?? '').trim()];
    const level = LEVEL[String(r['School Level'] ?? '').trim()];
    if (!system || !level) {
      skippedType++; // Provincial / Hospital / Protestant Separate / unknown
      continue;
    }
    const lat = numOrNull(r['Latitude']);
    const lng = numOrNull(r['Longitude']);
    if (lat === null || lng === null) {
      skippedGeo++;
      continue;
    }
    const score = computeScore(r, level === 'elementary' ? ELEM_COLS : SEC_COLS);
    if (score !== null) rated++;

    const street = String(r['Street'] ?? '').trim();
    const city = String(r['City'] ?? '').trim();
    const postal = String(r['Postal Code'] ?? '').trim();

    out.push({
      id: `${String(r['Board Number'] ?? '').trim()}-${String(r['School Number'] ?? '').trim()}`,
      name: String(r['School Name'] ?? '').trim(),
      level,
      system,
      language: String(r['School Language'] ?? '').trim() || 'English',
      lat,
      lng,
      score,
      address: [street, city, postal].filter(Boolean).join(', '),
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out));

  // Summary by panel.
  const byPanel = new Map<string, { n: number; rated: number; sum: number }>();
  for (const s of out) {
    const k = `${s.level}/${s.system}`;
    const e = byPanel.get(k) || { n: 0, rated: 0, sum: 0 };
    e.n++;
    if (s.score !== null) {
      e.rated++;
      e.sum += s.score;
    }
    byPanel.set(k, e);
  }

  console.log(`\nWrote ${out.length} schools → data/ontario-schools.json`);
  console.log(`  skipped (non public/catholic): ${skippedType}, skipped (no geo): ${skippedGeo}`);
  console.log(`  rated (EQAO score present): ${rated}`);
  for (const [k, e] of [...byPanel.entries()].sort()) {
    console.log(`  ${k.padEnd(22)} ${String(e.n).padStart(4)} schools | ${String(e.rated).padStart(4)} rated | avg ${(e.rated ? e.sum / e.rated : 0).toFixed(2)}`);
  }
}

main().catch((e) => {
  console.error('❌', e?.message || e);
  process.exit(1);
});
