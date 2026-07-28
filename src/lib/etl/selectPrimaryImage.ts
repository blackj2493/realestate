/**
 * Pick a single best-fit thumbnail URL from a TRREB IDX/VOW payload's media arrays.
 *
 * The IDX/VOW JSON ships TWO parallel arrays (`media` and `images`) that overlap
 * heavily but aren't identical — historically the transformer walked each separately
 * with subtly different fallbacks (active branch had a "first Medium" fallback that
 * the media-only branch lacked). This helper unifies them so the active ETL
 * (`scripts/worker/transformer.ts`) and the sold indexer (`scripts/worker/soldIndexer.ts`)
 * apply the same rules.
 *
 * Selection priority — pick the LOWEST-Order item whose ImageSizeDescription is
 * the highest-preference size we can use for a card thumbnail:
 *
 *   1. Medium     — sweet-spot: fits a 200–400px card without bandwidth waste
 *   2. Large      — acceptable hero size
 *   3. Largest    — full-res; the TRREB CDN serves it scaled by the URL params
 *                   already in the path so it's fine as a fallback
 *   4. Thumbnail  — last resort: TRREB's "Thumbnail" is only 240px which looks
 *                   poor on retina screens
 *
 * Returns null when no usable media URL exists (deleted, no array, empty array).
 * Callers should fall back to a text-only card per IDX §6.3(c) — NEVER a stock
 * placeholder, since rendering an unrelated image next to a real listing risks
 * misleading consumers.
 */

export interface MediaItem {
  MediaURL?: string;
  MediaStatus?: string;
  Order?: number;
  ImageSizeDescription?: string;
  /** Caption; present on ~8% of photos. Carried through to raw_vow_sold.photos as `c`. */
  ShortDescription?: string;
}

const SIZE_RANK: Record<string, number> = {
  Medium: 0,
  Large: 1,
  Largest: 2,
  Thumbnail: 3,
};

function rank(size: string | undefined): number {
  if (!size) return 99;
  return SIZE_RANK[size] ?? 99;
}

/** All non-deleted MediaURLs from media[] + images[], deduplicated, order preserved. */
export function collectMediaUrls(raw: {
  media?: MediaItem[];
  images?: MediaItem[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (items?: MediaItem[]) => {
    if (!Array.isArray(items)) return;
    for (const m of items) {
      if (!m?.MediaURL) continue;
      if (m.MediaStatus === 'Deleted') continue;
      if (seen.has(m.MediaURL)) continue;
      seen.add(m.MediaURL);
      out.push(m.MediaURL);
    }
  };
  push(raw.media);
  push(raw.images);
  return out;
}

/**
 * Pick the best-fit primary thumbnail URL. See file header for the priority rule.
 * Returns null when nothing usable exists.
 */
export function selectPrimaryImage(raw: {
  media?: MediaItem[];
  images?: MediaItem[];
}): string | null {
  const candidates: MediaItem[] = [];
  if (Array.isArray(raw.media)) candidates.push(...raw.media);
  if (Array.isArray(raw.images)) candidates.push(...raw.images);

  const usable = candidates.filter(
    (m) => m?.MediaURL && m.MediaStatus !== 'Deleted'
  );
  if (usable.length === 0) return null;

  // Sort by (size rank, order) ascending — most preferred first.
  usable.sort((a, b) => {
    const rs = rank(a.ImageSizeDescription) - rank(b.ImageSizeDescription);
    if (rs !== 0) return rs;
    return (a.Order ?? Number.POSITIVE_INFINITY) - (b.Order ?? Number.POSITIVE_INFINITY);
  });

  return usable[0].MediaURL ?? null;
}

/**
 * A photo as stored in `raw_vow_sold.photos` (migration 101): `u` = MediaURL,
 * `c` = ShortDescription caption when the feed supplied one (~8% of photos).
 */
export interface StoredPhoto {
  u: string;
  c?: string;
}

/**
 * Photo URLs from the stored `photos` column, in display order.
 *
 * The column is written having ALREADY applied collectMediaUrls' rules —
 * MediaStatus='Deleted' excluded, duplicates removed, Order preserved — so this is a
 * plain unwrap, not a second filter pass.
 */
export function photoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return (photos as StoredPhoto[]).map((p) => p?.u).filter((u): u is string => Boolean(u));
}

/**
 * Primary thumbnail from the stored `photos` column, or null when there are none.
 *
 * Equivalent to selectPrimaryImage() over the original media array: that helper sorts
 * by (size rank, Order), and every TRREB sold photo is ImageSizeDescription='Medium'
 * (verified across the sampled media set), so size rank never discriminates and the
 * lowest-Order usable photo wins — which is exactly `photos[0]`.
 */
export function primaryImageFromPhotos(photos: unknown): string | null {
  return photoUrls(photos)[0] ?? null;
}

/**
 * Inflate the stored `photos` column back into the MediaItem shape the ETL passes
 * around (`listing.media`), so code paths that still speak the feed's vocabulary —
 * collectMediaUrls, selectPrimaryImage, preserveExistingMedia — keep working unchanged.
 *
 * The reconstructed fields are not invented: everything in `photos` is Active by
 * construction (Deleted was filtered at write time), TRREB sold media is uniformly
 * ImageSizeDescription='Medium' and MediaCategory='Photo', and Order is the array
 * position because the column is written Order-sorted.
 */
/**
 * Inflate the flat `listings.media_urls` column back into MediaItem shape, for the
 * active-listing recovery path (preserveExistingMedia) after migration 103 removes
 * full_payload->'media'.
 *
 * media_urls is itself the output of collectMediaUrls — Deleted already excluded,
 * duplicates removed, order preserved — so Active/position are accurate rather than
 * assumed. ImageSizeDescription is deliberately omitted: it is unknown here, and
 * verified irrelevant in practice (media_urls[0] matched selectPrimaryImage's
 * size-ranked pick on 8,339/8,339 sampled listings, because dedupeMediaByObject
 * collapses each photo to a single size).
 */
export function mediaUrlsToMediaItems(urls: unknown): MediaItem[] {
  if (!Array.isArray(urls)) return [];
  return (urls as string[])
    .filter((u): u is string => typeof u === 'string' && u.length > 0)
    .map((u, i) => ({ MediaURL: u, MediaStatus: 'Active', Order: i }));
}

export function storedPhotosToMediaItems(photos: unknown): MediaItem[] {
  if (!Array.isArray(photos)) return [];
  return (photos as StoredPhoto[])
    .filter((p) => p?.u)
    .map((p, i) => ({
      MediaURL: p.u,
      MediaStatus: 'Active',
      Order: i,
      ImageSizeDescription: 'Medium',
      ...(p.c ? { ShortDescription: p.c } : {}),
    }));
}
