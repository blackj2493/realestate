/**
 * AVM coefficient TRAINER — fits a fresh CHALLENGER matrix from recent sold sales and writes it
 * to the staging tables (migration 055). Never touches the live champion; a separate gated
 * promotion step copies staging -> live only if the challenger beats the champion on the
 * leakage-safe backtest (avm-backtest.ts).
 *
 * MODEL (must match the live path — calculator.ts):
 *   estimate = anchor * exp( clamp( Σ beta_i * clamp((x_i - mean_i)/std_i, ±3), ±0.4 ) )
 * So per cohort (city_region × normalized property_sub_type) we regress
 *   ln(close_price) = ȳ + Σ beta_i * z_i        (z_i = standardized, mean-imputed feature)
 * via RIDGE (L2) to keep thin cohorts stable, and store beta_i, feat_mean_i, feat_std_i plus
 * an audit row (n, R², MAE, base_price = trimmed-mean close price — the fallback anchor prior).
 *
 * The 8 trained features (features.ts) and their raw_vow_sold derivation:
 *   building_area_total, lot_width, bedrooms_above_grade, bathrooms_total_integer, parking_total
 *     — used raw (null → mean-imputed, z=0)
 *   interior_score  = 6 - interior_tier   exterior_score = 5 - exterior_tier
 *   basement_score  = 10 - basement_tier
 *
 * 100% deterministic, no AI (CLAUDE.md §4). raw_vow_sold is READ-ONLY (§12); writes go ONLY to
 * the *_staging tables. DATABASE_URL (Session pooler) required.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/worker/avm/trainMatrices.ts               # dry-run (summary only)
 *   npx tsx --env-file=.env scripts/worker/avm/trainMatrices.ts --apply       # write to staging
 *   flags: --min-samples 40  --window-months 36  --lambda 1.0
 */
import 'dotenv/config';
import { Client } from 'pg';
import { normalizePropertySubType, cohortRungKeys, type CohortRung } from '@/lib/avm/normalizeType';

const APPLY = process.argv.includes('--apply');
function numFlag(name: string, def: number): number {
  const i = process.argv.indexOf(name);
  if (i < 0) return def;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : def;
}
const MIN_SAMPLES = numFlag('--min-samples', 40);
const WINDOW_MONTHS = numFlag('--window-months', 36);
const LAMBDA = numFlag('--lambda', 1.0);
// Leases are excluded by the feed's own transaction_type (migration 104), not by a
// price threshold — matches types.SALE_TRANSACTION_TYPE. The floor below is only a
// guard against $0 placeholder closings.
const SALE_TRANSACTION_TYPE = 'For Sale';
const MIN_CLOSE_PRICE = 1; // matches types.MIN_CLOSE_PRICE
const Z_CLAMP = 3; // matches types.Z_CLAMP

// The 9 trained features, in a fixed column order. APPEND only — the order is the
// column order of the design matrix, so inserting mid-list silently remaps every
// stored beta. bedrooms_below_grade joined last (see features.ts for its measured
// 5-7% premium); champion matrices fitted before it simply have no row for it, and
// featureContributions skips a missing coefficient, so the two coexist safely.
/** A feature whose beta is 0 in every single cohort was not really trained — the
 *  usual cause is the SELECT above not fetching its column, which leaves the value
 *  undefined, std 0, and the ridge fit with nothing to weigh. That state is invisible
 *  downstream: the challenger still backtests, still clears the promotion gate on the
 *  strength of a fresher training window, and ships a feature that does nothing.
 *  Measured for real on 2026-08-18 — bedrooms_below_grade came back 0.0000 across all
 *  1,661 cohorts. Fail the run instead. */
function assertFeaturesTrained(models: Array<{ betas: number[] }>): void {
  if (models.length === 0) return;
  const dead = FEATURES.filter((_, i) => models.every((m) => m.betas[i] === 0));
  if (dead.length > 0) {
    throw new Error(
      `Feature(s) never trained (beta 0 in all ${models.length} cohorts): ${dead.join(', ')}. ` +
      'Check that the raw_vow_sold SELECT fetches the underlying column.',
    );
  }
}

/** The cohort-KEY twin of assertFeaturesTrained. A rung that trains zero cohorts almost
 *  always means the SELECT stopped fetching its column (city, postal_code), which leaves
 *  every key blank — and nothing downstream can tell that apart from "this rung was never
 *  needed". The AVM would keep returning plausible numbers for the markets the rung exists
 *  to serve, exactly as it did for Kitchener before 2026-08-29. Fail the run instead.
 *
 *  Community is excluded on purpose: it is the original rung and cannot regress to zero
 *  without the feed itself collapsing, which other checks already catch. */
