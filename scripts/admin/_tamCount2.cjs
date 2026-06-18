/**
 * TEMP read-only TAM v2 — broader "all-investor" definition over a 4-market region.
 *
 * Segments the addressable pool (freehold houses / small multiplex / condos), applies
 * SEGMENT-WEIGHTED investor shares (multiplex ~always investor, condo ~30%, house ~12%),
 * cross-checks against observed flips, and runs a corrected commission-led income model.
 *
 * Read-only on raw_vow_sold (CLAUDE.md §12). Aggregates only. Deterministic, no LLM.
 * Run: node scripts/admin/_tamCount2.cjs
 */
require('dotenv').config({ path: ['.env.local', '.env'] });
const { Client } = require('pg');
const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('No DATABASE_URL'); process.exit(1); }

// Full investor-addressable subtype set (verbatim raw_vow_sold spellings).
const INVESTOR_SUBTYPES = [
  'Detached', 'Semi-Detached', 'Semi-Detached ', 'Att/Row/Townhouse',
  'Attached/Row/Street Townhouse', 'Link', 'Detached Condo', 'Semi-Detached Condo',
  'Duplex', 'Triplex', 'Fourplex', 'Multiplex',
  'Condo Apartment', 'Condo Townhouse', 'Common Element Condo',
  'Co-op Apartment', 'Co-Ownership Apartment', 'Leasehold Condo',
];

const CORE4 = ['Brampton', 'Hamilton', 'Mississauga', 'Oshawa'];
const ALL_TARGETS = [...new Set([...CORE4, 'Whitby', 'Ajax', 'Pickering', 'Milton',
  'Caledon', 'Vaughan', 'Markham', 'Richmond Hill'])];

const SEG_CASE =
  `CASE
     WHEN property_sub_type IN ('Duplex','Triplex','Fourplex','Multiplex') THEN 'multiplex'
     WHEN property_sub_type IN ('Condo Apartment','Condo Townhouse','Common Element Condo','Co-op Apartment','Co-Ownership Apartment','Leasehold Condo') THEN 'condo'
     ELSE 'freehold'
   END`;

// segment-weighted investor-share bands [low, base, high]
const SHARE = { freehold: [0.10, 0.12, 0.15], condo: [0.25, 0.30, 0.35], multiplex: [0.85, 0.90, 0.95] };
// corrected unit economics (red-team)
const PERSONAL_NET = 16000;   // blended buyer-side net under EXP 80/20-to-cap, value-add stock
const REFERRAL_NET = 4500;    // 25% co-op after receiving split + EXP cut
const PERSONAL_CAP = 8;       // nights/weekends calendar ceiling
const LEAD_TO_CLOSE = 0.25;   // warm investor lead -> close

