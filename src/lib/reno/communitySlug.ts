import { normalizeCityRegion, type CohortTree } from '@/lib/avm/cohorts';

/** Slug for share links / OG cards. Strips the legacy "1001 - BR " prefix first. */
export function slugifyCommunity(raw: string): string {
  return normalizeCityRegion(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Display label for the OG card when we only have the slug (lossy — title-cased). */
export function deslugifyCommunity(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Map a slug back to the exact { city, cityRegion } lookup key using the live tree. */
export function resolveCommunitySlug(
  tree: CohortTree,
  slug: string,
): { city: string; cityRegion: string } | null {
  const target = slug.toLowerCase();
  for (const [city, communities] of Object.entries(tree)) {
    for (const c of communities) {
      if (slugifyCommunity(c.community) === target) {
        return { city, cityRegion: c.cityRegion };
      }
    }
  }
  return null;
}
