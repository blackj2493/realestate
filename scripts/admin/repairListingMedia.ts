/**
 * Targeted photo repair — the "fix these listings now" path.
 *
 * The nightly reconciliation (Query A2) walks the empty-media set on a rotating cursor
 * under a per-night row budget, so a specific blank listing may be days away from its
 * turn. This script skips the queue: it re-fetches /Media for the keys you name — or,
 * with --all-empty, for every listing whose gallery is blank — and re-runs them through
 * the SAME ETL upsert the daily sync uses (processBatch), so Supabase `media_urls` and
 * the Typesense doc both land consistently.
 *
 * It inherits the size-variant fallback in mediaEnrichment.ts, so it also recovers
 * listings whose photos AMPRE only generated at Large/Largest/Thumbnail — the class the
 * old Medium-only query wrote off as permanently photo-less.
 *
 * NOT scripts/admin/backfillMedia.ts: that one patches `media` back into full_payload
 * with jsonb_set, which predates migrations 102/103 (payload slimming) and would
 * re-inflate the table. Everything here goes through processBatch, the canonical path.
 *
 * Dry-run by DEFAULT: without --apply it reports what it would recover and writes
 * nothing. Best-effort per chunk — one bad chunk never aborts the rest.
 *
 * Compliance: media records are stored verbatim, never LLM-transformed (§4); only
 * watermarked size variants are ever requested (§6.3(c)); no schema is altered.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts X13163816
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts X1316381 W1234567 --apply
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts --all-empty --apply
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts --all-empty --apply --no-revalidate
 *   npx tsx --env-file=.env.local scripts/admin/repairListingMedia.ts --all-empty --limit=500 --apply
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
const ALL_EMPTY = process.argv.includes('--all-empty');
const LIMIT = Math.max(0, Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]) || 0);
const NO_REVALIDATE = process.argv.includes('--no-revalidate');
const KEYS = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Listings enriched + upserted per round. enrichListingsWithMedia OR-batches 25 keys
// per /Media request internally, so 100 here is 4 upstream requests, not 100 — which is
// the whole reason this is chunked rather than per-key.
const CHUNK = 100;
// Keyset page for --all-empty. Served by idx_listings_empty_media (migration 108); the
// predicate below MUST stay identical to that index's, or the plan reverts to a 42.7s
// seq scan and this times out exactly like the nightly sweep did.
const SCAN_PAGE = 500;

if (KEYS.length === 0 && !ALL_EMPTY) {
  console.error(
    'Usage: npx tsx scripts/admin/repairListingMedia.ts <ListingKey>... [--apply]\n' +
      '       npx tsx scripts/admin/repairListingMedia.ts --all-empty [--limit=N] [--apply]'
  );
  process.exit(1);
}

interface Totals {
  considered: number;
  recovered: number;
  noPhotos: number;
  writeFailed: number;
  notFound: number;
  revalidated: number;
}

/** Every listing with a blank gallery, keyset-paginated by listing_key. */
async function collectEmptyKeys(supabase: any, cap: number): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '';
  for (;;) {
    const pageSize = cap ? Math.min(SCAN_PAGE, cap - keys.length) : SCAN_PAGE;
    if (pageSize <= 0) break;
    const { data, error } = await supabase
      .from('listings')
      .select('listing_key')
      .or('media_urls.is.null,media_urls.eq.{}')
      .gt('listing_key', cursor)
      .order('listing_key', { ascending: true })
      .limit(pageSize);
    if (error) throw new Error(`empty-media scan failed: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const r of rows) keys.push(r.listing_key as string);
    cursor = rows[rows.length - 1].listing_key as string;
    if (rows.length < pageSize) break;
  }
  return keys;
}

/**
 * Bust the per-listing data cache for keys we just repaired.
 *
 * The detail page is force-dynamic (per-request VOW gating), but getListingDetailCached
 * wraps the DATA in unstable_cache with revalidate: 3600. So a listing whose page was
 * rendered shortly BEFORE its repair keeps serving the empty gallery for up to an hour —
 * the row is fixed, the page still says "NO MEDIA". Verified on X10402479: 0 images
 * before the bust, rendering immediately after.
 *
 * Best-effort and non-fatal: without REVALIDATE_SECRET (or on any error) the cache simply
 * ages out on its own within the hour. Sequential on purpose — this hits production, and
 * a repair job has no business generating a burst of load against the live site.
 */
async function revalidateKeys(keys: string[]): Promise<number> {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || NO_REVALIDATE) return 0;
  const site = (process.env.NEXT_PUBLIC_SITE_URL || 'https://www.pureproperty.ca').replace(/\/$/, '');
  let busted = 0;
  for (const listingKey of keys) {
    try {
      const res = await fetch(`${site}/api/revalidate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
        body: JSON.stringify({ listingKey }),
      });
      if (res.ok) busted++;
    } catch {
      /* the 1h TTL is the backstop */
    }
  }
  return busted;
}

