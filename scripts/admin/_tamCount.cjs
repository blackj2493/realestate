/**
 * TEMP read-only TAM count for the "Beat HouseSigma" beachhead gate.
 *
 * Answers: how many trailing-12mo 1-4 unit FREEHOLD sales happen in Brampton +
 * candidate overflow cities, and how many are observable FLIPS (same address bought
 * and resold within 2-36 months) — a data-driven flipper-activity floor, not a guess.
 *
 * Read-only. raw_vow_sold is never altered (CLAUDE.md §12). Deterministic, no LLM.
 * Aggregates only (counts/medians) — no raw listing rows leave the DB.
 *
 * IO note: one detoast pass extracts City from raw_payload JSONB into a TEMP table;
 * all subsequent aggregation is off that small temp table. statement_timeout lifted.
 *
 * Run: node scripts/admin/_tamCount.cjs
 */
require('dotenv').config({ path: ['.env.local', '.env'] });
const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL/DIRECT_DB_URL'); process.exit(1); }

// Verbatim raw_vow_sold.property_sub_type spellings = freehold 1-4 unit (NO condos/land).
// Trailing space on "Semi-Detached " is real (CLAUDE.md §6 / propertyTypes.ts).
const FREEHOLD = [
  'Detached',
  'Semi-Detached', 'Semi-Detached ',
  'Att/Row/Townhouse', 'Attached/Row/Street Townhouse',
  'Link',
  'Duplex', 'Triplex', 'Fourplex', 'Multiplex',
];

const TARGET = ['Brampton', 'Mississauga', 'Oshawa', 'Whitby', 'Ajax', 'Pickering',
  'Caledon', 'Milton', 'Hamilton', 'Markham', 'Vaughan', 'Richmond Hill', 'Toronto'];

// purchase_contract_date is already a DATE column in raw_vow_sold.
const SAFE_D = 'purchase_contract_date::date';

