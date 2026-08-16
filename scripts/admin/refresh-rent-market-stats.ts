/**
 * Refresh rent_market_stats (migration 119) — closed-rent aggregates for /data/rents.
 *
 * WHY A TRACKER AT ALL: nobody in Canada publishes what a HOUSE actually rents for.
 * TRREB's rental report is condo apartments only; the rental portals carry ASKING rents,
 * not what the lease closed at; CMHC covers purpose-built stock annually. We hold the
 * closed lease price for houses and condos by neighbourhood, which is why property_group
 * is a dimension here rather than a filter.
 *
 * DONE IN SQL, NOT IN JS. The sibling refresh-condo-fee-stats.ts paginates rows into
 * memory because it needs per-building trend assembly. This job is a pure aggregation over
 * ~264k lease rows, so one server-side statement is both far cheaper on IO (nothing crosses
 * the wire but the finished cells) and shorter than the pagination it would otherwise need.
 *
 * GROUPING SETS computes the per-bedroom rows and the 'ALL' rollup in a single pass over
 * the window — the alternative is scanning the same rows twice for numbers that must agree.
 *
 * HONESTY RULES BAKED IN, not left to the UI:
 *   • MEDIAN never mean — one $14k executive lease moves an average and misleads.
 *   • yoy_pct is written ONLY when the current AND prior windows both clear MIN_YOY_SAMPLE,
 *     so a thin prior year cannot manufacture a headline percentage.
 *   • Cells below MIN_SAMPLE are not stored at all. The board can then show every row it
 *     receives, marking thin ones with their n rather than rendering a dash.
 *   • median_bedrooms travels with every ALL row: a rent median across mixed bedroom counts
 *     is uninterpretable without it.
 *
 * Reads raw_vow_sold READ-ONLY (CLAUDE.md §12) and writes only rent_market_stats.
 *
 * Usage:
 *   npx tsx scripts/admin/refresh-rent-market-stats.ts            # dry-run, reports cells
 *   npx tsx scripts/admin/refresh-rent-market-stats.ts --apply
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const APPLY = process.argv.includes('--apply');

/** Below this a cell is not stored. 5 keeps genuinely thin neighbourhoods visible (marked
 *  with their n) without publishing a "median" drawn from two leases. */
const MIN_SAMPLE = 5;
/** A percentage change needs a firmer base than a level does — both windows must clear it. */
const MIN_YOY_SAMPLE = 20;
/** Guards against a lease price entered as an annual figure or a sale price. */
const RENT_FLOOR = 400;
const RENT_CEIL = 25_000;
/**
 * Reserved `city` for the province-wide rollup rows that feed the page's headline strip.
 * Not a TRREB city, so it cannot collide with a real one. Paired with area '' — the same
 * empty-area convention Waterloo/Brantford already use, and the board filters these out of
 * the neighbourhood table by this key.
 */
const PROVINCE_CITY = 'Ontario';

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL'); process.exit(1); }

const n = (x: number) => x.toLocaleString('en-US');

/** House = anything that is not a condo/apartment-style unit. Freehold houses are the cut
 *  no other Canadian source publishes, so the split is deliberate and load-bearing. */
const GROUP_EXPR = `CASE
    WHEN property_sub_type ILIKE '%condo%' OR property_sub_type ILIKE '%apartment%'
      OR property_sub_type ILIKE '%co-op%'  OR property_sub_type ILIKE '%co-own%'
    THEN 'Condo' ELSE 'House' END`;

/** 4 means "4 or more" — past four bedrooms the sample thins and the distinction stops
 *  mattering to a renter. Floored at 1 so a missing/zero bedroom count lands in the 1-bed
 *  band rather than creating a phantom 0-bed cohort. */
const BEDS_EXPR = `LEAST(GREATEST(COALESCE(bedrooms_above_grade,0) + COALESCE(bedrooms_below_grade,0), 1), 4)`;