async function repairChunk(
  keys: string[],
  idxToken: string,
  supabase: any,
  totals: Totals
): Promise<void> {
  const { data: rows, error } = await supabase
    .from('listings')
    .select('listing_key, media_urls, full_payload')
    .in('listing_key', keys);
  if (error) {
    console.warn(`   ⚠️  read failed for a chunk of ${keys.length} (skipped): ${error.message}`);
    return;
  }

  const usable = (rows ?? []).filter((r: any) => r.full_payload?.ListingKey);
  totals.notFound += keys.length - usable.length;
  if (usable.length === 0) return;

  const payloads = usable.map((r: any) => r.full_payload);
  // Mutates each payload in place by attaching `media`. Walks Medium → Large →
  // Largest → Thumbnail, so a listing with no Medium variant still resolves.
  await enrichListingsWithMedia(payloads, idxToken);

  const gained = payloads.filter((p: any) => Array.isArray(p?.media) && p.media.length > 0);
  totals.noPhotos += payloads.length - gained.length;
  if (gained.length === 0) return;

  if (!APPLY) {
    totals.recovered += gained.length;
    return;
  }

  // Same upsert path as the daily sync: Supabase row + Typesense doc together, so the
  // card thumbnail and the detail gallery can't disagree.
  const result = await processBatch(gained);
  if (!result.success) {
    const errs = [...result.supabase.errors, ...result.typesense.errors];
    console.warn(`   ⚠️  upsert errors: ${errs.slice(0, 2).join('; ')}`);
    totals.writeFailed += gained.length;
    return;
  }
  totals.recovered += gained.length;
  totals.revalidated += await revalidateKeys(gained.map((p: any) => String(p.ListingKey)));
}

(async () => {
  const idxToken = process.env.PROPTX_IDX_TOKEN;
  if (!idxToken) {
    console.error('❌ PROPTX_IDX_TOKEN is not set — /Media cannot be queried.');
    process.exit(1);
  }
  const supabase = getServiceRoleClient();

  let targets = KEYS;
  if (ALL_EMPTY) {
    console.log('\n🔎 Scanning for listings with a blank gallery…');
    targets = await collectEmptyKeys(supabase, LIMIT);
    console.log(`   ${targets.length} listing(s) with no photos${LIMIT ? ` (capped at ${LIMIT})` : ''}.`);
  }

  if (targets.length === 0) {
    console.log('\n✅ Nothing to repair.');
    process.exit(0);
  }

  console.log(`\n🔧 Media repair for ${targets.length} listing(s) — ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const totals: Totals = { considered: targets.length, recovered: 0, noPhotos: 0, writeFailed: 0, notFound: 0, revalidated: 0 };
  for (let i = 0; i < targets.length; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    try {
      await repairChunk(chunk, idxToken, supabase, totals);
    } catch (e) {
      console.warn(`   ⚠️  chunk at ${i} failed (continuing): ${(e as Error)?.message ?? e}`);
      totals.writeFailed += chunk.length;
    }
    const done = Math.min(i + CHUNK, targets.length);
    console.log(
      `   ${done}/${targets.length} — recovered ${totals.recovered}, no photos ${totals.noPhotos}` +
        (totals.writeFailed ? `, write-failed ${totals.writeFailed}` : '')
    );
  }

  console.log('\n── summary ──');
  console.log(`  considered      : ${totals.considered}`);
  console.log(`  ${APPLY ? 'recovered' : 'would recover'} : ${totals.recovered}`);
  console.log(`  no photos at any size : ${totals.noPhotos}`);
  console.log(`  not in listings : ${totals.notFound}`);
  console.log(`  write failed    : ${totals.writeFailed}`);
  console.log(`  cache busted    : ${totals.revalidated}` + (NO_REVALIDATE ? ' (--no-revalidate)' : !process.env.REVALIDATE_SECRET ? ' (REVALIDATE_SECRET unset — pages refresh within 1h)' : ''));
  if (!APPLY) console.log('\nRe-run with --apply to persist.');

  // Non-zero only on a genuine write failure — "this listing truly has no photos" is a
  // valid answer, not an error, and must not fail the CI job.
  process.exit(totals.writeFailed > 0 ? 1 : 0);
})().catch((err) => {
  console.error('❌', err);
  process.exit(1);
});
