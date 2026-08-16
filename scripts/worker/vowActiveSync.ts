/**
 * Ingest ACTIVE listings that arrive on the VOW datafeed but not on IDX.
 *
 * THE GAP THIS CLOSES
 * ingester.ts Query A reads the IDX feed only. Measured against the live feeds
 * 2026-08-09: VOW carries 112,680 Active listings, IDX 96,275 — a 16,405 listing hole
 * (9,755 of them For Sale). Those homes are invisible on PureProperty. W13584216
 * (86-2945 Thomas St, asking $599,000 since Jul 20) is in none of our stores while
 * competitors show it.
 *
 * COMPLIANCE — READ BEFORE CHANGING ANYTHING HERE
 * The licence attaches to the FEED, not the listing status. The PROPTX VOW Datafeed
 * Agreement defines a VOW as a "secure password-protected internet website" and permits
 * display of VOW Listing Information "on the Member's VOW … solely for the purpose of
 * use by Consumers". An Active listing delivered over VOW is VOW Listing Information
 * exactly as a sold one is. Therefore rows written here:
 *   - land in `vow_active_listings`, never in `listings` (structural separation), and
 *   - sit behind RLS with no policies, so the anon key cannot read them at all, and
 *   - must never reach an anonymous render path, a sitemap, or a search engine.
 * Anything beyond an existence teaser (status + property type + blurred photo) requires
 * a signed-in consumer who has accepted the VOW terms.
 *
 * OFF BY DEFAULT. Set VOW_ACTIVES_ENABLED=true to run. Until the VOW URL registration
 * (audit R7) covers the production host, leave it unset.
 *
 * Usage:
 *   VOW_ACTIVES_ENABLED=true npx tsx scripts/worker/vowActiveSync.ts             # delta
 *   VOW_ACTIVES_ENABLED=true npx tsx scripts/worker/vowActiveSync.ts --reconcile # sweep
 *   npx tsx scripts/worker/vowActiveSync.ts --dry-run                            # report
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';
import { fetchMediaForKeys } from './mediaEnrichment';

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();
const VOW_TOKEN = (process.env.PROPTX_VOW_TOKEN || '').trim();
const CURSOR_ID = 'vow_active';
const PAGE = 100; // AMPRE caps $top at 100
const DEFAULT_SINCE = '2020-01-01T00:00:00Z';

const DRY = process.argv.includes('--dry-run');
const RECONCILE = process.argv.includes('--reconcile');
const ENABLED = String(process.env.VOW_ACTIVES_ENABLED ?? '').toLowerCase() === 'true';

const maxPagesArg = process.argv.indexOf('--max-pages');
const MAX_PAGES = maxPagesArg > -1 ? Number(process.argv[maxPagesArg + 1]) : 200;

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchJson<T>(url: string, token: string, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
};

interface VowActiveRow {
  listing_key: string;
  property_hash: string;
  full_payload: Record<string, unknown>;
  media_urls: string[];
  city: string | null;
  city_region: string | null;
  property_sub_type: string | null;
  transaction_type: string | null;
  standard_status: string | null;
  mls_status: string | null;
  list_price: number | null;
  unparsed_address: string | null;
  unit_number: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  original_entry_timestamp: string | null;
  modification_timestamp: string | null;
  last_seen_at: string;
  synced_at: string;
}

/** Feed row → table row. Field-by-field (CLAUDE.md §6 — never spread into an upsert). */
function toRow(raw: Record<string, unknown>, nowIso: string): VowActiveRow | null {
  const key = str(raw.ListingKey) || str(raw.ListingId);
  if (!key) return null;
  return {
    listing_key: key,
    property_hash: generatePropertyHash(raw) || '',
    full_payload: raw,
    media_urls: [], // filled by the /Media pass after the page is assembled

    city: str(raw.City),
    city_region: str(raw.CityRegion),
    property_sub_type: str(raw.PropertySubType),
    transaction_type: str(raw.TransactionType),
    standard_status: str(raw.StandardStatus),
    mls_status: str(raw.MlsStatus),
    list_price: num(raw.ListPrice),
    unparsed_address: str(raw.UnparsedAddress),
    unit_number: str(raw.UnitNumber) ?? str(raw.ApartmentNumber),
    postal_code: str(raw.PostalCode),
    latitude: num(raw.Latitude),
    longitude: num(raw.Longitude),
    original_entry_timestamp: str(raw.OriginalEntryTimestamp),
    modification_timestamp: str(raw.ModificationTimestamp),
    last_seen_at: nowIso,
    synced_at: nowIso,
  };
}

