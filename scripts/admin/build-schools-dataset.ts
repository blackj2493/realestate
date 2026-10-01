/**
 * Build the province-wide Ontario schools dataset for school-aware listing search.
 *
 * Source: Ontario "School Information and Student Demographics" (SIF) data table on
 * data.ontario.ca — Open Government Licence – Ontario (commercial use OK, attribution
 * required). The single XLSX already contains Latitude/Longitude AND EQAO results, so
 * NO geocoding is needed.
 *
 * SOURCE DISCOVERY: the file is found through the data.ontario.ca CKAN API — the newest
 * ENGLISH resource on the dataset — never a fixed URL. Ontario REPLACES files in place
 * (2026-09-29: the April 2024-25 preliminary file was deleted for the August 2024-25 final
 * one), so a pinned URL 404s the next quarterly run. That file mixes the two cell formats:
 * 361 rated schools as numbers, the other 3,983 as "71%" text.
 *
 * COVERAGE GUARD: a new release can suppress EQAO results (an older final release hid
 * most of them) or change the cell format (the 2024-25 final writes "71%", the preliminary
 * wrote 0.71). Either one turns every score null WITHOUT an error, and the workflow's next
 * step would then copy those nulls onto every listing. So the build REFUSES to write when
 * the rated count falls below RATED_FLOOR of the dataset it replaces. Re-run with
 * --allow-drop after checking the drop is real.
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

// SIF dataset id on data.ontario.ca (OGL-Ontario). The file itself is discovered per run.
const DATASET_ID = 'd85f68c5-fcb0-4b4d-aec5-3047db47dcd5';
const CKAN_PACKAGE_URL = `https://data.ontario.ca/api/3/action/package_show?id=${DATASET_ID}`;
// A real release moves the rated count by a few percent (the 2024-25 final rated the same
// 4,344 schools as the preliminary it replaced). Losing a seventh of them is not a release
// difference, it is a parse or suppression failure.
const RATED_FLOOR = 0.85;
const CACHE_DIR = path.join(process.cwd(), '.cache', 'schools');
const CACHE_FILE = path.join(CACHE_DIR, 'sif_latest.xlsx');
const OUT_FILE = path.join(process.cwd(), 'data', 'ontario-schools.json');
const REFRESH = process.argv.includes('--refresh');
const ALLOW_DROP = process.argv.includes('--allow-drop');

// EQAO achievement columns (exact SIF header names; values are % at the provincial
// standard, as a 0–1 fraction or a "71%" string depending on the release). The "Change ... Over Three Years" delta columns are ignored.
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

// An EQAO cell as a 0–1 fraction: 0.71 stays 0.71, "71%" becomes 0.71, "NA" / "N/R" -> null.
const fractionOrNull = (v: unknown): number | null => {
  const s = String(v ?? '').trim();
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(s);
  if (pct) return Number(pct[1]) / 100;
  const n = numOrNull(s);
  return n !== null && n >= 0 && n <= 1 ? n : null;
};

// Deterministic 0–10 score = mean of available EQAO % at standard, ×10. null if none.
function computeScore(row: Record<string, any>, cols: string[]): number | null {
  const vals = cols.map((c) => fractionOrNull(row[c])).filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length; // 0–1
  return Math.round(mean * 10 * 100) / 100; // 0–10, 2 decimals
}

type CkanResource = { url: string; name?: string; format?: string; created?: string };

// The newest English XLSX on the dataset. French twins share each release, so filter on
// the "_en" file-name token rather than trusting order.
async function discoverSourceUrl(): Promise<string> {
  const res = await fetch(CKAN_PACKAGE_URL);
  if (!res.ok) throw new Error(`CKAN package_show failed: HTTP ${res.status}`);
  const body = (await res.json()) as { success?: boolean; result?: { resources?: CkanResource[] } };
  const english = (body.result?.resources ?? [])
    .filter((r) => /xlsx/i.test(r.format ?? '') && /_en[_.]/i.test(r.url.split('/').pop() ?? ''))
    .sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
  if (!english.length) throw new Error('CKAN listed no English XLSX resource on the SIF dataset');
  console.log(`Newest English SIF resource: "${english[0].name ?? ''}" (created ${english[0].created ?? '?'})`);
  return english[0].url;
}

// Rated count of the dataset about to be replaced, or null when there is none to compare.
function previousRatedCount(): number | null {
  if (!fs.existsSync(OUT_FILE)) return null;
  try {
    const prev = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')) as { score: number | null }[];
    return prev.filter((s) => s.score !== null).length;
  } catch {
    return null;
  }
}

async function ensureSource() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(CACHE_FILE) && !REFRESH) {
    console.log(`Using cached source: ${path.relative(process.cwd(), CACHE_FILE)}`);
    return;
  }
  const url = await discoverSourceUrl();
  console.log(`Downloading Ontario SIF source (OGL-Ontario): ${url}`);
  const res = await fetch(url);
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

  // Checked BEFORE the write: a throw here leaves the committed dataset in place and fails
  // the workflow before the Typesense backfill step can propagate the loss.
  const prevRated = previousRatedCount();
  if (prevRated && rated < prevRated * RATED_FLOOR && !ALLOW_DROP) {
    throw new Error(
      `Rated schools fell from ${prevRated} to ${rated} (floor ${Math.round(RATED_FLOOR * 100)}%). ` +
        'The source may suppress EQAO or use a new cell format. Nothing was written. ' +
        'Check the file, then re-run with --allow-drop if the drop is real.'
    );
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
