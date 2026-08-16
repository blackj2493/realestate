/**
 * Calibrate the metres-vs-feet fallback in livingArea.ts against GROUND TRUTH.
 *
 * `RoomLengthWidthUnits` is declared by the feed on roughly a fifth of rooms. That
 * subset is the only ground truth available for the unit question, so this samples
 * live /PropertyRooms records, keeps the listings that declare a unit, and scores
 * each candidate heuristic against the declaration.
 *
 * Why it matters: guessing wrong scales a listing's whole living area by 10.7639,
 * which drives its AVM value, Deal Score and $/sqft.
 *
 * The incumbent rule is `max(edge) > 25 => feet`, evaluated across ALL rooms of a
 * listing — so a single outlier dimension flips the entire listing. The candidate
 * is the same test on the MEDIAN edge, which no single row can move.
 *
 * Usage: npx tsx scripts/admin/calibrateRoomUnits.ts [sampleSize]
 */
import 'dotenv/config';
import { Client } from 'pg';

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const TOKEN = (process.env.PROPTX_IDX_TOKEN || '').trim();
const SAMPLE = parseInt(process.argv[2] || '1200', 10);
const CHUNK = 25;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;
const n = (x: number) => x.toLocaleString('en-US');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Normalise the feed's unit string to 'feet' | 'meters' | null. */
function declaredUnit(rooms: AnyObj[]): 'feet' | 'meters' | null {
  const vals = new Set(
    rooms.map((r) => String(r.RoomLengthWidthUnits ?? '').trim().toLowerCase()).filter(Boolean)
  );
  if (vals.size !== 1) return null; // absent, or mixed within one listing → unusable
  const v = [...vals][0];
  if (v.startsWith('m')) return 'meters';
  if (v.startsWith('f')) return 'feet';
  return null;
}

