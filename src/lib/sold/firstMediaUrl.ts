/**
 * First usable image URL from a Supabase `listings.media_urls` array — the cover
 * photo (the array is ordered; index 0 is the primary). Returns null for a non-array,
 * an empty array, or an array with no non-empty string entry.
 *
 * Used to stamp a delisted comp's `primaryImageUrl` from its surviving `listings`
 * row (the delisted VOW feed carries no media), mirroring how getSoldMediaByKey
 * cleans the same column for the gallery. Consumer-only surface (the terminal comp
 * ledger is VOW-gated), so this is the same photo a signed-in user already sees.
 */
export function firstMediaUrl(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const u of media) {
    if (typeof u === "string" && u.length > 0) return u;
  }
  return null;
}
