/**
 * Champion/challenger PROMOTION GATE. Compares two avm-backtest.ts result files — the CHAMPION
 * (live tables) and the CHALLENGER (staging, freshly trained) — and promotes the challenger to
 * production ONLY if it is at least as accurate out-of-time and does not lose coverage.
 *
 * Gate (all must hold to promote):
 *   1. challenger median |%err|  <=  champion median |%err| − MARGIN   (no accuracy regression)
 *   2. challenger published count >= COVERAGE × champion published count (no coverage regression)
 *   3. both files have a non-trivial number of scored sales
 *
 * Without --apply it is COMPARE-ONLY: prints/【emails the verdict, touches nothing. With --apply
 * and a passing gate it copies staging -> live in ONE transaction (atomic swap; readers see all-old
 * or all-new, never empty). ROLLBACK if needed: re-ingest the committed champion CSVs via
 * scripts/worker/avm/ingest-matrices.ts.
 *
 * Deterministic; the only DB write is the gated promotion. DATABASE_URL (Session pooler) required.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/worker/avm/promoteChallenger.ts champion.json challenger.json
 *   npx tsx --env-file=.env scripts/worker/avm/promoteChallenger.ts champion.json challenger.json --apply
 *   flags: --margin 0.0 (min accuracy improvement, fraction)  --coverage 0.97
 */
import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs';

const APPLY = process.argv.includes('--apply');
function numFlag(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : def;
}
const MARGIN = numFlag('--margin', 0.0);   // challenger must be at least this much better (fraction)
const COVERAGE = numFlag('--coverage', 0.97); // challenger must keep >= this share of champion's coverage

const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (files.length < 2) {
  console.error('❌ Usage: promoteChallenger.ts <champion.json> <challenger.json> [--apply]');
  process.exit(1);
}
const [CHAMPION_PATH, CHALLENGER_PATH] = files;

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const pct = (x: number) => (Number.isNaN(x) ? 'n/a' : (x * 100).toFixed(2) + '%');

function summarize(path: string): { median: number; published: number; n: number } {
  const data = JSON.parse(fs.readFileSync(path, 'utf8')) as { results: { abs_pct_error: number | null }[] };
  const rows = Array.isArray(data.results) ? data.results : [];
  const abs = rows.map((r) => r.abs_pct_error).filter((x): x is number => typeof x === 'number');
  return { median: median(abs), published: abs.length, n: rows.length };
}

async function promote(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error('DATABASE_URL required to promote');
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  await c.query('BEGIN');
  try {
    // The column lists below are explicit on purpose — a SELECT * would break the moment
    // the live and staging tables drift apart. The cost is that a NEW column silently
    // defaults instead of copying: cohort_rung (migration 130) must appear in both lists or
    // every FSA and city cohort arrives in live labelled 'community', and the ladder that
    // exists to reach Waterloo Region quietly does nothing. Add a column here whenever you
    // add one to the staging tables.
    await c.query('TRUNCATE avm_multiplier_matrix');
    await c.query(
      `INSERT INTO avm_multiplier_matrix (cohort_rung, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std)
       SELECT cohort_rung, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std FROM avm_multiplier_matrix_staging`,
    );
    await c.query('TRUNCATE avm_audit_report');
    await c.query(
      `INSERT INTO avm_audit_report (cohort_rung, city_region, property_sub_type, total_sales_analyzed, model_accuracy_score, average_error_margin, base_price)
       SELECT cohort_rung, city_region, property_sub_type, total_sales_analyzed, model_accuracy_score, average_error_margin, base_price FROM avm_audit_report_staging`,
    );
    const cnt = await c.query('SELECT count(*) AS n FROM avm_multiplier_matrix');
    await c.query('COMMIT');
    console.log(`   ✅ PROMOTED — live avm_multiplier_matrix now has ${cnt.rows[0].n} coefficient rows (challenger).`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function main(): Promise<void> {
  const champ = summarize(CHAMPION_PATH);
  const chal = summarize(CHALLENGER_PATH);

  const accuracyOK = chal.median <= champ.median - MARGIN;
  const coverageOK = chal.published >= COVERAGE * champ.published;
  const enoughData = champ.published >= 200 && chal.published >= 200;
  const shouldPromote = accuracyOK && coverageOK && enoughData;

  console.log('──────── CHAMPION vs CHALLENGER ────────');
  console.log(`  Champion   : median |%err| ${pct(champ.median)}   published ${champ.published}/${champ.n}`);
  console.log(`  Challenger : median |%err| ${pct(chal.median)}   published ${chal.published}/${chal.n}`);
  console.log(`  Δ median   : ${((chal.median - champ.median) * 100).toFixed(2)}pt  (negative = challenger better)`);
  console.log(`  Gate: accuracy ${accuracyOK ? '✓' : '✗'} (≤ champ − ${pct(MARGIN)})  ·  coverage ${coverageOK ? '✓' : '✗'} (≥ ${(COVERAGE * 100).toFixed(0)}% of champ)  ·  data ${enoughData ? '✓' : '✗'}`);
  console.log(`  Verdict: ${shouldPromote ? '🟢 CHALLENGER WINS' : '⚪ KEEP CHAMPION'}`);

  if (!shouldPromote) {
    console.log('\n⚪ Keeping champion — challenger did not clear the gate (this is the safeguard working, not a failure).');
    return; // exit 0: a kept champion is a valid, healthy outcome
  }
  if (!APPLY) {
    console.log('\n🟢 Challenger clears the gate. COMPARE-ONLY (no --apply) — production unchanged. Re-run with --apply to promote.');
    return;
  }
  console.log('\n🟢 Challenger clears the gate — promoting staging → live…');
  await promote();
}

main().catch((e) => { console.error('❌ promoteChallenger failed:', e instanceof Error ? e.message : e); process.exit(1); });