const SQL = `
WITH base AS (
  SELECT
    city,
    -- The feed ships no CityRegion for Waterloo Region/Brantford. Empty string rolls those
    -- up under the city instead of dropping them from the tracker entirely.
    COALESCE(NULLIF(btrim(city_region), ''), '') AS area,
    ${GROUP_EXPR} AS property_group,
    ${BEDS_EXPR} AS beds,
    close_price::numeric AS rent,
    NULLIF(list_price, 0)::numeric AS ask,
    close_date
  FROM raw_vow_sold
  WHERE transaction_type IN ('For Lease','For Sub-Lease')
    AND close_date >  now() - interval '24 months'
    AND close_date <= now()
    AND close_price BETWEEN $1 AND $2
    AND city IS NOT NULL AND btrim(city) <> ''
),
cur AS (
  -- PROVINCE_CITY/'' rows come from the grouping sets that omit city+area, which leave both
  -- NULL. They are the headline strip: a median-of-medians across neighbourhoods would be
  -- statistically wrong, so the province figure is computed from the underlying leases in
  -- the same pass rather than derived from the rows below it.
  SELECT COALESCE(city, '${PROVINCE_CITY}') AS city,
         COALESCE(area, '') AS area,
         property_group,
         COALESCE(beds::text, 'ALL') AS bedrooms_band,
         count(*)::int AS sample_count,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY rent))::int AS median_rent,
         round(percentile_cont(0.25) WITHIN GROUP (ORDER BY rent))::int AS p25_rent,
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY rent))::int AS p75_rent,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY beds)::numeric, 1) AS median_bedrooms,
         round(100.0 * count(*) FILTER (WHERE ask IS NOT NULL AND rent < ask)
               / NULLIF(count(*) FILTER (WHERE ask IS NOT NULL), 0), 1) AS pct_below_ask,
         round(percentile_cont(0.5) WITHIN GROUP (ORDER BY ask - rent)
               FILTER (WHERE ask IS NOT NULL AND rent < ask))::int AS median_discount
    FROM base
   WHERE close_date > now() - interval '12 months'
   GROUP BY GROUPING SETS (
     (city, area, property_group, beds), (city, area, property_group),
     (property_group, beds), (property_group))
),
prior AS (
  SELECT COALESCE(city, '${PROVINCE_CITY}') AS city,
         COALESCE(area, '') AS area,
         property_group,
         COALESCE(beds::text, 'ALL') AS bedrooms_band,
         count(*)::int AS prior_sample,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY rent) AS prior_median
    FROM base
   WHERE close_date <= now() - interval '12 months'
   GROUP BY GROUPING SETS (
     (city, area, property_group, beds), (city, area, property_group),
     (property_group, beds), (property_group))
)
SELECT c.city, c.area, c.property_group, c.bedrooms_band,
       c.median_rent, c.p25_rent, c.p75_rent, c.median_bedrooms,
       c.pct_below_ask, c.median_discount,
       -- Both windows must be substantial before a percentage is published.
       -- ::numeric is required, not cosmetic: percentile_cont returns double precision and
       -- Postgres has no round(double precision, int) — only the numeric two-arg form.
       CASE WHEN c.sample_count >= $3 AND COALESCE(p.prior_sample,0) >= $3
                 AND p.prior_median > 0
            THEN round((100.0 * (c.median_rent - p.prior_median) / p.prior_median)::numeric, 2)
       END AS yoy_pct,
       c.sample_count,
       COALESCE(p.prior_sample, 0) AS prior_sample
  FROM cur c
  LEFT JOIN prior p
    ON p.city = c.city AND p.area = c.area
   AND p.property_group = c.property_group AND p.bedrooms_band = c.bedrooms_band
 WHERE c.sample_count >= $4
`;

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log(`connected — ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  try {
    const t0 = Date.now();
    const { rows } = await c.query(SQL, [RENT_FLOOR, RENT_CEIL, MIN_YOY_SAMPLE, MIN_SAMPLE]);
    console.log(`   computed ${n(rows.length)} cells in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    const all = rows.filter((r) => r.bedrooms_band === 'ALL');
    const withYoy = rows.filter((r) => r.yoy_pct !== null);
    console.log(`   ${n(all.length)} headline (ALL) rows · ${n(rows.length - all.length)} per-bedroom rows`);
    console.log(`   ${n(withYoy.length)} carry a year-over-year figure`);
    for (const g of ['House', 'Condo']) {
      const s = all.filter((r) => r.property_group === g);
      const thick = s.filter((r) => r.sample_count >= 20).length;
      console.log(`   ${g.padEnd(6)} ${String(s.length).padStart(5)} areas (${thick} at n>=20)`);
    }

    if (!APPLY) {
      console.table(
        all.filter((r) => r.property_group === 'House')
           .sort((a, b) => b.sample_count - a.sample_count)
           .slice(0, 10)
           .map((r) => ({ city: r.city, area: r.area, n: r.sample_count,
                          rent: r.median_rent, beds: r.median_bedrooms, yoy: r.yoy_pct }))
      );
      console.log('\n(dry-run — nothing written. Re-run with --apply)');
      return;
    }

    // Stamped BEFORE the write so eviction below can distinguish rows this run refreshed
    // from cohorts that no longer qualify. A plain upsert never removes anything, which is
    // how superseded cohorts survive forever in the sibling job.
    const runAt = new Date().toISOString();
    let written = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK);
      const vals: unknown[] = [];
      const tuples = batch.map((r, k) => {
        const b = k * 14;
        vals.push(r.city, r.area, r.property_group, r.bedrooms_band, r.median_rent, r.p25_rent,
                  r.p75_rent, r.median_bedrooms, r.pct_below_ask, r.median_discount, r.yoy_pct,
                  r.sample_count, r.prior_sample, runAt);
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11},$${b+12},$${b+13},$${b+14})`;
      });
      await c.query(
        `INSERT INTO rent_market_stats
           (city, area, property_group, bedrooms_band, median_rent, p25_rent, p75_rent,
            median_bedrooms, pct_below_ask, median_discount, yoy_pct, sample_count,
            prior_sample, computed_at)
         VALUES ${tuples.join(',')}
         ON CONFLICT (city, area, property_group, bedrooms_band) DO UPDATE SET
           median_rent = EXCLUDED.median_rent, p25_rent = EXCLUDED.p25_rent,
           p75_rent = EXCLUDED.p75_rent, median_bedrooms = EXCLUDED.median_bedrooms,
           pct_below_ask = EXCLUDED.pct_below_ask, median_discount = EXCLUDED.median_discount,
           yoy_pct = EXCLUDED.yoy_pct, sample_count = EXCLUDED.sample_count,
           prior_sample = EXCLUDED.prior_sample, computed_at = EXCLUDED.computed_at`,
        vals
      );
      written += batch.length;
    }

    const { rowCount: evicted } = await c.query(
      `DELETE FROM rent_market_stats WHERE computed_at < $1`, [runAt]);

    console.log(`\n   upserted ${n(written)} cells, evicted ${n(evicted ?? 0)} stale`);
    const { rows: [tot] } = await c.query(
      `SELECT count(*)::int AS cells,
              count(*) FILTER (WHERE bedrooms_band='ALL')::int AS headline,
              count(*) FILTER (WHERE yoy_pct IS NOT NULL)::int AS with_yoy
         FROM rent_market_stats`);
    console.log(`   table now: ${n(tot.cells)} cells · ${n(tot.headline)} headline · ${n(tot.with_yoy)} with YoY`);
  } finally {
    await c.end();
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error('failed:', e?.message || e); process.exit(1); });
