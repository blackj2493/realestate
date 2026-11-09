/**
 * Place resolution and link building for the assistant app (src/app/api/mcp).
 *
 * Pure: no IO. An assistant sends free text ("Markham", "markham, ON", "Richmond Hill
 * Ontario"); we map it to one of the 15 board cities or say we do not cover it.
 */
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { slugify } from "@/lib/listings/listingPath";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/** The 15 cities by display name, for "we cover…" replies and tool descriptions. */
export const COVERED_CITIES: string[] = OUTLOOK_CITIES.map((c) => c.city);

/** Strip the province and common filler so "Markham, ON" and "markham ontario" match. */
function clean(input: string): string {
  return input
    .replace(/\b(ontario|canada|on|city of|town of|the)\b/gi, " ")
    .replace(/[,.]/g, " ")
    .trim();
}

/** A board city {city, slug}, or null when the place is not one of the 15. */
export function resolveCity(input: string | null | undefined): { city: string; slug: string } | null {
  if (!input) return null;
  const slug = slugify(clean(input));
  if (!slug) return null;
  return OUTLOOK_CITIES.find((c) => c.slug === slug) ?? null;
}

/** True when the text asks about the whole province ("Ontario", "ON", "all of Ontario"). */
export function isProvince(input: string | null | undefined): boolean {
  if (input == null) return true;
  const s = input.trim().toLowerCase();
  return s === "" || s === "on" || /^(all of |province of )?ontario( province)?$/.test(s);
}

/**
 * An absolute pureproperty.ca link, tagged so a visit from the app is countable in
 * analytics (utm_source=assistant_app). `tool` names the tool that gave the link.
 */
export function appLink(path: string, tool: string): string {
  const u = new URL(path, SITE_URL);
  u.searchParams.set("utm_source", "assistant_app");
  u.searchParams.set("utm_medium", "mcp");
  u.searchParams.set("utm_campaign", tool);
  return u.toString();
}

/** "We cover Toronto, Mississauga, … and Oshawa." */
export function coverageSentence(): string {
  const list = COVERED_CITIES;
  return `PureProperty covers these Ontario cities: ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}.`;
}
