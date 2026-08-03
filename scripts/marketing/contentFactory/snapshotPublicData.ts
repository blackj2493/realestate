/**
 * Content Factory — daily PUBLIC-SAFE data snapshot (the cloud routine's data source).
 *
 * WHY THIS EXISTS
 * Content drafting runs as a scheduled Claude Code CLOUD ROUTINE on the Max plan. That
 * sandbox has NO local secrets and its egress proxy blocks the live site, so the routine
 * cannot read pureproperty.ca or the database directly. This job runs in GitHub Actions —
 * which DOES hold the Supabase service-role secret — reads the SAME nightly `region_metrics`
 * precompute the public /data trackers render (via computeMarketBoardUncached, exactly like
 * the data-health canary and the monthly market brief), distills the day's most surprising
 * aggregate figures, and commits them to content-queue/data/. The routine then reads
 * content-queue/data/latest.json straight from its checkout — no egress, no scraping, no
 * secrets. Nothing here posts anywhere.
 *
 * COMPLIANCE
 * Every figure emitted is a region-level AGGREGATE statistic (no listing rows, no individual
 * sold price) drawn from at least MIN_SAMPLE_N underlying listings — the category the
 * codebase treats as exempt from the IDX §6.3(b) display cap and safe for public marketing.
 * An angle that cannot be built public-safe is simply OMITTED, never guessed. Each angle
 * carries its exact figure string and the /data tracker URL a human can verify it against.
 *
 * Usage:
 *   npx tsx scripts/marketing/contentFactory/snapshotPublicData.ts           # dry-run: log only
 *   npx tsx scripts/marketing/contentFactory/snapshotPublicData.ts --write   # write JSON snapshot
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { computeMarketBoardUncached, type MarketRow } from '@/lib/data/marketBoard';

const WRITE = process.argv.includes('--write');

/** Public-safety floor — mirrors viralityRubric.MIN_SAMPLE_N. */
const MIN_SAMPLE_N = 5;

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
const OUT_DIR = path.join(process.cwd(), 'content-queue', 'data');
const TODAY_UTC = new Date().toISOString().slice(0, 10);

interface Angle {
  kind: string;
  region: string;
  headline: string;
  /** The ONLY figure the drafter may cite for this angle — use verbatim. */
  figure: string;
  sampleN: number;
  sourceUrl: string;
  whySurprising: string;
  context?: string;
}

