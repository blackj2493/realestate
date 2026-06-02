/**
 * Read-only probe for the Query A2 media-reconciliation candidate set.
 *
 * Replicates the EXACT keyset-paginated candidate scan the nightly reconciliation
 * uses (reconcileMissingMedia in scripts/worker/ingester.ts) — filter on created_at,
 * order by the indexed listing_key, page through every key — so we can verify it
 * reaches a given listing without any writes.
 *
 * Usage:
 *   npx tsx scripts/admin/checkEmptyMediaRecent.ts                 # total candidates + first keys
 *   npx tsx scripts/admin/checkEmptyMediaRecent.ts N13211856       # also confirm a specific key is reached
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';

const WINDOW_DAYS = 21;
const PAGE = 100;
const MAX = 1000; // matches MEDIA_RECONCILE_MAX
const EXPECT = process.argv[2]; // optional ListingKey to assert membership

(async () => {
  const supabase = getServiceRoleClient();
  const cutoffIso = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  let cursor = '';
  let total = 0;
  let found = false;
  const firstKeys: string[] = [];

  while (total < MAX) {
    const pageSize = Math.min(PAGE, MAX - total);
    const { data: rows, error } = await supabase
      .from('listings')
      .select('listing_key')
      .or('media_urls.is.null,media_urls.eq.{}')
      .gte('created_at', cutoffIso)
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);

    if (error) {
      console.error('ERR:', error.message);
      process.exit(1);
    }
    if (!rows || rows.length === 0) break;
    cursor = rows[rows.length - 1].listing_key;
    for (const r of rows) {
      total++;
      if (firstKeys.length < 10) firstKeys.push(r.listing_key);
      if (EXPECT && r.listing_key === EXPECT) found = true;
    }
    if (rows.length < pageSize) break;
  }

  console.log(`Recency window  : created_at >= ${cutoffIso} (${WINDOW_DAYS}d)`);
  console.log(`Candidates seen : ${total}${total >= MAX ? ` (capped at ${MAX})` : ''}`);
  console.log(`First 10 keys   : ${firstKeys.join(', ') || '(none)'}`);

  if (EXPECT) {
    console.log(`\n${EXPECT} reached by the scan? ${found ? '✅ YES' : '❌ NO'}`);
    if (!found) {
      const { data: one } = await supabase
        .from('listings')
        .select('listing_key, created_at, media_urls')
        .eq('listing_key', EXPECT)
        .maybeSingle();
      if (!one) console.log('   (not in listings table at all)');
      else
        console.log(
          `   row: created_at=${one.created_at} media_urls_len=${Array.isArray(one.media_urls) ? one.media_urls.length : '(not array)'}` +
            (new Date(one.created_at).toISOString() < cutoffIso ? '  → outside recency window' : '') +
            (total >= MAX ? '  → beyond the per-night cap' : '')
        );
    }
  }
  process.exit(0);
})();
