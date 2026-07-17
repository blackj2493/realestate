// scripts/admin/capture-price-events.ts
/**
 * Nightly multi-cut price-ledger capture (migration 069). Diffs each active listing's
 * current list_price (flat column, NO detoast) against listing_price_state; on a change,
 * appends a price_events row and updates the state. New listings seed state silently
 * (no event). Prospective — the first run seeds ~all state with zero events; the ledger
 * accrues forward. Runs after the core sync in dailySync.ts so it sees fresh prices.
 *
 * Usage:
 *   npx tsx scripts/admin/capture-price-events.ts            # dry-run (no writes)
 *   npx tsx scripts/admin/capture-price-events.ts --apply    # write events + state
 */
import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) { console.error('❌ No DATABASE_URL'); process.exit(1); }
const APPLY = process.argv.includes('--apply');
const PAGE = 5000;

interface Row { listing_key: string; list_price: string; city: string | null; city_region: string | null; property_sub_type: string | null; property_hash: string | null }

async function main() {
  const c = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 15000, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log(`✅ connected — capture-price-events (${APPLY ? 'APPLY' : 'DRY-RUN'})`);

  // Baseline: last-known price per listing.
  const state = new Map<string, number>();
  const st = await c.query(`SELECT listing_key, last_price FROM listing_price_state`);
  for (const r of st.rows) state.set(r.listing_key, Number(r.last_price));
  console.log(`   state loaded: ${state.size} listings`);

  let lastKey = '';
  let seen = 0, changed = 0, seeded = 0;
  for (;;) {
    const page = await c.query<Row>(
      `SELECT listing_key, list_price, city, city_region, property_sub_type, property_hash
       FROM listings
       WHERE list_price >= 50000 AND ($1 = '' OR listing_key > $1)
       ORDER BY listing_key LIMIT ${PAGE}`, [lastKey]);
    if (page.rows.length === 0) break;
    lastKey = page.rows[page.rows.length - 1].listing_key;
    seen += page.rows.length;

    // Event rows (price changed) and state upserts (changed + new).
    const evLk: string[] = [], evPh: (string | null)[] = [], evOld: number[] = [], evNew: number[] = [], evCi: (string | null)[] = [], evCr: (string | null)[] = [], evSt: (string | null)[] = [];
    const upLk: string[] = [], upPr: number[] = [], upPh: (string | null)[] = [], upCi: (string | null)[] = [], upCr: (string | null)[] = [], upSt: (string | null)[] = [];
    for (const row of page.rows) {
      const price = Number(row.list_price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const prior = state.get(row.listing_key);
      if (prior != null && prior !== price) {
        changed++;
        evLk.push(row.listing_key); evPh.push(row.property_hash); evOld.push(prior); evNew.push(price);
        evCi.push(row.city); evCr.push(row.city_region); evSt.push(row.property_sub_type);
        upLk.push(row.listing_key); upPr.push(price); upPh.push(row.property_hash); upCi.push(row.city); upCr.push(row.city_region); upSt.push(row.property_sub_type);
      } else if (prior == null) {
        seeded++;
        upLk.push(row.listing_key); upPr.push(price); upPh.push(row.property_hash); upCi.push(row.city); upCr.push(row.city_region); upSt.push(row.property_sub_type);
      }
      state.set(row.listing_key, price);
    }

    if (APPLY && evLk.length > 0) {
      await c.query(
        `INSERT INTO price_events (listing_key, property_hash, event_date, old_price, new_price, delta, city, city_region, property_sub_type)
         SELECT lk, ph, current_date, op, np, np - op, ci, cr, st
         FROM unnest($1::text[], $2::text[], $3::numeric[], $4::numeric[], $5::text[], $6::text[], $7::text[]) AS t(lk, ph, op, np, ci, cr, st)
         ON CONFLICT (listing_key, event_date, new_price) DO NOTHING`,
        [evLk, evPh, evOld, evNew, evCi, evCr, evSt]);
    }
    if (APPLY && upLk.length > 0) {
      await c.query(
        `INSERT INTO listing_price_state (listing_key, last_price, property_hash, city, city_region, property_sub_type)
         SELECT lk, pr, ph, ci, cr, st
         FROM unnest($1::text[], $2::numeric[], $3::text[], $4::text[], $5::text[], $6::text[]) AS t(lk, pr, ph, ci, cr, st)
         ON CONFLICT (listing_key) DO UPDATE SET
           last_price = EXCLUDED.last_price, property_hash = EXCLUDED.property_hash,
           city = EXCLUDED.city, city_region = EXCLUDED.city_region,
           property_sub_type = EXCLUDED.property_sub_type, updated_at = now()`,
        [upLk, upPr, upPh, upCi, upCr, upSt]);
    }
    if (page.rows.length < PAGE) break;
  }

  console.log(`\n${APPLY ? '✅' : '(dry-run)'} seen ${seen} active listings · ${changed} price changes${APPLY ? ' recorded' : ''} · ${seeded} newly tracked`);
  if (!APPLY) console.log('   Re-run with --apply to write events + state.');
  await c.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌ failed:', e?.message || e); process.exit(1); });