async function main() {
  if (!TOKEN) { console.error('❌ PROPTX_IDX_TOKEN not set'); process.exit(1); }

  const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  await pg.query("SET statement_timeout TO '600s'");

  // Sample across the whole median-edge spectrum, deliberately over-weighting the
  // listings the incumbent rule flips — those are where the two rules disagree and
  // where a wrong answer is most expensive.
  console.log(`Selecting ~${n(SAMPLE)} listings (over-sampling the disputed band)…`);
  const { rows: picked } = await pg.query(
    `WITH edges AS (
       SELECT l.listing_key,
              GREATEST((r->>'RoomLength')::numeric, (r->>'RoomWidth')::numeric) AS e
       FROM listings l, LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(l.full_payload->'rooms')='array'
                   THEN l.full_payload->'rooms' ELSE '[]'::jsonb END) r
       WHERE (r->>'RoomLength') ~ '^[0-9.]+$' AND (r->>'RoomWidth') ~ '^[0-9.]+$'
         AND (r->>'RoomLength')::numeric > 0 AND (r->>'RoomWidth')::numeric > 0
     ), per AS (
       SELECT listing_key, max(e) AS max_e,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY e) AS med_e,
              count(*) AS n_rooms
       FROM edges GROUP BY 1 HAVING count(*) >= 4
     )
     (SELECT listing_key FROM per WHERE max_e > 25 ORDER BY random() LIMIT $1)
     UNION
     (SELECT listing_key FROM per WHERE max_e <= 25 ORDER BY random() LIMIT $2)`,
    [Math.floor(SAMPLE / 2), Math.ceil(SAMPLE / 2)]
  );
  await pg.end();

  const keys: string[] = picked.map((r: AnyObj) => r.listing_key);
  console.log(`  ${n(keys.length)} keys. Fetching /PropertyRooms…`);

  const byKey = new Map<string, AnyObj[]>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const orFilter = `(${chunk.map((k) => `ListingKey eq '${k}'`).join(' or ')})`;
    let url: string | null =
      `${API_BASE_URL}/PropertyRooms?$filter=${encodeURIComponent(orFilter)}&$orderby=ListingKey,Order&$top=200`;
    while (url) {
      const res: AnyObj = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
      });
      if (!res.ok) break;
      const data: AnyObj = await res.json();
      for (const room of data.value || []) {
        const lk = room.ListingKey;
        if (!lk) continue;
        const arr = byKey.get(lk);
        if (arr) arr.push(room); else byKey.set(lk, [room]);
      }
      url = data['@odata.nextLink'] || null;
      await sleep(120);
    }
    if ((i / CHUNK) % 8 === 0) console.log(`   …${n(Math.min(i + CHUNK, keys.length))}/${n(keys.length)}`);
  }

  // Score every rule against the declared unit.
  const rules: Record<string, (edges: number[]) => 'feet' | 'meters'> = {
    'incumbent  max > 25': (e) => (Math.max(...e) > 25 ? 'feet' : 'meters'),
    'candidate  median > 10': (e) => (median(e) > 10 ? 'feet' : 'meters'),
    'candidate  median > 8': (e) => (median(e) > 8 ? 'feet' : 'meters'),
    'candidate  median > 12': (e) => (median(e) > 12 ? 'feet' : 'meters'),
    'valve      median > 16': (e) => (median(e) > 16 ? 'feet' : 'meters'),
    'valve      median > 20': (e) => (median(e) > 20 ? 'feet' : 'meters'),
    'valve      median > 25': (e) => (median(e) > 25 ? 'feet' : 'meters'),
    'baseline   always metric': () => 'meters',
  };
  const score: Record<string, { right: number; wrong: number; missFeet: number; missMet: number }> = {};
  for (const k of Object.keys(rules)) score[k] = { right: 0, wrong: 0, missFeet: 0, missMet: 0 };

  let truthed = 0, declaredFeet = 0, declaredMeters = 0;
  for (const [, rooms] of byKey) {
    const unit = declaredUnit(rooms);
    if (!unit) continue;
    const edges = rooms
      .filter((r) => Number(r.RoomLength) > 0 && Number(r.RoomWidth) > 0)
      .map((r) => Math.max(Number(r.RoomLength), Number(r.RoomWidth)));
    if (edges.length < 4) continue;
    truthed++;
    if (unit === 'feet') declaredFeet++; else declaredMeters++;

    for (const [name, fn] of Object.entries(rules)) {
      const guess = fn(edges);
      if (guess === unit) score[name].right++;
      else {
        score[name].wrong++;
        // A metric listing called "feet" divides GLA by 10.76 — the damaging direction.
        if (unit === 'meters') score[name].missMet++; else score[name].missFeet++;
      }
    }
  }

  console.log(`\nListings fetched: ${n(byKey.size)} · with a usable declared unit: ${n(truthed)}`);
  console.log(`Declared: ${n(declaredMeters)} meters · ${n(declaredFeet)} feet`);
  if (truthed < 20) {
    console.log('\n⚠️  Too few declared-unit listings to calibrate. Re-run with a larger sample.');
    return;
  }

  console.log('\nRule accuracy against the feed\'s own declaration:');
  console.log(`  ${'rule'.padEnd(26)} ${'correct'.padStart(9)} ${'wrong'.padStart(7)}  ${'metric→feet'.padStart(12)} ${'feet→metric'.padStart(12)}`);
  for (const [name, s] of Object.entries(score)) {
    const pct = ((100 * s.right) / truthed).toFixed(1);
    console.log(
      `  ${name.padEnd(26)} ${`${pct}%`.padStart(9)} ${String(s.wrong).padStart(7)}  ` +
      `${String(s.missMet).padStart(12)} ${String(s.missFeet).padStart(12)}`
    );
  }
  console.log('\n  metric→feet is the damaging error: it divides the listing\'s GLA by 10.76.');
}

main().catch((e) => { console.error('❌ Failed:', e?.message || e); process.exit(1); });