function assertRungsTrained(models: CohortModel[]): void {
  if (models.length === 0) return;
  for (const rung of ['fsa', 'city'] as const) {
    if (!models.some((m) => m.rung === rung)) {
      throw new Error(
        `Rung "${rung}" trained 0 cohorts out of ${models.length}. Check that the ` +
        'raw_vow_sold SELECT still fetches city and postal_code.',
      );
    }
  }
}

const FEATURES = [
  'building_area_total', 'lot_width', 'bedrooms_above_grade', 'bathrooms_total_integer',
  'parking_total', 'interior_score', 'exterior_score', 'basement_score',
  'bedrooms_below_grade',
] as const;
const P = FEATURES.length;

interface SoldRow {
  close_price: number | null;
  city_region: string | null;
  /** Cohort KEYS for the coarser rungs. Both must stay in the SELECT — see
   *  assertRungsTrained for what happens when one silently drops out. */
  city: string | null;
  postal_code: string | null;
  property_sub_type: string | null;
  building_area_total: number | null;
  lot_width: number | null;
  bedrooms_above_grade: number | null;
  bedrooms_below_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  interior_tier: number | null;
  exterior_tier: number | null;
  basement_tier: number | null;
}

/** Raw feature vector (nulls preserved) for one sale, in FEATURES order. */
function featureVec(r: SoldRow): (number | null)[] {
  const score = (tier: number | null, top: number) => (tier == null ? null : top - tier);
  return [
    r.building_area_total, r.lot_width, r.bedrooms_above_grade, r.bathrooms_total_integer,
    r.parking_total, score(r.interior_tier, 6), score(r.exterior_tier, 5), score(r.basement_tier, 10),
    r.bedrooms_below_grade,
  ];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function std(xs: number[], mu: number): number {
  if (xs.length < 2) return 1;
  const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  const s = Math.sqrt(v);
  return s > 1e-9 ? s : 1; // clamp degenerate/near-constant to 1 (matches ingest guard)
}
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Solve the SPD system A x = b (A is P×P) by Gaussian elimination with partial pivoting. */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-12) continue; // singular column → leave coefficient 0
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => (Math.abs(M[i][i]) < 1e-12 ? 0 : row[n] / M[i][i]));
}

/** Trimmed mean (drop top/bottom 10%) — robust fallback anchor prior. */
function trimmedMean(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const k = Math.floor(s.length * 0.1);
  const core = s.slice(k, s.length - k);
  return mean(core.length ? core : s);
}

interface CohortModel {
  rung: CohortRung;
  cityRegion: string;
  subType: string;
  n: number;
  betas: number[];
  means: number[];
  stds: number[];
  r2: number;
  mae: number;
  basePrice: number;
}

