/**
 * "Listed low to draw offers" rate-drift gate — re-measures the probabilities the listing
 * card publishes, and fails the run when they no longer match reality.
 *
 * WHY THIS EXISTS. detectCompetitive (src/lib/avm/salePrice.ts) fires on the SHAPE of an
 * ask — the top $5k of a $100k band, or the $_88,000 "lucky 8" price — because a shape is
 * the only seller-intent signal that survives into the feed. The explicit declaration you
 * would rather read ("offers held back until Tuesday") appears in just 41 of 72,182 active
 * listings, 0.1%; agents keep it in broker-only remarks, which VOW/IDX never exposes. So
 * the shape is a PROXY, and every proxy has the same failure mode: the convention shifts,
 * the proxy keeps matching, and the published number silently stops being true. The distress
 * badge drifted 19% -> 1.21% of actives exactly this way, and only a canary caught it.
 *
 * Each COMPETITIVE_PATTERNS entry publishes two measured numbers per market — an over-ask
 * rate the card prints verbatim ("sold over ask ~55% of the time") and a median close/list
 * that anchors the Deal Score offer band. This replays both against held-out sales and
 * exits NON-ZERO when either has moved past tolerance, which turns the monitor red and fires
 * the failure alert. A pattern that stops discriminating altogether needs no separate test:
 * its rate collapses, and that IS drift.
 *
 * It imports the pattern table from the application rather than restating it, so the canary
 * can never drift from the code it guards: add a pattern there and it is checked here on the
 * next run, with no second edit.
 *
 * Reads the avm-backtest.ts result file only — no DB, no writes, no AI. The file carries
 * list_price, close_price, estimated_value, city and confidence per held-out sale, which is
 * everything the published buckets are defined over.
 *
 * WHAT IT CANNOT DO YET. Bucket power scales with the backtest's --limit. Measured on a
 * full 41,541-sale replay the buckets land at threshold/gta n=2,771, threshold/other n=1,818,
 * lucky-88/gta n=237 — all gateable. The monthly job replays 6,000, which scales those to
 * roughly 400 / 260 / 34: the two "threshold" buckets still clear COMPETE_MIN_N, lucky-88
 * does not, so it is REPORTED and never gated there. Gating it would need --limit ~25,000,
 * and that turns a 45-minute job into a ~3-hour one; not worth it for the pattern covering
 * the smaller share of fires. An under-powered bucket never fails the run — a canary that
 * cries wolf on noise gets muted, and a muted canary is worse than none.
 *
 * Env:
 *   COMPETE_MAX_DRIFT      max |measured − published| over-ask rate   (default 0.10 = 10pp)
 *   COMPETE_MAX_RATIO_DRIFT max |measured − published| median c/l     (default 0.03)
 *   COMPETE_MIN_N          bucket size required to gate at all        (default 150)
 *
 * The assessment itself is PURE (assessCompeteDrift) so it is unit-testable; main() does the
 * file IO and the exit code.
 *
 * Usage: npx tsx scripts/worker/competeRateDriftCheck.ts [path-to-backtest.json]
 */
import * as fs from 'fs';
import {
  COMPETITIVE_PATTERNS,
  COMPETITIVE_GAP_RATES,
  COMPETITIVE_COMP_MARGIN,
  competitiveMarketOf,
  type CompetitiveMarket,
} from '@/lib/avm/salePrice';

const IN_PATH = process.argv[2] || 'avm-backtest.json';
const MAX_DRIFT = Number(process.env.COMPETE_MAX_DRIFT) || 0.1;
const MAX_RATIO_DRIFT = Number(process.env.COMPETE_MAX_RATIO_DRIFT) || 0.03;
const MIN_N = Number(process.env.COMPETE_MIN_N) || 150;

/** Sanity band on close/list — drops mistyped-list and relist artifacts. Matches
 *  scripts/admin/_askDigitLift.ts so the two are comparable. */
const R_MIN = 0.3;
const R_MAX = 3.0;

