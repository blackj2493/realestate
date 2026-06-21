/**
 * Cache tag for one listing's cached detail — bust with
 * revalidateTag(listingCacheTag(key), { expire: 0 }) to refresh on a delta.
 *
 * Deliberately dependency-free: route handlers (e.g. /api/sync) import only this tag
 * and must NOT transitively pull in getListingDetail.ts (its module-level React
 * cache() is unavailable in the worker/test runtime).
 */
export const listingCacheTag = (listingKey: string) => `listing:${listingKey}`;