function trainCohort(rung: CohortRung, cityRegion: string, subType: string, rows: SoldRow[]): CohortModel | null {
  const prices = rows.map((r) => r.close_price as number);
  const y = prices.map((p) => Math.log(p));
  const yBar = mean(y);

  // Per-feature mean/std over PRESENT values (mean-imputation → z=0 for missing).
  const means: number[] = [], stds: number[] = [];
  const vecs = rows.map(featureVec);
  for (let j = 0; j < P; j++) {
    const present = vecs.map((v) => v[j]).filter((x): x is number => x != null);
    const mu = present.length ? mean(present) : 0;
    means[j] = mu;
    stds[j] = std(present, mu);
  }

  // Standardized, clamped design matrix (missing → 0).
  const Z: number[][] = vecs.map((v) =>
    v.map((x, j) => (x == null ? 0 : clamp((x - means[j]) / stds[j], -Z_CLAMP, Z_CLAMP))),
  );

  // Ridge normal equations: (ZᵀZ + λI) β = Zᵀ(y − ȳ).
  const A: number[][] = Array.from({ length: P }, () => new Array(P).fill(0));
  const b: number[] = new Array(P).fill(0);
  for (let i = 0; i < Z.length; i++) {
    const yc = y[i] - yBar;
    for (let j = 0; j < P; j++) {
      b[j] += Z[i][j] * yc;
      for (let k = j; k < P; k++) A[j][k] += Z[i][j] * Z[i][k];
    }
  }
  for (let j = 0; j < P; j++) {
    A[j][j] += LAMBDA;
    for (let k = 0; k < j; k++) A[j][k] = A[k][j]; // symmetric fill
  }
  const betas = solve(A, b);

  // In-sample fit: ŷ = ȳ + Zβ (mirrors the audit's reported R²).
  let ssRes = 0, ssTot = 0, absErr = 0;
  for (let i = 0; i < Z.length; i++) {
    let adj = 0;
    for (let j = 0; j < P; j++) adj += betas[j] * Z[i][j];
    const yHat = yBar + clamp(adj, -0.4, 0.4); // ADJ_CLAMP — score exactly as the live path does
    ssRes += (y[i] - yHat) ** 2;
    ssTot += (y[i] - yBar) ** 2;
    absErr += Math.abs(Math.exp(yHat) - prices[i]) / prices[i];
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    rung, cityRegion, subType, n: rows.length, betas, means, stds,
    r2: Math.round(r2 * 1e4) / 1e4,
    mae: Math.round((absErr / Z.length) * 1e4) / 1e4,
    basePrice: Math.round(trimmedMean(prices)),
  };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) { console.error('❌ Set DATABASE_URL (Session pooler, §12)'); process.exit(1); }

  console.log(`\n🧮 AVM trainer → staging  [${APPLY ? 'APPLY' : 'DRY-RUN'}]`);
  console.log(`   window=${WINDOW_MONTHS}mo · min-samples=${MIN_SAMPLES} · ridge λ=${LAMBDA}`);
  console.log('='.repeat(64));

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await client.connect();
  await client.query("SET statement_timeout TO '0'");

  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - WINDOW_MONTHS);
  const sinceIso = since.toISOString().slice(0, 10);

  // Stream sold sales (scalar columns only — IO budget) via keyset pagination.
  const cohorts = new Map<string, SoldRow[]>();
  let cursor = '';
  let scanned = 0;
  for (;;) {
    const { rows } = await client.query<SoldRow & { listing_key: string }>(
      // Cast numerics to float8 — pg returns `numeric` columns as STRINGS, which would
      // silently concatenate in the +-accumulations (→ NaN). float8 comes back as JS number.
      `SELECT listing_key,
              close_price::float8              AS close_price,
              city_region, city, postal_code, property_sub_type,
              building_area_total::float8       AS building_area_total,
              lot_width::float8                 AS lot_width,
              bedrooms_above_grade::float8      AS bedrooms_above_grade,
              bedrooms_below_grade::float8      AS bedrooms_below_grade,
              bathrooms_total_integer::float8   AS bathrooms_total_integer,
              parking_total::float8             AS parking_total,
              interior_tier::float8             AS interior_tier,
              exterior_tier::float8             AS exterior_tier,
              basement_tier::float8             AS basement_tier
         FROM raw_vow_sold
        WHERE listing_key > $1 AND close_price >= $2 AND purchase_contract_date >= $3
          AND transaction_type = $4
        ORDER BY listing_key LIMIT 2000`,
      [cursor, MIN_CLOSE_PRICE, sinceIso, SALE_TRANSACTION_TYPE],
    );
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].listing_key;
    for (const r of rows) {
      scanned++;
      const sub = normalizePropertySubType(r.property_sub_type || '');
      if (!sub || !r.close_price || r.close_price <= 0) continue;
      // A sale feeds EVERY rung it has a key for, not just the finest. The coarser rungs
      // are fallbacks for subjects the finer one cannot reach, so they must be fitted on
      // all available sales — not on whatever the community rung left behind.
      for (const { rung, key: geo } of cohortRungKeys(r.city_region, r.postal_code, r.city)) {
        const key = `${rung}||${geo}||${sub}`;
        (cohorts.get(key) ?? cohorts.set(key, []).get(key)!).push(r);
      }
    }
    if (rows.length < 2000) break;
  }
  console.log(`   scanned ${scanned.toLocaleString()} sold sales → ${cohorts.size.toLocaleString()} raw cohorts`);

  const models: CohortModel[] = [];
  for (const [key, rows] of cohorts) {
    if (rows.length < MIN_SAMPLES) continue;
    const [rung, cr, sub] = key.split('||');
    const m = trainCohort(rung as CohortRung, cr, sub, rows);
    if (m) models.push(m);
  }
  models.sort((a, b) => b.n - a.n);
  assertFeaturesTrained(models);
  assertRungsTrained(models);
  const byRung = (r: CohortRung) => models.filter((m) => m.rung === r).length;
  console.log(`   rungs: community=${byRung('community')} fsa=${byRung('fsa')} city=${byRung('city')}`);
  const trainedR2 = models.filter((m) => m.r2 >= 0.5).length;
  console.log(`   trained ${models.length.toLocaleString()} cohorts (≥${MIN_SAMPLES} sales); ${trainedR2} with R²≥0.50 (coefficient-mode eligible)`);
  console.log('   top cohorts by n:');
  for (const m of models.slice(0, 6)) {
    console.log(`     [${m.rung}] ${m.cityRegion} / ${m.subType}  n=${m.n}  R²=${m.r2}  MAE=${(m.mae * 100).toFixed(1)}%  base=$${m.basePrice.toLocaleString()}`);
  }

  if (!APPLY) {
    console.log('\n💡 Dry-run — nothing written. Re-run with --apply to write the challenger to staging.');
    await client.end();
    return;
  }

  // Replace the staging challenger atomically (per-run full rebuild).
  //
  // The write is set-based ON PURPOSE. It used to issue one INSERT per row —
  // models.length * (P + 1) sequential round trips, 35,400 of them at 3,540 cohorts —
  // inside a single transaction, so the cost of the write was round-trip latency times
  // row count and nothing else. That took 8m36s on 2026-08-30 at ~15ms a round trip. On
  // 2026-09-06 the Weekly Ghost Reconcile started against the same database in the same
  // second (the monthly 6th fell on its weekday), latency roughly tripled, and the step
  // hit its 30-minute timeout with the transaction still open — a whole monthly retrain
  // lost to a neighbour's load. unnest() makes the write O(chunks) instead of O(rows),
  // so how busy the database is no longer decides whether the retrain finishes.
  const CHUNK = 5_000; // rows per statement — bounds the size of one parameter array
  await client.query('BEGIN');
  try {
    await client.query('TRUNCATE avm_multiplier_matrix_staging');
    await client.query('TRUNCATE avm_audit_report_staging');

    // One matrix row per (cohort × feature), flattened into parallel arrays in the same
    // nested order the row-at-a-time loop used, so the stored rows are unchanged.
    const mRung: string[] = [], mCity: string[] = [], mSub: string[] = [], mFeat: string[] = [];
    const mBeta: number[] = [], mMean: number[] = [], mStd: number[] = [];
    for (const m of models) {
      for (let j = 0; j < P; j++) {
        mRung.push(m.rung); mCity.push(m.cityRegion); mSub.push(m.subType); mFeat.push(FEATURES[j]);
        mBeta.push(m.betas[j]); mMean.push(m.means[j]); mStd.push(m.stds[j]);
      }
    }
    for (let i = 0; i < mRung.length; i += CHUNK) {
      const to = i + CHUNK;
      await client.query(
        `INSERT INTO avm_multiplier_matrix_staging (cohort_rung, city_region, property_sub_type, feature_name, beta, feat_mean, feat_std)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::float8[], $6::float8[], $7::float8[])`,
        [mRung.slice(i, to), mCity.slice(i, to), mSub.slice(i, to), mFeat.slice(i, to),
         mBeta.slice(i, to), mMean.slice(i, to), mStd.slice(i, to)],
      );
    }

    // One audit row per cohort.
    for (let i = 0; i < models.length; i += CHUNK) {
      const s = models.slice(i, i + CHUNK);
      await client.query(
        `INSERT INTO avm_audit_report_staging (cohort_rung, city_region, property_sub_type, total_sales_analyzed, model_accuracy_score, average_error_margin, base_price)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::float8[], $6::float8[], $7::float8[])`,
        [s.map((m) => m.rung), s.map((m) => m.cityRegion), s.map((m) => m.subType),
         s.map((m) => m.n), s.map((m) => m.r2), s.map((m) => m.mae), s.map((m) => m.basePrice)],
      );
    }

    // A fast write is the point; a SILENTLY SHORT one is the risk unnest introduces. Postgres
    // pads mismatched array lengths with NULL instead of throwing, and a chunk loop that skips
    // a slice still commits. Neither the backtest nor the promotion gate can tell a truncated
    // challenger from a genuinely thin one — it would just score worse and lose. Count the rows
    // before COMMIT and roll back rather than stage a partial model.
    const { rows: [wrote] } = await client.query<{ mx: string; audit: string }>(
      `SELECT (SELECT count(*) FROM avm_multiplier_matrix_staging) AS mx,
              (SELECT count(*) FROM avm_audit_report_staging)      AS audit`,
    );
    if (Number(wrote.mx) !== mRung.length || Number(wrote.audit) !== models.length) {
      throw new Error(
        `Staging write is short: matrix ${wrote.mx}/${mRung.length}, audit ${wrote.audit}/${models.length}. Rolled back.`,
      );
    }

    await client.query('COMMIT');
    console.log(`\n✅ Wrote ${models.length.toLocaleString()} challenger cohorts (${models.length * P} coefficient rows) to staging.`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('❌ trainMatrices failed:', e instanceof Error ? e.message : e); process.exit(1); });