async function readCursor(db: SupabaseClient): Promise<string> {
  const { data } = await db.from('sync_state').select('last_sync_timestamp').eq('id', CURSOR_ID).maybeSingle();
  return (data?.last_sync_timestamp as string) || DEFAULT_SINCE;
}

async function writeCursor(db: SupabaseClient, iso: string, status: string, records: number) {
  await db.from('sync_state').upsert(
    {
      id: CURSOR_ID,
      last_sync_timestamp: iso,
      sync_type: 'delta',
      records_synced: records,
      status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

/**
 * Which of these keys did IDX already give us? Answered from OUR OWN vault, not by
 * enumerating the IDX feed.
 *
 * The first version walked the IDX feed with $orderby + $skip to build a key set. Two
 * things were wrong with that: it capped at 5,000 keys when the feed carries 96,275 (so
 * almost every IDX listing would have been misfiled as VOW-only and wrongly gated), and
 * ingester.ts:738 explicitly warns that $skip is unreliable on AMPRE for deep paging.
 * `listings` IS the record of what IDX gave us, it is indexed by listing_key, and one
 * query per 100-row page is cheap.
 */
async function keysAlreadyFromIdx(db: SupabaseClient, keys: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  if (!keys.length) return found;
  const { data, error } = await db.from('listings').select('listing_key').in('listing_key', keys);
  if (error) throw new Error(`IDX membership check failed: ${error.message}`);
  for (const r of data ?? []) found.add(String(r.listing_key));
  return found;
}

async function runDelta(db: SupabaseClient) {
  let cursor = await readCursor(db);
  console.log(`  cursor: ${cursor}`);
  let total = 0;
  let skippedIdx = 0;
  let pages = 0;

  // A listing already in `listings` came from IDX and is served by the normal path.
  // Ingesting it here would duplicate it AND wrongly subject public IDX data to the
  // VOW gate — checked per page against our own vault.
  for (; pages < MAX_PAGES; pages++) {
    const filter = `StandardStatus eq 'Active' and ModificationTimestamp gt ${cursor}`;
    const url =
      `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
      `&$orderby=${encodeURIComponent('ModificationTimestamp asc')}&$top=${PAGE}`;
    const json = await fetchJson<{ value?: Array<Record<string, unknown>> }>(url, VOW_TOKEN);
    const batch = json.value ?? [];
    if (batch.length === 0) {
      console.log('  caught up.');
      break;
    }

    const nowIso = new Date().toISOString();
    const batchKeys = batch.map((r) => str(r.ListingKey) || str(r.ListingId)).filter(Boolean) as string[];
    const idxKeys = await keysAlreadyFromIdx(db, batchKeys);
    const rows: VowActiveRow[] = [];
    for (const raw of batch) {
      const key = str(raw.ListingKey) || str(raw.ListingId);
      if (key && idxKeys.has(key)) {
        skippedIdx++;
        continue;
      }
      const row = toRow(raw, nowIso);
      if (row) rows.push(row);
    }

    // Photos. The teaser shown to anonymous visitors is a BLURRED thumbnail, so a
    // listing with no media has nothing to blur and renders as a grey box. Media lives
    // on the separate /Media resource (the Property endpoint rejects $expand=Media on
    // this feed — ingester.ts:610), and fetchMediaForKeys already handles the chunking,
    // watermark-size preference and per-key failure isolation. Best-effort: a media
    // failure must never fail the ingest, so the row still lands with no photos and the
    // next pass can fill them.
    if (rows.length) {
      try {
        const { media } = await fetchMediaForKeys(rows.map((r) => r.listing_key), VOW_TOKEN);
        for (const row of rows) {
          const urls = (media.get(row.listing_key) ?? [])
            .map((m) => m.MediaURL)
            .filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
          if (urls.length) row.media_urls = urls;
        }
      } catch (err) {
        console.warn(`  media fetch failed for this page (continuing): ${err instanceof Error ? err.message : err}`);
      }
    }

    if (rows.length && !DRY) {
      const { error } = await db.from('vow_active_listings').upsert(rows, { onConflict: 'listing_key' });
      if (error) throw new Error(`upsert failed: ${error.message}`);
    }
    total += rows.length;

    // Advance to the last row's ModificationTimestamp. Same-second boundary rows are
    // re-fetched next page and upsert idempotently, so nothing is lost or doubled.
    const last = batch[batch.length - 1];
    const nextCursor = str(last.ModificationTimestamp);
    if (!nextCursor || nextCursor === cursor) {
      console.log('  cursor did not advance — stopping to avoid a loop.');
      break;
    }
    cursor = nextCursor;
    console.log(`  page ${pages + 1}: +${rows.length} VOW-only (skipped ${skippedIdx} IDX) → ${cursor}`);
    if (batch.length < PAGE) break;
  }

  if (!DRY) await writeCursor(db, cursor, 'completed', total);
  console.log(`\n  ingested ${total} VOW-only actives over ${pages} page(s)${DRY ? ' (DRY-RUN, nothing written)' : ''}`);
}

/**
 * Full sweep: delete local rows the feed no longer reports as Active. A delta sync only
 * ever sees CHANGED listings, so last_seen_at cannot be used to age rows out — an
 * unchanged-but-still-live listing would be reaped. Only a full key set can decide.
 */
async function runReconcile(db: SupabaseClient) {
  console.log('  fetching the full Active key set from VOW …');
  const live = new Set<string>();
  let skip = 0;
  for (let page = 0; page < 2000; page++) {
    const url =
      `${API_BASE_URL}/Property?$filter=${encodeURIComponent(`StandardStatus eq 'Active'`)}` +
      `&$orderby=${encodeURIComponent('ListingKey asc')}&$top=100&$skip=${skip}&$select=ListingKey`;
    const j = await fetchJson<{ value?: Array<{ ListingKey?: string }> }>(url, VOW_TOKEN);
    const rows = j.value ?? [];
    for (const r of rows) if (r.ListingKey) live.add(r.ListingKey);
    if (rows.length < 100) break;
    skip += 100;
    if (page % 50 === 0) console.log(`    … ${live.size} keys`);
  }
  console.log(`  feed reports ${live.size} Active listings`);

  const { data } = await db.from('vow_active_listings').select('listing_key');
  const localKeys = (data ?? []).map((r) => String(r.listing_key));
  const stale = localKeys.filter((k) => !live.has(k));
  console.log(`  local rows: ${localKeys.length}  stale: ${stale.length}`);

  if (stale.length && !DRY) {
    for (let i = 0; i < stale.length; i += 500) {
      const { error } = await db.from('vow_active_listings').delete().in('listing_key', stale.slice(i, i + 500));
      if (error) throw new Error(`delete failed: ${error.message}`);
    }
    console.log(`  removed ${stale.length} listings no longer Active`);
  } else if (stale.length) {
    console.log(`  DRY-RUN — would remove ${stale.length}`);
  }
}

async function main() {
  console.log('========================================');
  console.log('  VOW-only ACTIVE listing sync');
  console.log(`  Mode: ${RECONCILE ? 'RECONCILE' : 'DELTA'}${DRY ? ' (DRY-RUN)' : ''}`);
  console.log('========================================\n');

  if (!ENABLED && !DRY) {
    console.log('  VOW_ACTIVES_ENABLED is not "true" — refusing to write.');
    console.log('  This feed is VOW Listing Information: it may only be shown to signed-in');
    console.log('  consumers, and the VOW URL registration (audit R7) must cover the');
    console.log('  production host first. Re-run with --dry-run to inspect safely.');
    return;
  }
  if (!VOW_TOKEN) {
    console.error('  PROPTX_VOW_TOKEN is not set.');
    process.exitCode = 1;
    return;
  }

  const db = sb();
  if (RECONCILE) await runReconcile(db);
  else await runDelta(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
