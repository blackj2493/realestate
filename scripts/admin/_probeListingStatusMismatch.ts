/**
 * Probe: why does a listing still render "For Sale" on /properties/<key>?
 *
 * Prints the four places a listing's status lives, side by side, plus what
 * resolveListingStatus() (the detail page's ONLY status input) makes of it:
 *
 *   1. The VOW feed, per key       — ground truth, right now
 *   2. `listings` (Supabase)       — what the detail page actually serves
 *   3. `raw_vow_sold`              — the close record, if Query B ever saw one
 *   4. `raw_vow_delisted`          — the de-list record, if Query C ever saw one
 *
 * A row where the feed says a conditional/terminal status but the resolver still
 * returns `{ kind: "active" }` is a RENDER gap, not an ingest gap — no cursor
 * reset will fix it.
 *
 * Usage: npx tsx scripts/admin/_probeListingStatusMismatch.ts <ListingKey> [...]
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { resolveListingStatus } from '../../src/lib/property/listingStatus';

const API_BASE_URL = 'https://query.ampre.ca/odata';

async function fetchFromFeed(key: string, token: string): Promise<Record<string, unknown> | null> {
  const filter = encodeURIComponent(`ListingKey eq '${key}'`);
  const res = await fetch(`${API_BASE_URL}/Property?$filter=${filter}&$top=1`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    console.error(`   ⚠️  feed HTTP ${res.status} ${res.statusText}`);
    return null;
  }
  const body = await res.json();
  return body?.value?.[0] ?? null;
}

async function probe(key: string): Promise<void> {
  const supabase = getServiceRoleClient();
  console.log(`\n${'═'.repeat(64)}\n🔍 ${key}\n${'═'.repeat(64)}`);

  // 1. Feed ground truth (VOW serves both active and closed).
  const vowToken = (process.env.PROPTX_VOW_TOKEN || '').trim();
  let feed: Record<string, unknown> | null = null;
  if (!vowToken) {
    console.log('1. FEED            : (PROPTX_VOW_TOKEN unset — skipped)');
  } else {
    feed = await fetchFromFeed(key, vowToken);
    console.log(
      feed
        ? `1. FEED            : StandardStatus=${feed.StandardStatus} MlsStatus=${feed.MlsStatus} ` +
          `ListPrice=${feed.ListPrice} ClosePrice=${feed.ClosePrice ?? '—'} ` +
          `PurchaseContractDate=${feed.PurchaseContractDate ?? '—'} Mod=${feed.ModificationTimestamp}`
        : '1. FEED            : NOT SERVED (absent from the feed entirely)'
    );
  }

  // 2. `listings` — the row the detail page renders from.
  const { data: row, error } = await supabase
    .from('listings')
    .select('listing_key, status, list_price, is_orphaned, last_seen_at, updated_at, full_payload')
    .eq('listing_key', key)
    .maybeSingle();
  if (error) throw new Error(`listings read: ${error.message}`);
  if (!row) {
    console.log('2. listings        : NO ROW');
  } else {
    const payload = (row.full_payload ?? {}) as Record<string, unknown>;
    console.log(
      `2. listings        : status=${row.status} list_price=${row.list_price} ` +
        `is_orphaned=${row.is_orphaned} last_seen_at=${row.last_seen_at} updated_at=${row.updated_at}`
    );
    console.log(
      `   full_payload    : StandardStatus=${payload.StandardStatus} MlsStatus=${payload.MlsStatus}`
    );
  }

  // 3 + 4. The two archives Query B / Query C own.
  const { data: sold } = await supabase
    .from('raw_vow_sold')
    .select('listing_key, close_price, close_date, purchase_contract_date')
    .eq('listing_key', key)
    .maybeSingle();
  console.log(
    sold
      ? `3. raw_vow_sold    : close_price=${sold.close_price} close_date=${sold.close_date} contract=${sold.purchase_contract_date}`
      : '3. raw_vow_sold    : NO ROW (Query B never recorded a close)'
  );

  const { data: delisted } = await supabase
    .from('raw_vow_delisted')
    .select('listing_key, mls_status, delisted_date, list_price, days_on_market')
    .eq('listing_key', key)
    .maybeSingle();
  console.log(
    delisted
      ? `4. raw_vow_delisted: mls_status=${delisted.mls_status} delisted_date=${delisted.delisted_date}`
      : '4. raw_vow_delisted: NO ROW (Query C never recorded a de-list)'
  );

  // 5. The verdict the detail page actually renders.
  if (row) {
    const payload = (row.full_payload ?? {}) as Record<string, unknown>;
    const resolved = resolveListingStatus(
      payload,
      delisted
        ? {
            mls_status: delisted.mls_status,
            delisted_date: delisted.delisted_date,
            days_on_market: delisted.days_on_market,
            list_price: delisted.list_price,
          }
        : null,
      { orphaned: row.is_orphaned === true, lastSeen: null }
    );
    console.log(`\n➡️  resolveListingStatus → ${JSON.stringify(resolved)}`);

    const feedMls = String(feed?.MlsStatus ?? '').toLowerCase().trim();
    if (resolved.kind === 'active' && feedMls && !['new', 'active', 'price change', 'extension'].includes(feedMls)) {
      console.log(
        `\n🚨 RENDER GAP: the feed says MlsStatus="${feed?.MlsStatus}" but the page renders a\n` +
          `   plain For Sale listing. This is NOT an ingest failure — the payload is correct\n` +
          `   and current; resolveListingStatus has no branch for this status.`
      );
    }
  }
}

async function main(): Promise<void> {
  const keys = process.argv.slice(2).filter((a: string) => !a.startsWith('--'));
  if (keys.length === 0) {
    console.error('Usage: npx tsx scripts/admin/_probeListingStatusMismatch.ts <ListingKey> [...]');
    process.exit(1);
  }
  for (const key of keys) await probe(key);
  console.log();
}

main().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
