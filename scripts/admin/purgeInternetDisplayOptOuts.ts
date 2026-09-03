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
 *   listings.full_payload    → the `properties` collection + the listing page
 *   raw_vow_sold.raw_payload → the `sold_listings` collection
 *
 * `raw_vow_delisted` is NOT a source here, and cannot be: migration 035 gave it no
 * raw_payload column on purpose (a slim 12-month archive; the full payload stays
 * fetchable from the feed). So there is nothing in that table to read a flag off.
 * De-listed keys are still covered, because the vault keeps a `listings` row for every
 * status — that row carries the payload, and the query below reads it. The gate in
 * extractDelistedRecord is what keeps new opt-outs out of the archive in the first place.
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
        // NOT 'id'. Typesense rejects it outright — "Cannot use `id` as a query by
        // field" — and the first version of this script swallowed that 400 per chunk,
        // found zero documents, and printed a confident "nothing to remove" while
        // deleting nothing. query_by is only required syntactically here; q:'*' means
        // it is never actually queried, so any indexed string field in BOTH
        // collections does. `City` is one.
        query_by: 'City',
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
  await c.end();

  const ts = tsClient();

  // `properties` — the terminal and the search index.
  const propsKeys = [...fromListings];
  const propsLive = propsKeys.length ? await presentInCollection(ts, PROPERTIES_COLLECTION, propsKeys) : [];
  console.log(`\n${PROPERTIES_COLLECTION}: ${propsLive.length} opted-out document(s) live`);
  if (propsLive.length) console.log(`  ${propsLive.slice(0, 20).join(', ')}${propsLive.length > 20 ? ' …' : ''}`);

  // `sold_listings` — the public /address page. The sold vault plus every opted-out
  // `listings` row, which is how de-listed keys reach this set (see the header).
  const soldKeys = [...new Set([...fromSold, ...fromListings])];
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

  // Delete against the FULL candidate set from Postgres, never the presence-checked
  // subset. The presence check exists to report a number; if it breaks again, the delete
  // must not quietly become a no-op with it. Deleting an id the collection does not hold
  // is free — filter_by matches nothing and num_deleted counts only real removals, which
  // is the honest figure either way.
  const removedProps = propsKeys.length ? await deleteFromCollection(ts, PROPERTIES_COLLECTION, propsKeys) : 0;
  const removedSold = soldKeys.length ? await deleteFromCollection(ts, SOLD_LISTINGS_COLLECTION, soldKeys) : 0;
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
