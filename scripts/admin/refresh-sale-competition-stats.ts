/**
 * Refresh sale_competition_stats (migration 120) — sold-vs-asking outcomes for
 * /data/over-asking.
 *
 * WHY A TRACKER AT ALL: "sold over asking" is the most-quoted phrase in Canadian housing
 * coverage and no Canadian source publishes the rate. TRREB publishes average price, sales
 * and new listings; CREA publishes a price index; WOWA and HouseSigma carry city-level
 * supply/demand. Redfin has published "share sold above final list price" for years and it is
 * one of their most-cited series — this is the Ontario equivalent, at neighbourhood grain.
 *
 * DONE IN SQL, NOT IN JS — same reasoning as the sibling rent job: this is a pure aggregation
 * over ~137k sale rows, so one server-side statement keeps everything but the finished cells
 * off the wire. GROUPING SETS computes the neighbourhood rows and the province rollup in a
 * single pass, so the headline strip and the table cannot disagree.
 *
 * HONESTY RULES BAKED IN, not left to the UI:
 *   • A SHARE needs a firmer base than a median does. sqrt(.18*.82/30) is ±7.0 points at
 *     n=30 versus ±3.8 at n=100, so MIN_SAMPLE stores at 30 and the board marks anything
 *     under THIN_SAMPLE. Ranking — the most quotable and least robust cut — is gated at 100
 *     in the board layer.
 *   • yoy_over_ask_pts is in percentage POINTS and is written only when BOTH windows clear
 *     MIN_YOY_SAMPLE. A rate difference drawn from two thin windows is noise wearing a
 *     decimal point.
 *   • MEDIAN sale-to-list, never mean. Redfin uses an average and must trim ±50% outliers to
 *     stop it lying; the median needs no such surgery. We apply the same ratio guard anyway,
 *     because a close/list of 0.02 is a data-entry error rather than a discount.
 *   • The three outcome shares are stored separately and sum to 100. "Sold at exactly the
 *     ask" is ~5% of the market and a real behaviour; folding it into "under" would overstate
 *     how often sellers concede.
 *
 * Reads raw_vow_sold READ-ONLY (CLAUDE.md §12) and writes only sale_competition_stats.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-sale-competition-stats.ts            # dry-run
 *   npx tsx scripts/admin/refresh-sale-competition-stats.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');

/** Below this a cell is not stored: a "share" from a dozen sales is not a share. */
const MIN_SAMPLE = 30;
/** A year-over-year POINT change is a difference of two rates — it needs both bases thick. */
const MIN_YOY_SAMPLE = 100;
/** Guards against a sale price entered in the wrong units. */
const PRICE_FLOOR = 50_000;
const PRICE_CEIL = 20_000_000;
/**
 * Same ±50% guard Redfin applies to their sale-to-list series. A close/list ratio outside
 * this band is a data-entry error (a $1 placeholder ask, a price typed in thousands), not a
 * negotiation outcome, and it would move the over-ask COUNT as well as the ratio.
 */
const RATIO_FLOOR = 0.5;
const RATIO_CEIL = 1.5;
/**
 * Reserved `city` for the province-wide rollup that feeds the page's headline strip. Not a
 * TRREB city, so it cannot collide with a real one. Paired with area '' — the same empty-area
 * convention Waterloo/Brantford already use.
 */
const PROVINCE_CITY = 'Ontario';

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL'); process.exit(1); }

const n = (x: number) => x.toLocaleString('en-US');

/** Mirrors the rent job's split so the two trackers group properties identically. */
const GROUP_EXPR = `CASE
    WHEN property_sub_type ILIKE '%condo%' OR property_sub_type ILIKE '%apartment%'
      OR property_sub_type ILIKE '%co-op%'  OR property_sub_type ILIKE '%co-own%'
    THEN 'Condo' ELSE 'House' END`;

