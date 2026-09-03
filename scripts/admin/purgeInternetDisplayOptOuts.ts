/**
 * Purge listings the seller opted OUT of internet display — and the canary that
 * proves none are left.
 *
 * The code gates added alongside this script stop an opted-out listing from ever
 * ENTERING the two Typesense collections again. They do nothing about the documents
 * already sitting there: an owner who opted out last month still has a live page
 * until something removes it. That is this script.
 *
 * Truth lives in Postgres, not in the index:
 *   listings.full_payload        → the `properties` collection + the listing page
 *   raw_vow_sold.raw_payload     → the `sold_listings` collection
 *   raw_vow_delisted.raw_payload → the `sold_listings` collection
 *
 * ONLY an explicit 'false' counts. A payload that never carried the field is not an
 * opt-out, and treating it as one would empty the index — see internetDisplay.ts.
 *
 * DRY RUN BY DEFAULT. It reports what it would delete and exits. Pass --apply to
 * delete. Run it with no flag after every sync as a canary: a healthy system prints
 * zero documents to remove, because the gates caught them upstream.
 *
 * Note: the flags live inside jsonb with no index, so each census query is a full
 * scan and takes minutes on `listings`. That is why this is an admin script and not
 * a request-path check.
 *
 * Usage:
 *   npx.cmd tsx --env-file=.env scripts/admin/purgeInternetDisplayOptOuts.ts
 *   npx.cmd tsx --env-file=.env scripts/admin/purgeInternetDisplayOptOuts.ts --apply
 */
import pg from 'pg';
import Typesense, { Client } from 'typesense';
import { SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';
import {
  INTERNET_DISPLAY_FIELD,
  INTERNET_ADDRESS_FIELD,
} from '@/lib/compliance/internetDisplay';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // Supabase pooler cert

const APPLY = process.argv.includes('--apply');
const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const PROPERTIES_COLLECTION = 'properties';
const DELETE_CHUNK = 100;

function tsClient(): Client {
  const apiKey = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!apiKey) throw new Error('TYPESENSE_ADMIN_API_KEY is not set');
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: 443, protocol: 'https' }],
    apiKey,
    connectionTimeoutSeconds: 120,
  });
}

/**
 * Keys whose payload carries an explicit No on either switch. The whole-listing
 * switch removes the listing everywhere; the address switch removes the /address
 * page, which is the only thing sold_listings feeds — so both matter to that
 * collection, and only the first matters to `properties`.
 */
async function optedOutKeys(
  c: pg.Client,
  table: string,
  payloadColumn: string,
  bothSwitches: boolean
): Promise<Set<string>> {
  const clause = bothSwitches
    ? `${payloadColumn}->>'${INTERNET_DISPLAY_FIELD}' = 'false'
       or ${payloadColumn}->>'${INTERNET_ADDRESS_FIELD}' = 'false'`
    : `${payloadColumn}->>'${INTERNET_DISPLAY_FIELD}' = 'false'`;
  const { rows } = await c.query(
    `select listing_key from ${table} where ${clause}`
  );
  return new Set(rows.map((r: { listing_key: string }) => r.listing_key));
}

/** Which of these ids the collection actually holds — the real exposure. */
async function presentInCollection(
  ts: Client,
  collection: string,
  keys: string[]
): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK);
    const res = await ts
      .collections(collection)
      .documents()
      .search({
        q: '*',
        query_by: 'id',
        filter_by: `id:=[${chunk.join(',')}]`,
        include_fields: 'id',
        per_page: DELETE_CHUNK,
      });
    for (const hit of res.hits ?? []) {
      const id = (hit.document as { id?: string }).id;
      if (id) found.push(id);
    }
  }
  return found;
}

async function deleteFromCollection(ts: Client, collection: string, keys: string[]): Promise<number> {
  let removed = 0;
  for (let i = 0; i < keys.length; i += DELETE_CHUNK) {
    const chunk = keys.slice(i, i + DELETE_CHUNK);
    const res: { num_deleted?: number } = await ts
      .collections(collection)
      .documents()
      .delete({ filter_by: `id:=[${chunk.join(',')}]` } as never);
    removed += res.num_deleted ?? 0;
  }
  return removed;
}

async function main() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(`set statement_timeout = '900s'`);

  console.log(APPLY ? '\n🔥 APPLY — documents will be deleted\n' : '\n🔎 DRY RUN — nothing will be deleted (pass --apply)\n');

  console.log('Reading opt-out flags from Postgres (full jsonb scan — minutes)...');
  const fromListings = await optedOutKeys(c, 'listings', 'full_payload', false);
  console.log(`  listings:         ${fromListings.size} opted out`);
  const fromSold = await optedOutKeys(c, 'raw_vow_sold', 'raw_payload', true);
  console.log(`  raw_vow_sold:     ${fromSold.size} opted out`);
  const fromDelisted = await optedOutKeys(c, 'raw_vow_delisted', 'raw_payload', true);
  console.log(`  raw_vow_delisted: ${fromDelisted.size} opted out`);
  await c.end();

  const ts = tsClient();

  // `properties` — the terminal and the search index.
  const propsKeys = [...fromListings];
  const propsLive = propsKeys.length ? await presentInCollection(ts, PROPERTIES_COLLECTION, propsKeys) : [];
  console.log(`\n${PROPERTIES_COLLECTION}: ${propsLive.length} opted-out document(s) live`);
  if (propsLive.length) console.log(`  ${propsLive.slice(0, 20).join(', ')}${propsLive.length > 20 ? ' …' : ''}`);

  // `sold_listings` — the public /address page. Fed by both vault tables.
  const soldKeys = [...new Set([...fromSold, ...fromDelisted, ...fromListings])];
  const soldLive = soldKeys.length ? await presentInCollection(ts, SOLD_LISTINGS_COLLECTION, soldKeys) : [];
  console.log(`${SOLD_LISTINGS_COLLECTION}: ${soldLive.length} opted-out document(s) live`);
  if (soldLive.length) console.log(`  ${soldLive.slice(0, 20).join(', ')}${soldLive.length > 20 ? ' …' : ''}`);

  if (!APPLY) {
    const total = propsLive.length + soldLive.length;
    console.log(
      total === 0
        ? '\n✅ Nothing to remove — the index gates are holding.\n'
        : `\n⚠️  ${total} document(s) would be deleted. Re-run with --apply.\n`
    );
    return;
  }

  const removedProps = propsLive.length ? await deleteFromCollection(ts, PROPERTIES_COLLECTION, propsLive) : 0;
  const removedSold = soldLive.length ? await deleteFromCollection(ts, SOLD_LISTINGS_COLLECTION, soldLive) : 0;
  console.log(`\n🗑️  Deleted ${removedProps} from ${PROPERTIES_COLLECTION}, ${removedSold} from ${SOLD_LISTINGS_COLLECTION}`);
  console.log(
    'The listing page reads Supabase, not the index — getListingDetail gates it ' +
      'separately, and its cache clears on the DETAIL_SHAPE_VERSION bump.\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
