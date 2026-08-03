/**
 * Targeted photo repair for named ListingKeys — the "fix THIS listing now" path.
 *
 * The nightly reconciliation (Query A2) walks the whole empty-media set on a
 * rotating cursor, so a specific blank listing may be weeks away from its turn.
 * This script skips the queue: it re-fetches /Media for exactly the keys you name
 * and re-runs them through the SAME ETL upsert the daily sync uses (processBatch),
 * so Supabase `media_urls` and the Typesense doc both land consistently.
 *
 * It inherits the size-variant fallback in mediaEnrichment.ts, so it also recovers
 * listings whose photos AMPRE only generated at Large/Largest/Thumbnail — the class
 * the old Medium-only query wrote off as permanently photo-less.
 *
 * Dry-run by DEFAULT: without --apply it reports what it would recover and writes
 * nothing. Best-effort per key — one bad key never aborts the rest.
 *
 * Compliance: media records are stored verbatim, never LLM-transformed (§4); only
 * watermarked size variants are ever requested (§6.3(c)); no schema is altered.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts X13163816
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts X13163816 W12345678 --apply
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PROPTX_IDX_TOKEN,
 *      PROPTX_VOW_TOKEN, TYPESENSE_ADMIN_API_KEY (processBatch builds a Typesense
 *      admin client at module load and hard-throws without it — CLAUDE.md §12).
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { enrichListingsWithMedia } from '../worker/mediaEnrichment';
import { processBatch } from '../worker/sync';

const APPLY = process.argv.includes('--apply');
const KEYS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

if (KEYS.length === 0) {
  console.error('Usage: npx tsx scripts/admin/repairListingMedia.ts <ListingKey> [<ListingKey>...] [--apply]');
  process.exit(1);
}

interface Outcome {
  key: string;
  before: number;
  found: number;
  status: 'recovered' | 'already-had-photos' | 'no-photos-at-any-size' | 'not-in-listings' | 'write-failed';
  detail?: string;
}

(async () => {
  const idxToken = process.env.PROPTX_IDX_TOKEN;
  if (!idxToken) {
    console.error('❌ PROPTX_IDX_TOKEN is not set — /Media cannot be queried.');
    process.exit(1);
  }
  const supabase = getServiceRoleClient();

  console.log(`\n🔧 Media repair for ${KEYS.length} listing(s) — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: rows, error } = await supabase
    .from('listings')
    .select('listing_key, media_urls, full_payload')
    .in('listing_key', KEYS);

  if (error) {
    console.error(`❌ Supabase read failed: ${error.message}`);
    process.exit(1);
  }

  const byKey = new Map<string, any>();
  for (const r of rows ?? []) byKey.set(r.listing_key as string, r);

  const outcomes: Outcome[] = [];

  for (const key of KEYS) {
    const row = byKey.get(key);
    if (!row) {
      outcomes.push({ key, before: 0, found: 0, status: 'not-in-listings' });
      continue;
    }
    const before = Array.isArray(row.media_urls) ? row.media_urls.length : 0;
    const payload = row.full_payload as Record<string, unknown> | null;
    if (!payload || !payload.ListingKey) {
      outcomes.push({ key, before, found: 0, status: 'not-in-listings', detail: 'row has no usable full_payload' });
      continue;
    }

    // Mutates `payload` in place by attaching `media`. Walks Medium → Large →
    // Largest → Thumbnail, so a listing with no Medium variant still resolves.
    await enrichListingsWithMedia([payload], idxToken);
    const found = Array.isArray((payload as any).media) ? (payload as any).media.length : 0;

    if (found === 0) {
      outcomes.push({
        key,
        before,
        found,
        status: before > 0 ? 'already-had-photos' : 'no-photos-at-any-size',
      });
      continue;
    }
    if (!APPLY) {
      outcomes.push({ key, before, found, status: 'recovered', detail: 'dry run — nothing written' });
      continue;
    }

    // Same upsert path as the daily sync: Supabase row + Typesense doc together, so
    // the card thumbnail and the detail gallery can't disagree.
    const result = await processBatch([payload]);
    if (!result.success) {
      const errs = [...result.supabase.errors, ...result.typesense.errors];
      outcomes.push({ key, before, found, status: 'write-failed', detail: errs.slice(0, 2).join('; ') });
      continue;
    }
    outcomes.push({ key, before, found, status: 'recovered' });
  }

  console.log('\n── results ──');
  for (const o of outcomes) {
    const icon =
      o.status === 'recovered' ? '✅' : o.status === 'already-had-photos' ? '·' : o.status === 'write-failed' ? '❌' : '⚠️ ';
    console.log(
      `${icon} ${o.key.padEnd(12)} before=${String(o.before).padStart(3)} found=${String(o.found).padStart(3)}  ${o.status}` +
        (o.detail ? `  (${o.detail})` : '')
    );
  }

  const recovered = outcomes.filter((o) => o.status === 'recovered').length;
  console.log(
    `\n${APPLY ? 'Wrote' : 'Would write'} photos for ${recovered}/${KEYS.length} listing(s).` +
      (APPLY ? '' : ' Re-run with --apply to persist.')
  );
  // Non-zero only on a genuine write failure — "this listing truly has no photos" is
  // a valid answer, not an error, and must not fail the CI job.
  process.exit(outcomes.some((o) => o.status === 'write-failed') ? 1 : 0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