interface Snapshot {
  generatedForDateUtc: string;
  dataAsOf: string | null;
  source: string;
  compliancePosture: string;
  angles: Angle[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Pick the market with the most extreme value for one metric, among markets whose sample
 * size clears MIN_SAMPLE_N. Returns null when no market qualifies (→ angle omitted).
 */
function pickExtreme(
  rows: MarketRow[],
  value: (r: MarketRow) => number | null | undefined,
  sampleN: (r: MarketRow) => number | null | undefined,
  dir: 'max' | 'min',
): { row: MarketRow; value: number; sampleN: number } | null {
  let best: { row: MarketRow; value: number; sampleN: number } | null = null;
  for (const r of rows) {
    const v = value(r);
    const n = sampleN(r);
    if (!isNum(v) || !isNum(n) || n < MIN_SAMPLE_N) continue;
    if (!best || (dir === 'max' ? v > best.value : v < best.value)) best = { row: r, value: v, sampleN: n };
  }
  return best;
}

function buildAngles(rows: MarketRow[]): Angle[] {
  const angles: Angle[] = [];
  const nMarkets = rows.length;

  // 1) PRICE-CUT PRESSURE — highest share of active listings that have reduced asking.
  //    cutShare is a 0..1 ratio (see marketBoard CutsLite); ×100 → percent. n = cutActive.
  const cuts = pickExtreme(rows, (r) => (isNum(r.cutShare) ? r.cutShare * 100 : null), (r) => r.cutActive, 'max');
  if (cuts) {
    const p = Math.round(cuts.value);
    angles.push({
      kind: 'price_cuts',
      region: cuts.row.region,
      headline: `${p}% of active ${cuts.row.region} listings have cut their asking price`,
      figure: `${p}%`,
      sampleN: cuts.sampleN,
      sourceUrl: `${SITE}/data/price-cuts`,
      whySurprising: `Highest price-cut share of the ${nMarkets} markets tracked today.`,
      context: isNum(cuts.row.medianCutPct) ? `typical reduction ${cuts.row.medianCutPct.toFixed(1)}%` : undefined,
    });
  }

  // 2) SLOW TO SELL — longest median TRUE days-on-market among active listings. n = activeCount.
  const slow = pickExtreme(rows, (r) => r.trueDom, (r) => r.activeCount, 'max');
  if (slow) {
    const d = Math.round(slow.value);
    angles.push({
      kind: 'days_on_market',
      region: slow.row.region,
      headline: `The typical active ${slow.row.region} listing has now sat ${d} days`,
      figure: `${d} days`,
      sampleN: slow.sampleN,
      sourceUrl: `${SITE}/data/days-on-market`,
      whySurprising: `Longest median true days-on-market of the markets tracked today.`,
    });
  }

  // 3) INVENTORY GLUT — highest months-of-supply (≈4–6 balanced; above = buyer's market).
  const moi = pickExtreme(rows, (r) => r.monthsOfSupply, (r) => r.activeCount, 'max');
  if (moi) {
    const m = moi.value.toFixed(1);
    angles.push({
      kind: 'inventory',
      region: moi.row.region,
      headline: `${moi.row.region} is sitting at ${m} months of supply`,
      figure: `${m} months of supply`,
      sampleN: moi.sampleN,
      sourceUrl: `${SITE}/data/market-temperature`,
      whySurprising: `Highest months-of-supply of the markets tracked (≈4–6 = balanced; above tilts to buyers).`,
    });
  }

  // 4) BEST RENTAL YIELD — highest gross yield across every market's rent-vs-buy rows.
  //    grossYieldPct is a percent (e.g. 4.8); tolerate a 0..1 ratio defensively (×100).
  let bestYield: { region: string; beds: number; yieldPct: number; sampleN: number } | null = null;
  for (const r of rows) {
    if (!isNum(r.activeCount) || r.activeCount < MIN_SAMPLE_N) continue;
    for (const rr of r.rentalRows ?? []) {
      let y = rr.grossYieldPct;
      if (!isNum(y)) continue;
      if (y > 0 && y < 1) y = y * 100; // ratio → percent
      if (y < 1 || y > 20) continue; // implausible gross yield → skip (never publish a junk number)
      if (!bestYield || y > bestYield.yieldPct) bestYield = { region: r.region, beds: rr.beds, yieldPct: y, sampleN: r.activeCount };
    }
  }
  if (bestYield) {
    const y = bestYield.yieldPct.toFixed(1);
    const bedLabel = bestYield.beds <= 0 ? 'unit' : `${bestYield.beds}-bed`;
    angles.push({
      kind: 'rental_yield',
      region: bestYield.region,
      headline: `A ${bedLabel} in ${bestYield.region} grosses about ${y}% rental yield`,
      figure: `${y}% gross yield`,
      sampleN: bestYield.sampleN,
      sourceUrl: `${SITE}/data/rent-vs-buy`,
      whySurprising: `Best gross rental yield of the markets tracked today (${bedLabel}).`,
    });
  }

  return angles;
}

/** Log raw values behind each candidate metric so units are verifiable from the CI log. */
function logMarkets(rows: MarketRow[]): void {
  console.log(`[snapshot] ${rows.length} markets in region_metrics precompute:`);
  for (const r of rows) {
    console.log(
      `  ${r.region.padEnd(16)} ` +
        `cutShare=${r.cutShare} (n=${r.cutActive}) ` +
        `trueDom=${r.trueDom} moi=${r.monthsOfSupply} ` +
        `active=${r.activeCount} soldToList=${r.soldToListPct} ` +
        `rentalRows=${(r.rentalRows ?? []).length}`,
    );
  }
}

async function main() {
  let board;
  try {
    board = await computeMarketBoardUncached();
  } catch (e) {
    console.error('[snapshot] market board unavailable — writing nothing (routine will skip):', e);
    process.exit(0);
  }

  const rows = board.rows ?? [];
  logMarkets(rows);

  const angles = buildAngles(rows);
  const snapshot: Snapshot = {
    generatedForDateUtc: TODAY_UTC,
    dataAsOf: board.dataAsOf,
    source: 'region_metrics nightly precompute (computeMarketBoardUncached)',
    compliancePosture:
      'Aggregate region-level statistics only; no individual sold prices; every figure n>=5. Cite figures verbatim.',
    angles,
  };

  console.log(`\n[snapshot] ${angles.length} public-safe angle(s) for ${TODAY_UTC} (dataAsOf ${board.dataAsOf}):`);
  for (const a of angles) {
    console.log(`  [${a.kind}] ${a.region}: "${a.figure}" — ${a.headline}${a.context ? ` (${a.context})` : ''}`);
  }

  if (angles.length === 0) {
    console.warn('[snapshot] no public-safe angles today — writing nothing (routine will skip drafting).');
    process.exit(0);
  }

  if (!WRITE) {
    console.log('\n[snapshot] dry-run (no --write): not writing files.');
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(snapshot, null, 2) + '\n';
  fs.writeFileSync(path.join(OUT_DIR, `${TODAY_UTC}.json`), json);
  fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), json);
  console.log(`\n[snapshot] wrote content-queue/data/${TODAY_UTC}.json and latest.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
