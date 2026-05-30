/**
 * Read-only sampler for empty-media active listings — characterize WHY ~74k
 * active rows return no media from AMPRE (stale/expired lingering vs genuinely
 * photo-less). Light by design (small LIMIT, keyset by indexed listing_key) so
 * it doesn't fight a running backfill or blow the IO budget.
 *
 * Usage:
 *   npx tsx scripts/admin/sampleEmptyMedia.ts              # first 40
 *   npx tsx scripts/admin/sampleEmptyMedia.ts W 30         # 30 starting after key 'W'
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';

const START = process.argv[2] ?? '';
const LIMIT = Number(process.argv[3] ?? 40);

(async () => {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from('listings')
    .select('listing_key, property_sub_type, created_at, synced_at, full_payload')
    .or('media_urls.is.null,media_urls.eq.{}')
    .gt('listing_key', START)
    .order('listing_key', { ascending: true })
    .limit(LIMIT);
  if (error) {
    console.error('ERR:', error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  console.log(`Sampled ${rows.length} empty-media listings${START ? ` from >${START}` : ''}\n`);

  const tally = (m: Record<string, number>, k: string) => (m[k] = (m[k] || 0) + 1);
  const std: Record<string, number> = {};
  const mls: Record<string, number> = {};
  const sub: Record<string, number> = {};

  for (const r of rows) {
    const p: any = r.full_payload || {};
    tally(std, p.StandardStatus ?? '(none)');
    tally(mls, p.MlsStatus ?? '(none)');
    tally(sub, r.property_sub_type ?? p.PropertySubType ?? '(none)');
    console.log(
      `${String(r.listing_key).padEnd(11)} std=${String(p.StandardStatus ?? '').padEnd(11)} ` +
        `mls=${String(p.MlsStatus ?? '').padEnd(13)} sub=${String(r.property_sub_type ?? '').padEnd(13)} ` +
        `mod=${String(p.ModificationTimestamp ?? '').slice(0, 10)} ` +
        `entry=${String(p.OriginalEntryTimestamp ?? '').slice(0, 10)} ` +
        `exp=${String(p.ExpirationDate ?? '').slice(0, 10)} ` +
        `created=${String(r.created_at ?? '').slice(0, 10)} ` +
        `photoTs=${String(p.PhotosChangeTimestamp ?? '').slice(0, 10)}`
    );
  }

  console.log('\nStandardStatus:', JSON.stringify(std));
  console.log('MlsStatus     :', JSON.stringify(mls));
  console.log('SubType       :', JSON.stringify(sub));
  process.exit(0);
})();