export interface ResultRow {
  list_price: number | null;
  close_price: number;
  estimated_value: number | null;
  city: string | null;
  confidence: string;
}
interface Backtest {
  run_id?: string;
  generated_at?: string;
  results: ResultRow[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(1) + '%');
const pp = (x: number) => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + 'pp';

interface Sale {
  list: number;
  over: boolean;
  ratio: number;
  gap: number;
  market: CompetitiveMarket;
  eligible: boolean;
}

export interface DriftAssessment {
  /** Held-out closings with a usable ask and close. */
  usable: number;
  /** Of those, the ones the AVM priced at least COMPETITIVE_COMP_MARGIN above the ask. */
  belowComps: number;
  /** Over-ask rate across below-comps sales, PER MARKET. Reported as context, not gated:
   *  the pooled figure mixes a hot GTA with the rest of the province, so it is not a
   *  yardstick any single-market pattern can fairly be held to. */
  baseOverAsk: Record<CompetitiveMarket, number>;
  /** One human-readable line per published bucket, in table order. */
  lines: string[];
  /** Buckets too thin to gate this run (reported, never failed). */
  skipped: string[];
  /** Published rates that no longer match the data. Empty ⇒ healthy. */
  failures: string[];
}

export interface DriftThresholds {
  maxDrift: number;
  maxRatioDrift: number;
  minN: number;
}

/**
 * Re-measure every published rate against held-out sales. Pure: no IO, no exit.
 *
 * The buckets are rebuilt from COMPETITIVE_PATTERNS itself rather than a local copy, so a
 * pattern added to the application is guarded here automatically.
 */
export function assessCompeteDrift(
  results: ResultRow[],
  t: DriftThresholds,
): DriftAssessment {
  const below: Sale[] = [];
  let usable = 0;
  for (const r of results ?? []) {
    const list = Number(r.list_price) || 0;
    const close = Number(r.close_price) || 0;
    const est = Number(r.estimated_value) || 0;
    if (!(list > 0) || !(close > 0)) continue;
    const ratio = close / list;
    if (!(ratio >= R_MIN && ratio <= R_MAX)) continue;
    usable++;
    // Mirrors detectCompetitive: a LOW-confidence comp band is not evidence of under-listing.
    if (!(est > 0) || String(r.confidence).toUpperCase() === "LOW") continue;
    if (!(est >= list * (1 + COMPETITIVE_COMP_MARGIN))) continue;
    const market = competitiveMarketOf(r.city);
    below.push({
      list,
      over: close > list,
      ratio,
      gap: est / list - 1,
      market,
      // An ask the detector would actually fire on in this market.
      eligible: COMPETITIVE_PATTERNS.some((p) => p.test(list) && p.markets.includes(market)),
    });
  }

  const lines: string[] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  if (below.length === 0) {
    return {
      usable,
      belowComps: 0,
      baseOverAsk: { gta: NaN, other: NaN },
      lines,
      skipped,
      failures,
    };
  }

  const rateOf = (rs: Sale[]) => (rs.length ? rs.filter((s) => s.over).length / rs.length : NaN);
  const baseOverAsk: Record<CompetitiveMarket, number> = {
    gta: rateOf(below.filter((s) => s.market === "gta")),
    other: rateOf(below.filter((s) => s.market === "other")),
  };

  for (const market of Object.keys(COMPETITIVE_GAP_RATES) as CompetitiveMarket[]) {
    const bands = COMPETITIVE_GAP_RATES[market];
    for (let i = 0; i < bands.length; i++) {
      const published = bands[i];
      const upper = i + 1 < bands.length ? bands[i + 1].minGap : Infinity;
      const label = `${market}/gap ${(published.minGap * 100).toFixed(0)}-${upper === Infinity ? "∞" : (upper * 100).toFixed(0)}%`;

      // The bucket the published numbers describe: eligible ask shape, this market, this depth.
      const bucket = below.filter(
        (s2) => s2.eligible && s2.market === market && s2.gap >= published.minGap && s2.gap < upper,
      );
      const n = bucket.length;
      if (n === 0) {
        skipped.push(`${label}: no sales this run`);
        lines.push(`  ${label.padEnd(22)} n=    0   — not assessed`);
        continue;
      }

      const over = bucket.filter((s2) => s2.over).length / n;
      const med = median(bucket.map((s2) => s2.ratio));
      const dOver = over - published.overAskRate;
      const dMed = med - published.medianCloseRatio;
      const powered = n >= t.minN;
      lines.push(
        `  ${label.padEnd(22)} n=${String(n).padStart(5)}   over-ask ${pct(over).padStart(6)} vs ${pct(published.overAskRate).padStart(6)} (${pp(dOver)})   med c/l ${med.toFixed(3)} vs ${published.medianCloseRatio.toFixed(3)} (${dMed >= 0 ? "+" : ""}${dMed.toFixed(3)})${powered ? "" : `  (n < ${t.minN} — reported only)`}`,
      );

      if (!powered) {
        skipped.push(`${label}: n=${n} < ${t.minN}`);
        continue;
      }
      if (Math.abs(dOver) > t.maxDrift) {
        failures.push(
          `${label}: over-ask rate measured ${pct(over)} but the card prints ${pct(published.overAskRate)} (${pp(dOver)}, tolerance ${pct(t.maxDrift)}, n=${n}).`,
        );
      }
      if (Math.abs(dMed) > t.maxRatioDrift) {
        failures.push(
          `${label}: median close/list measured ${med.toFixed(3)} but the range floors at ${published.medianCloseRatio.toFixed(3)} (tolerance ${t.maxRatioDrift}, n=${n}).`,
        );
      }
    }
  }

  return { usable, belowComps: below.length, baseOverAsk, lines, skipped, failures };
}

function main(): void {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`❌ Backtest result file not found: ${IN_PATH} (did avm-backtest.ts run?)`);
    process.exit(1);
  }
  let data: Backtest;
  try {
    data = JSON.parse(fs.readFileSync(IN_PATH, "utf8")) as Backtest;
  } catch (e) {
    console.error(`❌ Could not parse ${IN_PATH}: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  const a = assessCompeteDrift(data.results ?? [], {
    maxDrift: MAX_DRIFT,
    maxRatioDrift: MAX_RATIO_DRIFT,
    minN: MIN_N,
  });

  console.log(
    `"Listed low to draw offers" rate drift (${data.run_id ?? "n/a"}) — ${a.usable.toLocaleString()} usable closings, ${a.belowComps.toLocaleString()} listed >=${pct(COMPETITIVE_COMP_MARGIN)} under comps`,
  );
  if (a.belowComps === 0) {
    console.error("❌ No below-comps sales in the backtest — cannot assess the published rates.");
    process.exit(1);
  }
  console.log(
    `  below-comps base over-ask rate — gta ${pct(a.baseOverAsk.gta)} · other ${pct(a.baseOverAsk.other)}  (context; the gate is per-pattern drift)
`,
  );
  for (const l of a.lines) console.log(l);
  if (a.skipped.length) console.log(`
  Not gated this run: ${a.skipped.join("; ")}.`);

  if (a.failures.length) {
    console.error(`
🔴 DRIFT — ${a.failures.length} published rate(s) no longer match the data:`);
    for (const f of a.failures) console.error(`   • ${f}`);
    console.error(
      `
Re-measure with:  npx tsx scripts/admin/_askDigitLift.ts --months 24
` +
        `Then update COMPETITIVE_PATTERNS in src/lib/avm/salePrice.ts, or drop the pattern if it has stopped discriminating.`,
    );
    process.exit(1);
  }
  console.log(`
✅ Published rates still match the data (all gated buckets within tolerance).`);
}

// Only run the CLI when invoked directly — importing this module (tests) must not exit.
if (process.argv[1] && /competeRateDriftCheck/.test(process.argv[1])) main();
