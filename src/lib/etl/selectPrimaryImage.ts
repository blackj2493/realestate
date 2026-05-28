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

interface MediaItem {
  MediaURL?: string;
  MediaStatus?: string;
  Order?: number;
  ImageSizeDescription?: string;
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
