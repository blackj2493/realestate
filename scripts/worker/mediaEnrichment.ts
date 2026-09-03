/**
 * /Media enrichment — shared between the nightly ingester (per-batch attachment
 * onto active + sold listings) and any future backfill. Media records (photo
 * URLs + size variants) live in a SEPARATE RESO resource (/Media), NOT inline
 * in /Property. AMPRE does NOT support $expand=Media on Property (verified
 * 2026-05-27: returns HTTP 400 / OData error 1109 "The property 'Media' ... is
 * not defined in type 'Property'"), so we must batch-fetch Media after each
 * Property batch and attach it before transform.
 *
 * Mirrors roomsEnrichment.ts: self-contained on purpose so any backfill script
 * can use it without importing scripts/worker/sync.ts (which hard-throws on a
 * missing TYPESENSE_ADMIN_API_KEY at module load time).
 *
 * Token: passed in as a parameter — active sync uses PROPTX_IDX_TOKEN, sold
 * sync uses PROPTX_VOW_TOKEN. Both have access to /Media for properties they
 * can already see in /Property.
 */

// Safe against the self-containment note above: selectPrimaryImage is a pure module
// with no env reads and no side effects at import time — the thing being avoided is
// scripts/worker/sync.ts, which hard-throws on a missing TYPESENSE_ADMIN_API_KEY.
// soldIndexer.ts already imports from here.
import { storedPhotosToMediaItems, mediaUrlsToMediaItems } from '../../src/lib/etl/selectPrimaryImage';

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];

export const MEDIA_CHUNK_SIZE = 25;        // listing keys per /Media request
export const MEDIA_REQUEST_DELAY_MS = 300; // polite delay between requests
// AMPRE's /Media caps every response at 100 records and does NOT emit an
// @odata.nextLink, so we page explicitly with $skip (see fetchMediaForKeys).
const MEDIA_PAGE_SIZE = 100;

/**
 * Trimmed media record stored on raw_payload.media. Carries only fields
 * actually read by selectPrimaryImage, collectMediaUrls, and MediaGallery —
 * dropping ~10 unused fields keeps Supabase JSONB bloat manageable
 * (~30 photos × 100k listings would otherwise add gigabytes).
 */
export interface StoredMedia {
  MediaURL: string;
  MediaCategory?: string;
  MediaObjectID?: string;
  MediaKey?: string;
  ImageSizeDescription?: string;
  Order?: number;
  MediaStatus?: string;
  ShortDescription?: string;
}

interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  retries = MAX_RETRIES
): Promise<FetchResult<T>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...options.headers, Accept: 'application/json' },
      });

      if (response.status >= 500 && response.status < 600) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await sleep(retryAfter);
        continue;
      }

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
          statusCode: response.status,
        };
      }
      return { success: true, data };
    } catch (err: unknown) {
      lastError = err as Error;
      if (attempt < retries) {
        const retryAfter = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
        await sleep(retryAfter);
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${MAX_RETRIES} retries: ${lastError?.message || 'Unknown error'}`,
  };
}

function toStoredMedia(m: any): StoredMedia {
  return {
    MediaURL: m.MediaURL,
    MediaCategory: m.MediaCategory,
    MediaObjectID: m.MediaObjectID,
    MediaKey: m.MediaKey,
    ImageSizeDescription: m.ImageSizeDescription,
    Order: m.Order,
    MediaStatus: m.MediaStatus,
    ShortDescription: m.ShortDescription,
  };
}

// Lower = better. Mirrors src/lib/etl/selectPrimaryImage.ts but kept local so
// this file stays self-contained for the backfill use case. Sizes not listed
// here (in particular `LargestNoWatermark`) are filtered OUT entirely — see
// dedupe logic below — because §6.3(c) requires the brokerage watermark to be
// visible on every displayed image, and the NoWatermark variant strips it.
const SIZE_RANK_LOCAL: Record<string, number> = {
  Medium: 0,
  Large: 1,
  Largest: 2,
  Thumbnail: 3,
};

/**
 * AMPRE's /Media resource returns one row per (photo × size variant), so a
 * 20-photo listing yields ~100 records (5 sizes each: Thumbnail/Medium/Large/
 * Largest/LargestNoWatermark). Collapse them so each logical photo (keyed by
 * MediaObjectID) appears exactly once, at its best-available watermarked size:
 *
 *   - Drop ALL non-watermarked variants (compliance with §6.3(c)).
 *   - For each MediaObjectID, keep the size with the lowest SIZE_RANK_LOCAL.
 *   - Tie-break on lower Order (stability for the original listing order).
 *
 * Yields ~5× smaller raw_payload.media arrays and guarantees no NoWatermark
 * URLs ever reach Supabase / Typesense / the UI.
 */
function dedupeMediaByObject(records: any[]): any[] {
  const best = new Map<string, any>();
  let unkeyedCounter = 0;
  for (const m of records) {
    if (!m?.MediaURL) continue;
    const size = m.ImageSizeDescription;
    if (!(size in SIZE_RANK_LOCAL)) continue; // drops LargestNoWatermark + any unknown
    // Fall back to MediaKey then MediaURL if MediaObjectID is absent (it
    // shouldn't be on Photos, but be defensive — never key on a synthetic
    // counter unless absolutely necessary so identical photos still dedupe).
    const id = m.MediaObjectID || m.MediaKey || m.MediaURL || `__unkeyed_${unkeyedCounter++}`;
    const prev = best.get(id);
    if (!prev) {
      best.set(id, m);
      continue;
    }
    const newRank = SIZE_RANK_LOCAL[size];
    const prevRank = SIZE_RANK_LOCAL[prev.ImageSizeDescription as string] ?? 99;
    if (newRank < prevRank) best.set(id, m);
    else if (newRank === prevRank && (m.Order ?? Infinity) < (prev.Order ?? Infinity)) {
      best.set(id, m);
    }
  }
  return [...best.values()];
}

/**
 * Sizes we ask AMPRE for, in preference order — the SAME ranking as
 * SIZE_RANK_LOCAL / selectPrimaryImage, and deliberately excluding
 * `LargestNoWatermark` (§6.3(c): the brokerage watermark must stay visible).
 *
 * Only the first entry is used for the vast majority of listings. The rest are
 * fallbacks, tried one size at a time for the keys that came back with nothing —
 * see fetchMediaForKeys.
 */
const SIZE_PREFERENCE = ['Medium', 'Large', 'Largest', 'Thumbnail'] as const;

/**
 * Pages one OR-chunk of ListingKeys at ONE size variant, appending every record
 * onto `rawByKey`. Returns false when the fetch failed (≠ "fetched, 0 photos") —
 * the caller turns that into a failedKeys entry.
 *
 * Page with $skip — NOT @odata.nextLink. AMPRE's /Media caps each response at
 * MEDIA_PAGE_SIZE (100) records and does NOT return an @odata.nextLink, so the old
 * `while (url = nextLink)` loop ran exactly ONCE and captured only the first 100
 * records. A 25-key OR chunk ordered by ResourceRecordKey routinely exceeds 100
 * records (a handful of photo-heavy listings clears it), so every listing sorted
 * after the 100th came back with ZERO media and was persisted as a false
 * `media: []` — the root cause of the mass "NO MEDIA" gap. Explicit $skip offset
 * paging (AMPRE honours it with a stable $orderby — verified) walks every page
 * until a short page ends it.
 *
 * The ResourceName='Property' clause is REQUIRED by RESO spec — Media is a
 * polymorphic resource also used for Office/Member records, and omitting it would
 * mix in agent headshots and brokerage logos.
 */
async function fetchChunkAtSize(
  chunk: string[],
  size: string,
  token: string,
  rawByKey: Map<string, any[]>
): Promise<boolean> {
  const keyFilter = `(${chunk.map((k) => `ResourceRecordKey eq '${k}'`).join(' or ')})`;
  const orFilter = `${keyFilter} and ResourceName eq 'Property' and ImageSizeDescription eq '${size}'`;
  const encodedFilter = encodeURIComponent(orFilter);

  for (let skip = 0; ; skip += MEDIA_PAGE_SIZE) {
    const url =
      `${API_BASE_URL}/Media?$filter=${encodedFilter}` +
      `&$orderby=ResourceRecordKey,Order&$top=${MEDIA_PAGE_SIZE}&$skip=${skip}&$count=true`;
    const result: FetchResult<any> = await fetchWithRetry<any>(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!result.success || !result.data) {
      console.warn(`   ⚠️  Media chunk fetch failed at size=${size} (non-fatal): ${result.error}`);
      return false;
    }
    const records: any[] = result.data.value || [];
    for (const m of records) {
      const lk = m.ResourceRecordKey;
      if (!lk || !m.MediaURL) continue;
      const arr = rawByKey.get(lk);
      if (arr) arr.push(m);
      else rawByKey.set(lk, [m]);
    }
    if (records.length < MEDIA_PAGE_SIZE) break; // short page → no more rows
    await sleep(MEDIA_REQUEST_DELAY_MS);
  }
  return true;
}

/** Split a key list into OR-batched chunks of MEDIA_CHUNK_SIZE. */
function chunkKeys(keys: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MEDIA_CHUNK_SIZE) {
    chunks.push(keys.slice(i, i + MEDIA_CHUNK_SIZE));
  }
  return chunks;
}

/**
 * Fetches /Media for a set of ListingKeys. Returns BOTH the media map (sorted by
 * Order) AND the set of keys whose fetch FAILED — distinct from keys that were
 * fetched successfully but genuinely have zero photos.
 *
 * Why the distinction matters (the false-empty bug): callers used to treat
 * "absent from the map" as "no photos" and persist `media: []`. But a transient
 * AMPRE failure (rate-limit / network / brief outage) also leaves a key absent.
 * One flaky run over ~86k keys therefore manufactured tens of thousands of
 * permanent false-empties. Callers MUST skip writing an empty marker for any key
 * in `failedKeys` so it stays eligible for the next run / nightly sweep.
 *
 * ── Why the size filter, and why it now has a fallback ──
 * AMPRE generates up to 5 variants per photo (Thumbnail, Medium 960×960, Large,
 * Largest, LargestNoWatermark). Each variant gets its OWN MediaObjectID/MediaKey,
 * so there is no shared key linking them and client-side dedup-by-ID cannot
 * collapse a photo's variants — asking for every size would put the SAME photo in
 * media_urls up to 4 times. So we pin ONE size server-side per request.
 *
 * Medium is the right default: 960×960 covers card thumbnails and the gallery, and
 * it was verified present on the sampled listings. But "verified on a sample" is not
 * "guaranteed on every listing" — a listing whose photos AMPRE never generated a
 * Medium variant for returned zero records, and the caller then persisted
 * `media: []` FOREVER (nothing ever revisits a confirmed-empty listing at a
 * different size). That is a permanent blank gallery on a listing that has photos.
 *
 * So: after the Medium pass, any key that came back empty AND did not fail is
 * retried at Large, then Largest, then Thumbnail — one size at a time, so a key
 * still only ever collects a single variant per photo. Fallback requests are made
 * only for the keys that need them, which in practice is a small tail.
 *
 * Compliance: every size in SIZE_PREFERENCE has the brokerage watermark URL-baked
 * (the `wm:` + `wmt:` URL segments), satisfying §6.3(c). We never request
 * LargestNoWatermark, and dedupeMediaByObject drops it defensively even if the feed
 * volunteers one.
 */
/**
 * Only the first couple of photos can be the cover, so the cover-thumb pass asks
 * for `Order lt COVER_THUMB_MAX_ORDER` instead of every photo. Measured against
 * AMPRE 2026-09-02 on a 4-listing chunk: 100+ Thumbnail rows become 9.
 */
const COVER_THUMB_MAX_ORDER = 2;

/**
 * The COVER photo's 240px 'Thumbnail' URL for each key in one chunk.
 *
 * Why a separate pass rather than another size in the main walk: the main walk
 * feeds dedupeMediaByObject, which collapses each logical photo (keyed by
 * MediaObjectID) to its single best size — a Thumbnail record would be dropped
 * on sight because Medium outranks it, and forcing it through would put a 240px
 * URL into `media_urls` and therefore into the gallery. This map stays beside
 * the media array and only ever feeds the card thumbnail.
 *
 * Why it is worth a request at all: the ledger renders a 144x112 card from
 * `primaryImageUrl`, which is the 960x960 'Medium' variant — a median 155 KB for
 * a card that needs ~12 KB, and Next.js flags it as the LCP element on
 * /properties. The size is inside the imgproxy signature so the URL cannot be
 * rewritten (a hand-edited `rs:fit:288:288` returns 403); the small image only
 * exists as this separate URL. Measured on 120 live listings: 'Thumbnail' is
 * present on 100% of them at 240x160 and a median 12 KB — 92% smaller.
 *
 * Returns false ONLY on a fetch failure, and the caller deliberately does not
 * turn that into a failedKeys entry: a listing with photos but no cover thumb is
 * not a listing without photos, and every consumer already falls back to
 * `primaryImageUrl`. A missing thumb costs bytes, never correctness.
 */
async function fetchCoverThumbs(
  chunk: string[],
  token: string,
  out: Map<string, string>
): Promise<boolean> {
  const keyFilter = `(${chunk.map((k) => `ResourceRecordKey eq '${k}'`).join(' or ')})`;
  const filter =
    `${keyFilter} and ResourceName eq 'Property'` +
    ` and ImageSizeDescription eq 'Thumbnail' and Order lt ${COVER_THUMB_MAX_ORDER}`;
  const url =
    `${API_BASE_URL}/Media?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=ResourceRecordKey,Order&$top=${MEDIA_PAGE_SIZE}`;
  const result: FetchResult<any> = await fetchWithRetry<any>(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!result.success || !result.data) {
    console.warn(`   ⚠️  Cover-thumb fetch failed (non-fatal): ${result.error}`);
    return false;
  }
  // A listing can return several rows inside the Order window, so keep the
  // lowest Order — the same record selectPrimaryImage would call the cover.
  const bestOrder = new Map<string, number>();
  for (const m of (result.data.value || []) as any[]) {
    const lk = m?.ResourceRecordKey;
    if (!lk || !m.MediaURL || m.MediaStatus === 'Deleted') continue;
    const order = m.Order ?? Number.POSITIVE_INFINITY;
    const prev = bestOrder.get(lk);
    if (prev === undefined || order < prev) {
      bestOrder.set(lk, order);
      out.set(lk, m.MediaURL);
    }
  }
  return true;
}

/**
 * Cover thumbs ONLY, for the backfill — the live index predates the field and the
 * daily sync sets it just for listings it happens to touch.
 *
 * Deliberately not fetchMediaForKeys(): that walks every photo at Medium and pages
 * through 30+ records per listing, which for a ~100k-doc backfill is hours of
 * requests for data we already hold. This is one bounded request per 25 keys.
 *
 * Best-effort per chunk, like the sync path: a chunk that fails is simply missing
 * from the returned map, so the caller writes nothing and the card keeps falling
 * back to primaryImageUrl. Re-running picks the stragglers up.
 */
export async function fetchCoverThumbsForKeys(
  keys: string[],
  token: string
): Promise<Map<string, string>> {
  const thumbs = new Map<string, string>();
  if (!token || keys.length === 0) return thumbs;
  for (const chunk of chunkKeys(keys)) {
    await fetchCoverThumbs(chunk, token, thumbs);
    await sleep(MEDIA_REQUEST_DELAY_MS);
  }
  return thumbs;
}

export async function fetchMediaForKeys(
  keys: string[],
  token: string
): Promise<{ media: Map<string, StoredMedia[]>; failedKeys: Set<string>; thumbs: Map<string, string> }> {
  const grouped = new Map<string, StoredMedia[]>();
  const failedKeys = new Set<string>();
  // Cover-photo 240px URLs, keyed by ListingKey. Additive: absent = fall back.
  const thumbs = new Map<string, string>();
  if (!token || keys.length === 0) return { media: grouped, failedKeys, thumbs };

  // Accumulate raw media (with Order) so we sort per listing after grouping.
  const rawByKey = new Map<string, any[]>();

  const [primarySize, ...fallbackSizes] = SIZE_PREFERENCE;

  for (const chunk of chunkKeys(keys)) {
    // Mark every key in a failed chunk a FETCH FAILURE (≠ "fetched, 0 photos").
    // Keys that did page in media are cleared from failedKeys after the loop
    // (see the grouped-keys sweep below).
    if (!(await fetchChunkAtSize(chunk, primarySize, token, rawByKey))) {
      for (const k of chunk) failedKeys.add(k);
    }
    // Cover thumbs ride the same chunking. A failure here is swallowed on
    // purpose — see fetchCoverThumbs: no thumb is a bandwidth cost, not a
    // missing listing, so it must never mark the chunk failed.
    await fetchCoverThumbs(chunk, token, thumbs);
  }

  // Fallback pass — ONLY the keys the primary size found nothing for, and only
  // those we actually got a clean answer about (a failed key is "unknown", and
  // re-probing it at another size would just burn requests on an outage).
  for (const size of fallbackSizes) {
    const stillEmpty = keys.filter((k) => !rawByKey.has(k) && !failedKeys.has(k));
    if (stillEmpty.length === 0) break;
    for (const chunk of chunkKeys(stillEmpty)) {
      if (!(await fetchChunkAtSize(chunk, size, token, rawByKey))) {
        // Unknown, not empty: leave the key recoverable on a later run rather
        // than letting a mid-fallback outage manufacture a fresh false-empty.
        for (const k of chunk) failedKeys.add(k);
      }
    }
    const recovered = stillEmpty.filter((k) => rawByKey.has(k)).length;
    if (recovered > 0) {
      console.log(`   🖼️  Recovered ${recovered} listing(s) with no Medium variant at size=${size}`);
    }
  }

  for (const [lk, items] of rawByKey) {
    // Dedupe to one record per logical photo, dropping NoWatermark variants.
    const collapsed = dedupeMediaByObject(items);
    collapsed.sort((a, b) => (a.Order ?? Number.POSITIVE_INFINITY) - (b.Order ?? Number.POSITIVE_INFINITY));
    grouped.set(lk, collapsed.map(toStoredMedia));
  }
  // A key that returned media (despite a later-page failure in its chunk) is NOT
  // a failure — only keys we ended up with nothing for stay flagged.
  for (const lk of grouped.keys()) failedKeys.delete(lk);
  return { media: grouped, failedKeys, thumbs };
}

/**
 * Restore previously-stored media onto listings whose new /Media fetch
 * returned empty. Mutates `listings` in place; returns the number of
 * listings whose media was restored from the DB.
 *
 * Why this exists — sync clobber protection:
 *   enrichListingsWithMedia is best-effort. A transient AMPRE error (rate
 *   limit, network hiccup, brief outage) leaves the affected listings with
 *   `media = []`. sync.ts then writes the full raw object to
 *   listings.full_payload via UPSERT, which REPLACES the entire JSONB
 *   column — wiping any media a prior successful sync or the manual
 *   backfill had populated. Run cumulatively, this slowly erodes coverage.
 *
 * Strategy: for listings whose current `media` is empty/missing, batch-
 * fetch the EXISTING `media` JSONB sub-tree from Supabase and restore it
 * onto the listing. The transformer downstream re-derives `media_urls`
 * via collectMediaUrls(), so both columns stay consistent.
 *
 * Tradeoff: we'll preserve stale URLs for listings whose photos AMPRE
 * legitimately removed (e.g. Closed listings). That's preferable to
 * clobbering real photos when AMPRE hiccups, because:
 *  - Closed listings aren't shown on the active dashboard
 *  - Stale CDN URLs eventually 404 → ListingThumbnail falls back to text
 *  - The alternative (write empty on any AMPRE failure) is unrecoverable
 *
 * Best-effort: a lookup failure is logged but never throws.
 *
 * Parameterized for active (`listings` / `full_payload`) and sold
 * (`raw_vow_sold` / `raw_payload`) paths.
 */
export async function preserveExistingMedia(
  listings: any[],
  // Loosely typed to avoid importing the full Supabase client type into
  // this self-contained worker module; only `.from().select().in()` used.
  supabase: any,
  table: 'listings' | 'raw_vow_sold' = 'listings',
  payloadColumn: 'full_payload' | 'raw_payload' = 'full_payload'
): Promise<number> {
  const emptyKeys = listings
    .filter((l) => !Array.isArray(l?.media) || l.media.length === 0)
    .map((l) => l?.ListingKey)
    .filter(Boolean);

  if (emptyKeys.length === 0) return 0;

  try {
    // Sold rows keep their photos in the flat `photos` column (migration 101), not in
    // raw_payload->media, so the recovery source differs per table. Active rows still
    // read the payload sub-tree. Either way this is a narrow projection — no
    // full-payload detoast.
    // Both tables now recover from a flat column rather than a JSONB sub-tree:
    // sold from `photos` (migration 101), active from `media_urls` (migration 103).
    // media_urls is what the UI renders from anyway, so restoring it is exactly what
    // the clobber protection is there to save.
    const fromPhotosColumn = table === 'raw_vow_sold';
    const select = fromPhotosColumn ? 'listing_key, photos' : 'listing_key, media_urls';
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in('listing_key', emptyKeys);

    if (error || !data) {
      console.warn(
        `   ⚠️  Media preservation lookup failed (non-fatal): ${error?.message || 'no data'}`
      );
      return 0;
    }

    const existingByKey = new Map<string, StoredMedia[]>();
    for (const row of data as Array<{ listing_key: string; media_urls?: unknown; photos?: unknown }>) {
      // Both inflate back to the feed's MediaItem shape, so downstream
      // (collectMediaUrls / selectPrimaryImage) is unchanged either way.
      const media = (fromPhotosColumn
        ? storedPhotosToMediaItems(row.photos)
        : mediaUrlsToMediaItems(row.media_urls)) as StoredMedia[];
      if (media.length > 0) existingByKey.set(row.listing_key, media);
    }

    let preserved = 0;
    for (const listing of listings) {
      const existing = existingByKey.get(listing?.ListingKey);
      if (existing && (!Array.isArray(listing.media) || listing.media.length === 0)) {
        listing.media = existing;
        preserved++;
      }
    }
    return preserved;
  } catch (err: any) {
    console.warn(`   ⚠️  Media preservation failed (non-fatal): ${err.message}`);
    return 0;
  }
}

/**
 * Per-batch wrapper used by the ingester: mutates `listings` in place by
 * attaching `media: StoredMedia[]` onto each one. Returns the number of
 * listings that received at least one media record (for logging).
 *
 * Best-effort by design: a failure leaves listings media-less and is logged,
 * never throwing — media is non-critical and the sync must not fail on it.
 */
export async function enrichListingsWithMedia(
  listings: any[],
  token: string
): Promise<number> {
  const keys = listings.map((l) => l.ListingKey).filter(Boolean);
  if (keys.length === 0) return 0;
  try {
    const { media: mediaMap, failedKeys, thumbs } = await fetchMediaForKeys(keys, token);
    let withMedia = 0;
    for (const listing of listings) {
      // The cover thumb is set BEFORE the failed-fetch guard: it comes from its
      // own request, so a failed media page says nothing about it, and dropping
      // a thumb we actually hold would just re-ship the 155 KB photo.
      const thumb = thumbs.get(listing.ListingKey);
      if (thumb) listing.thumbnailUrl = thumb;
      // Don't false-empty a failed fetch: leave `media` untouched so the
      // downstream preserveExistingMedia / next sweep can recover it. Only a
      // confirmed-zero fetch gets `media = []`.
      if (failedKeys.has(listing.ListingKey)) continue;
      const media = mediaMap.get(listing.ListingKey) || [];
      listing.media = media;
      if (media.length > 0) withMedia++;
    }
    return withMedia;
  } catch (err: any) {
    console.warn(`   ⚠️  Media enrichment failed (non-fatal): ${err.message}`);
    return 0;
  }
}