(async () => {
  const c = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 20000 });
  await c.connect();
  await c.query("SET statement_timeout TO '0'");
  console.log('connected; building temp investor-addressable table (one detoast pass)...');

  await c.query(
    `CREATE TEMP TABLE inv AS
       SELECT property_hash AS h, raw_payload->>'City' AS city,
              purchase_contract_date::date AS d, close_price::numeric AS price, ${SEG_CASE} AS seg
       FROM raw_vow_sold
       WHERE property_sub_type = ANY($1::text[])
         AND close_price::numeric > 50000
         AND purchase_contract_date IS NOT NULL`,
    [INVESTOR_SUBTYPES]);
  await c.query('CREATE INDEX ON inv (city)');
  await c.query('CREATE INDEX ON inv (h)');
  const sp = (await c.query('SELECT count(*)::int n, min(d) mn, max(d) mx FROM inv')).rows[0];
  console.log(`temp table: ${sp.n} rows, ${sp.mn.toISOString().slice(0,10)}..${sp.mx.toISOString().slice(0,10)}\n`);

  // per-city per-seg sold trailing 365d + median price
  const seg = await c.query(
    `SELECT city, seg,
            count(*) FILTER (WHERE d >= CURRENT_DATE - 365)::int AS y,
            round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price) FILTER (WHERE d >= CURRENT_DATE - 365))::int AS med
     FROM inv WHERE city = ANY($1::text[]) GROUP BY city, seg`, [ALL_TARGETS]);
  // flips trailing 365d per city
  const flip = await c.query(
    `SELECT a.city, count(*) FILTER (WHERE b.d >= CURRENT_DATE - 365)::int AS f365
     FROM inv a JOIN inv b ON a.h=b.h AND b.d>a.d AND (b.d-a.d) BETWEEN 60 AND 1095
     WHERE a.city = ANY($1::text[]) GROUP BY a.city`, [ALL_TARGETS]);

  const tbl = {}; // city -> {freehold,condo,multiplex, med...}
  for (const r of seg.rows) { (tbl[r.city] ??= {})[r.seg] = r.y; (tbl[r.city]).__med ??= {}; tbl[r.city].__med[r.seg] = r.med; }
  const flipMap = {}; for (const r of flip.rows) flipMap[r.city] = r.f365;

  console.log('=== per-city investor-addressable sold/yr (trailing 365d) ===');
  console.log('city            freehold   condo   multiplex   flips/yr   medFreehold');
  for (const city of ALL_TARGETS) {
    const t = tbl[city] || {};
    console.log(city.padEnd(15) +
      String(t.freehold ?? 0).padStart(8) + String(t.condo ?? 0).padStart(9) +
      String(t.multiplex ?? 0).padStart(11) + String(flipMap[city] ?? 0).padStart(11) +
      ('$' + ((t.__med?.freehold ?? 0)).toLocaleString()).padStart(14));
  }

  // ── Combined CORE4 pool ───────────────────────────────────────────────────
  const sum = (seg) => CORE4.reduce((a, city) => a + ((tbl[city]?.[seg]) ?? 0), 0);
  const fh = sum('freehold'), cn = sum('condo'), mx = sum('multiplex');
  const flips = CORE4.reduce((a, city) => a + (flipMap[city] ?? 0), 0);
  const addressable = fh + cn + mx;
  console.log(`\n=== COMBINED CORE-4 (${CORE4.join(' + ')}) — trailing 365d ===`);
  console.log(`  freehold houses : ${fh}`);
  console.log(`  condos          : ${cn}`);
  console.log(`  small multiplex : ${mx}   (hard-investor product)`);
  console.log(`  TOTAL addressable: ${addressable} sales/yr`);
  console.log(`  observed flips   : ${flips}/yr (floor — undercounts; see caveats)`);

  // segment-weighted investor-transaction pool [low,base,high]
  const pool = [0, 1, 2].map(i => Math.round(fh * SHARE.freehold[i] + cn * SHARE.condo[i] + mx * SHARE.multiplex[i]));
  console.log(`\n=== INVESTOR-TRANSACTION POOL (segment-weighted share) ===`);
  console.log(`  low / base / high : ${pool[0]} / ${pool[1]} / ${pool[2]} investor tx/yr`);
  console.log(`  hard-investor floor (multiplex + flips): ${mx + flips}/yr`);
  const operatorsBase = Math.round(pool[1] / 1.5); // ~1.5 deals/operator/yr
  console.log(`  ~unique active investor-operators (base/1.5): ~${operatorsBase}`);

  // ── Corrected income model (capture = share of the pool you WIN, already net of conversion) ─
  console.log(`\n=== INCOME MODEL (base pool ${pool[1]} investor buy-side tx/yr) ===`);
  console.log('  capture   deals you win   you close(<=8)   referred   commission net');
  for (const cap of [0.005, 0.01, 0.015, 0.02, 0.03]) {
    const won = Math.round(pool[1] * cap);
    const personal = Math.min(won, PERSONAL_CAP);
    const referred = Math.max(0, won - PERSONAL_CAP);
    const commission = personal * PERSONAL_NET + referred * REFERRAL_NET;
    console.log(
      `  ${(cap*100).toFixed(1)}%`.padEnd(11) +
      String(won).padStart(8) + String(personal).padStart(15) + String(referred).padStart(11) +
      ('$' + commission.toLocaleString()).padStart(17));
  }
  console.log(`\n  + subscription floor (thin; NOT a pillar):`);
  for (const p of [0.05, 0.10, 0.15]) {
    const subs = Math.round(operatorsBase * p);
    console.log(`      ${(p*100).toFixed(0)}% of ~${operatorsBase} active operators = ${subs} subs @ $29/mo = $${(subs*29*12).toLocaleString()}/yr`);
  }
  console.log(`\n  unit econ: personal net $${PERSONAL_NET.toLocaleString()}/close (EXP 80/20-to-cap, ~$800K stock), referral net $${REFERRAL_NET.toLocaleString()}/close, cap ${PERSONAL_CAP} personal closes/yr`);

  await c.end();
  console.log('\ndone.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