const SQL = `
WITH base AS (
  SELECT
    city,
    -- The feed ships no CityRegion for Waterloo Region/Brantford. Empty string rolls those
    -- up under the city instead of dropping them from the tracker entirely.
    COALESCE(NULLIF(btrim(city_region), ''), '') AS area,
    ${GROUP_EXPR} AS property_group,
    close_price::numeric  AS close,
    list_price::numeric   AS ask,
    original_list_price::numeric AS orig_ask,
    close_date
  FROM raw_vow_sold
  WHERE transaction_type = 'For Sale'
    AND close_date >  now() - interval '24 months'
    AND close_date <= now()
    AND close_price BETWEEN $1 AND $2
    AND list_price  BETWEEN $1 AND $2
    AND close_price / NULLIF(list_price, 0) BETWEEN $3 AND $4
    AND city IS NOT NULL AND btrim(city) <> ''
),
cur AS (
  -- PROVINCE_CITY/'' rows come from the grouping set that omits city+area, leaving both NULL.
  -- The province figure is computed from the underlying sales in the same pass rather than
  -- averaged from the neighbourhood rows — a mean of neighbourhood rates would weight a
  -- 31-sale hamlet the same as Toronto C01.
  SELECT COALESCE(city, '${PROVINCE_CITY}') AS city,
         COALESCE(area, '') AS area,
         property_group,
         count(*)::int AS sample_count,
         round(100.0 * count(*) FILTER (WHERE close > ask)  / count(*), 1) AS pct_over_ask,
         round(100.0 * count(*) FILTER (WHERE close = ask)  / count(*), 1) AS pct_at_ask,
         round(100.0 * count(*) FILTER (WHERE close < ask)  / count(*), 1) AS pct_under_ask,
         -- ::numeric is required, not cosmetic: percentile_cont returns double precision and
         -- Postgres has no round(double precision, int) — only the two-arg numeric form.
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY 100.0 * close / ask)::numeric, 1)
           AS median_sale_to_list,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY close - ask)
               FILTER (WHERE close > ask))::int AS median_premium,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ask - close)
               FILTER (WHERE close < ask))::int AS median_discount,
         round(100.0 * count(*) FILTER (WHERE orig_ask IS NOT NULL AND ask < orig_ask)
               / NULLIF(count(*) FILTER (WHERE orig_ask IS NOT NULL), 0), 1)
           AS pct_cut_before_sale
    FROM base
   WHERE close_date > now() - interval '12 months'
   GROUP BY GROUPING SETS ((city, area, property_group), (property_group))
),
prior AS (
  SELECT COALESCE(city, '${PROVINCE_CITY}') AS city,
         COALESCE(area, '') AS area,
         property_group,
         count(*)::int AS prior_sample,
         100.0 * count(*) FILTER (WHERE close > ask) / count(*) AS prior_over_rate
    FROM base
   WHERE close_date <= now() - interval '12 months'
   GROUP BY GROUPING SETS ((city, area, property_group), (property_group))
)
SELECT c.city, c.area, c.property_group,
       c.pct_over_ask, c.pct_at_ask, c.pct_under_ask,
       c.median_sale_to_list, c.median_premium, c.median_discount, c.pct_cut_before_sale,
       -- POINTS, not percent. Both windows must be thick before any figure is published.
       CASE WHEN c.sample_count >= $5 AND COALESCE(p.prior_sample, 0) >= $5
            THEN round((c.pct_over_ask - p.prior_over_rate)::numeric, 2)
       END AS yoy_over_ask_pts,
       c.sample_count,
       COALESCE(p.prior_sample, 0) AS prior_sample
  FROM cur c
  LEFT JOIN prior p
    ON p.city = c.city AND p.area = c.area AND p.property_group = c.property_group
 WHERE c.sample_count >= $6
`;

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const t0 = Date.now();
    const { rows } = await c.query(SQL, [
      PRICE_FLOOR, PRICE_CEIL, RATIO_FLOOR, RATIO_CEIL, MIN_YOY_SAMPLE, MIN_SAMPLE,
    ]);
    console.log(`   computed ${n(rows.length)} cells in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const province = rows.filter((r) => r.city === PROVINCE_CITY);
    const withYoy = rows.filter((r) => r.yoy_over_ask_pts !== null);
    console.log(`   ${n(province.length)} province rows · ${n(rows.length - province.length)} neighbourhood rows`);
    console.log(`   ${n(withYoy.length)} carry a year-over-year point change`);
    for (const g of ['House', 'Condo']) {
      const s = rows.filter((r) => r.property_group === g && r.city !== PROVINCE_CITY);
      const thick = s.filter((r) => r.sample_count >= 100).length;
      console.log(`   ${g.padEnd(6)} ${String(s.length).padStart(5)} areas (${thick} at n>=100)`);
    }
    console.log('');
    console.table(province.map((r) => ({
      group: r.property_group, n: r.sample_count, over: r.pct_over_ask, at: r.pct_at_ask,
      under: r.pct_under_ask, stl: r.median_sale_to_list, premium: r.median_premium,
      yoy_pts: r.yoy_over_ask_pts,
    })));

    if (!APPLY) {
      console.table(
        rows.filter((r) => r.property_group === 'House' && r.city !== PROVINCE_CITY && r.sample_count >= 100)
            .sort((a, b) => b.pct_over_ask - a.pct_over_ask)
            .slice(0, 10)
            .map((r) => ({ city: r.city, area: r.area, n: r.sample_count,
                           over: r.pct_over_ask, stl: r.median_sale_to_list,
                           premium: r.median_premium }))
      );
      console.log('\n(dry-run — nothing written. Re-run with --apply)');
      return;
    }

    // Stamped BEFORE the write so the eviction below can distinguish rows this run refreshed
    // from cohorts that no longer qualify. A plain upsert never removes anything, which is how
    // superseded cohorts survive forever.
    //
    // This value is written into computed_at EXPLICITLY rather than letting the column default
    // to NOW(). The two are not interchangeable: NOW() is the database's clock and runAt is
    // this process's, so any forward skew on the client makes every freshly-written row look
    // older than runAt and the eviction below deletes the entire table. That is not
    // hypothetical — the first version of this job did exactly that ("upserted 1,158, evicted
    // 1,158, table now: 0 cells"). Write the same instant you filter on.
    const runAt = new Date().toISOString();
    let written = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const vals: unknown[] = [];
      const tuples = batch.map((r, k) => {
        const b = k * 14;
        vals.push(r.city, r.area, r.property_group, r.pct_over_ask, r.pct_at_ask,
                  r.pct_under_ask, r.median_sale_to_list, r.median_premium, r.median_discount,
                  r.pct_cut_before_sale, r.yoy_over_ask_pts, r.sample_count, r.prior_sample,
                  runAt);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14})`;
      });
      await c.query(
        `INSERT INTO sale_competition_stats
           (city, area, property_group, pct_over_ask, pct_at_ask, pct_under_ask,
            median_sale_to_list, median_premium, median_discount, pct_cut_before_sale,
            yoy_over_ask_pts, sample_count, prior_sample, computed_at)
         VALUES ${tuples.join(',')}
         ON CONFLICT (city, area, property_group) DO UPDATE SET
           pct_over_ask = EXCLUDED.pct_over_ask, pct_at_ask = EXCLUDED.pct_at_ask,
           pct_under_ask = EXCLUDED.pct_under_ask,
           median_sale_to_list = EXCLUDED.median_sale_to_list,
           median_premium = EXCLUDED.median_premium,
           median_discount = EXCLUDED.median_discount,
           pct_cut_before_sale = EXCLUDED.pct_cut_before_sale,
           yoy_over_ask_pts = EXCLUDED.yoy_over_ask_pts,
           sample_count = EXCLUDED.sample_count, prior_sample = EXCLUDED.prior_sample,
           computed_at = EXCLUDED.computed_at`,
        vals
      );
      written += batch.length;
    }

    const { rowCount: evicted } = await c.query(
      `DELETE FROM sale_competition_stats WHERE computed_at < $1`, [runAt]);

    console.log(`\n   upserted ${n(written)} cells, evicted ${n(evicted ?? 0)} stale`);
    const { rows: [tot] } = await c.query(
      `SELECT count(*)::int AS cells,
              count(*) FILTER (WHERE yoy_over_ask_pts IS NOT NULL)::int AS with_yoy,
              count(*) FILTER (WHERE sample_count >= 100)::int AS rankable
         FROM sale_competition_stats`);
    console.log(`   table now: ${n(tot.cells)} cells · ${n(tot.with_yoy)} with YoY · ${n(tot.rankable)} rankable`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e?.message || e); process.exit(1); });
