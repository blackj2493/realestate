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

const API_BASE_URL = (process.env.AMPRE_API_URL || 'https://query.ampre.ca/odata').trim();

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 3000];

export const MEDIA_CHUNK_SIZE = 25;        // listing keys per /Media request
export const MEDIA_REQUEST_DELAY_MS = 300; // polite delay between requests

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
 * Fetches /Media for a set of ListingKeys, OR-batched into chunks with
 * @odata.nextLink pagination. Returns Map<ListingKey, StoredMedia[]> sorted by
 * Order. Best-effort: a failed chunk is skipped (those listings sync without
 * media — they'll render the text-only ListingThumbnail fallback per §6.3(c)).
 *
 * The ResourceName='Property' clause is REQUIRED by RESO spec — Media is a
 * polymorphic resource also used for Office/Member records, and omitting it
 * would mix in agent headshots and brokerage logos.
 */
export async function fetchMediaForKeys(
  keys: string[],
  token: string
): Promise<Map<string, StoredMedia[]>> {
  const grouped = new Map<string, StoredMedia[]>();
  if (!token || keys.length === 0) return grouped;

  // Accumulate raw media (with Order) so we sort per listing after grouping.
  const rawByKey = new Map<string, any[]>();

  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MEDIA_CHUNK_SIZE) {
    chunks.push(keys.slice(i, i + MEDIA_CHUNK_SIZE));
  }

  for (const chunk of chunks) {
    // Server-side size filter: AMPRE generates 5 variants per photo (Thumbnail,
    // Medium 960×960, Large, Largest, LargestNoWatermark). Each variant gets its
    // OWN MediaObjectID/MediaKey so there's no shared key linking them — client-
    // side dedup-by-ID can't collapse a photo's 5 variants. Solution: request
    // only the Medium variant at the server. Verified 2026-05-27 that every photo
    // on test listing W13133990 had a Medium variant (44 photos × 5 sizes = 220
    // total records; Medium-only returns the 44 we actually need).
    //
    // Compliance: Medium URLs have the brokerage watermark URL-baked (the `wm:`
    // + `wmt:` URL segments), satisfying §6.3(c). We explicitly do NOT request
    // LargestNoWatermark.
    //
    // Bandwidth: Medium = 960×960 is sufficient for card thumbnails AND for the
    // current lightbox/gallery view. If/when the listing-detail "bento grid"
    // (CLAUDE.md §3.C) ships, a future iteration can add a Largest fetch.
    const keyFilter = `(${chunk.map((k) => `ResourceRecordKey eq '${k}'`).join(' or ')})`;
    const orFilter = `${keyFilter} and ResourceName eq 'Property' and ImageSizeDescription eq 'Medium'`;
    let url: string | null =
      `${API_BASE_URL}/Media?$filter=${encodeURIComponent(orFilter)}&$orderby=ResourceRecordKey,Order&$top=100&$count=true`;

    // Follow @odata.nextLink — a 25-listing chunk × ~30 photos/listing easily
    // blows past the server-side 100-record page cap.
    while (url) {
      const result: FetchResult<any> = await fetchWithRetry<any>(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!result.success || !result.data) {
        console.warn(`   ⚠️  Media chunk fetch failed (non-fatal): ${result.error}`);
        break;
      }
      const records: any[] = result.data.value || [];
      for (const m of records) {
        const lk = m.ResourceRecordKey;
        if (!lk || !m.MediaURL) continue;
        const arr = rawByKey.get(lk);
        if (arr) arr.push(m);
        else rawByKey.set(lk, [m]);
      }
      url = result.data['@odata.nextLink'] || null;
      await sleep(MEDIA_REQUEST_DELAY_MS);
    }
  }

  for (const [lk, items] of rawByKey) {
    // Dedupe to one record per logical photo, dropping NoWatermark variants.
    const collapsed = dedupeMediaByObject(items);
    collapsed.sort((a, b) => (a.Order ?? Number.POSITIVE_INFINITY) - (b.Order ?? Number.POSITIVE_INFINITY));
    grouped.set(lk, collapsed.map(toStoredMedia));
  }
  return grouped;
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
    // PostgREST JSONB sub-tree projection — same pattern soldIndexer.ts uses.
    // No full-payload detoast: only the `media` key is read.
    const select = `listing_key, media:${payloadColumn}->media`;
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
    for (const row of data as Array<{ listing_key: string; media: unknown }>) {
      const media = Array.isArray(row.media) ? (row.media as StoredMedia[]) : [];
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
    const mediaMap = await fetchMediaForKeys(keys, token);
    let withMedia = 0;
    for (const listing of listings) {
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