(async () => {
  const c = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 20000 });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log('connected; building temp freehold table (one detoast pass)...\n');

  // ── Q0: overall subtype distribution (top-level, cheap) ──────────────────────
  const subs = await c.query(
    `SELECT property_sub_type AS s, count(*)::int AS n
     FROM raw_vow_sold GROUP BY 1 ORDER BY 2 DESC LIMIT 25`);
  console.log('=== raw_vow_sold subtype distribution (top 25) ===');
  for (const r of subs.rows) console.log(`  ${String(r.n).padStart(8)}  [${r.s}]`);

  // ── Build temp table: freehold sales with City extracted once ────────────────
  await c.query(
    `CREATE TEMP TABLE fs AS
       SELECT property_hash AS h,
              raw_payload->>'City' AS city,
              ${SAFE_D} AS d,
              close_price::numeric AS price
       FROM raw_vow_sold
       WHERE property_sub_type = ANY($1::text[])
         AND close_price::numeric > 50000
         AND ${SAFE_D} IS NOT NULL`,
    [FREEHOLD]);
  await c.query('CREATE INDEX ON fs (city)');
  await c.query('CREATE INDEX ON fs (h)');
  const span = (await c.query('SELECT count(*)::int n, min(d) mn, max(d) mx FROM fs')).rows[0];
  console.log(`\n=== temp freehold table: ${span.n} rows, dates ${span.mn?.toISOString?.().slice(0,10)} .. ${span.mx?.toISOString?.().slice(0,10)} ===`);

  // ── Q1: freehold sales by year (recency / lag check) ─────────────────────────
  const yr = await c.query(
    `SELECT extract(year from d)::int y, count(*)::int n FROM fs GROUP BY 1 ORDER BY 1`);
  console.log('\n=== freehold sales by year (all GTA in archive) ===');
  for (const r of yr.rows) console.log(`  ${r.y}: ${r.n}`);

  // ── Q2: per-city freehold sold counts (trailing windows) ─────────────────────
  const byCity = await c.query(
    `SELECT city,
            count(*) FILTER (WHERE d >= CURRENT_DATE - 365)::int AS last365,
            count(*) FILTER (WHERE d >= CURRENT_DATE - 730)::int AS last730,
            count(*)::int AS alltime
     FROM fs
     WHERE city = ANY($1::text[])
     GROUP BY city`,
    [TARGET]);
  const cityMap = {};
  for (const r of byCity.rows) cityMap[r.city] = r;

  // ── Q3: observed flips per target city (resold 2-36mo apart) ─────────────────
  const flips = await c.query(
    `SELECT a.city,
            count(*)::int AS flip_pairs_alltime,
            count(*) FILTER (WHERE b.d >= CURRENT_DATE - 365)::int AS flip_sold_last365,
            count(DISTINCT a.h)::int AS distinct_flip_props
     FROM fs a JOIN fs b
       ON a.h = b.h AND b.d > a.d AND (b.d - a.d) BETWEEN 60 AND 1095
     WHERE a.city = ANY($1::text[])
     GROUP BY a.city`,
    [TARGET]);
  const flipMap = {};
  for (const r of flips.rows) flipMap[r.city] = r;

  // ── Report ───────────────────────────────────────────────────────────────────
  console.log('\n=== TARGET CITIES — freehold (1-4u) sold volume + observed flips ===');
  console.log('city            sold/365   sold/730   flips/365  flips(all)  distinctFlipProps');
  for (const city of TARGET) {
    const cm = cityMap[city] || {}; const fm = flipMap[city] || {};
    console.log(
      city.padEnd(15) +
      String(cm.last365 ?? 0).padStart(8) +
      String(cm.last730 ?? 0).padStart(11) +
      String(fm.flip_sold_last365 ?? 0).padStart(11) +
      String(fm.flip_pairs_alltime ?? 0).padStart(12) +
      String(fm.distinct_flip_props ?? 0).padStart(18));
  }

  // ── Funnel for Brampton + best overflow (Mississauga) ────────────────────────
  function funnel(city) {
    const cm = cityMap[city] || {}; const fm = flipMap[city] || {};
    const soldYr = cm.last365 ?? 0;
    const flipsYr = fm.flip_sold_last365 ?? 0;
    console.log(`\n--- ${city} funnel ---`);
    console.log(`  MEASURED: ${soldYr} freehold sales / trailing 365d`);
    console.log(`  MEASURED: ${flipsYr} observed resale-flips / trailing 365d (bought+resold 2-36mo)`);
    // Investor-share path (assumption-driven, for cross-check)
    for (const inv of [0.10, 0.15, 0.20]) {
      const investorTx = Math.round(soldYr * inv);
      const flipperShare = 0.30; // of investors, the value-add/flipper sub-segment
      const flipperTx = Math.round(investorTx * flipperShare);
      console.log(`  assume ${inv*100}% investor share -> ~${investorTx} investor tx -> ~${flipperTx} value-add/flipper tx`);
    }
    // Flip-data path (preferred): realized flips understate value-add (BRRRR refis don't resell)
    for (const mult of [1.5, 2.0, 2.5]) {
      const valueAddTx = Math.round(flipsYr * mult);
      console.log(`  flip-data x${mult} (BRRRR uplift) -> ~${valueAddTx} value-add tx/yr`);
    }
    // Unique reachable operators (deals/operator/yr ~1.5; switchable-to-solo-weekend-agent ~10%)
    const valueAddMid = Math.round(flipsYr * 2.0);
    const uniqueOperators = Math.round(valueAddMid / 1.5);
    for (const reach of [0.10, 0.20, 0.35]) {
      console.log(`  reachable+switchable ${reach*100}% of ~${uniqueOperators} operators -> ~${Math.round(uniqueOperators*reach)} serviceable`);
    }
  }
  funnel('Brampton');
  funnel('Mississauga');
  funnel('Oshawa');

  await c.end();
  console.log('\ndone.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
