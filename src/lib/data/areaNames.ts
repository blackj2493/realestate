/**
 * Shared place-name presentation for the public /data trackers.
 *
 * Extracted from rentBoard.ts when the over-asking tracker landed. Two trackers rendering the
 * same TRREB neighbourhood under two different names is a real bug, not a cosmetic one — a
 * reporter comparing "Runnymede-Bloor West Village" on one page with "1011 - MO Morrison" on
 * another has no way to tell they are the same taxonomy. One implementation, one set of tests.
 */
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";

/**
 * TRREB stores Toronto as district codes ("Toronto C02"), meaningless to a public reader.
 * Round-trip through the canonical hub-slug helpers so districts consolidate to their
 * municipality using the same rules as the hub tree, not a second copy of that regex.
 */
export function displayCity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const slug = cityHubSlug(trimmed);
  return slug ? deslugCity(slug) : trimmed;
}

/**
 * Make a TRREB area name readable.
 *
 * 308 of 1,033 distinct areas carry an MLS district code the feed never strips, in two
 * shapes: "057 - Smithville", and Oakville/Ottawa's "1011 - MO Morrison" where a two-letter
 * district abbreviation follows the number. Neither means anything to a renter or a
 * reporter, and "1011 - MO Morrison" in a published table looks like a database leak.
 *
 * The two-letter strip is applied ONLY when a numeric prefix was present — that is what
 * marks the name as coded. Doing it unconditionally would eat the opening word of any
 * legitimately capitalised name.
 *
 * Verified against the full distinct set: nothing strips to empty, and the shortest results
 * (Carp, Glebe, Perth, Finch, Ascot, Town) are real neighbourhood names, not fragments.
 */
export function cleanAreaName(raw: string): string {
  const a = raw.trim();
  const withoutCode = a.replace(/^\d{3,4}\s*-\s*/, "");
  if (withoutCode === a) return a;
  const withoutAbbrev = withoutCode.replace(/^[A-Z]{2}\s+(?=\S)/, "");
  return withoutAbbrev || withoutCode || a;
}

/** Waterloo Region and Brantford arrive with no CityRegion; the city IS the area there. */
export function displayArea(area: string, city: string): string {
  const a = cleanAreaName(area);
  return a || `${city} (all areas)`;
}
