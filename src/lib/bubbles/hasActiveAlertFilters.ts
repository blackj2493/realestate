/**
 * Does a bubble's saved snapshot actually NARROW anything?
 *
 * `alert_scope = 'filtered'` only says which rule the worker applies. It says nothing
 * about whether that rule excludes a single listing. A bubble saved from the Terminal
 * before any filter was set stores a complete, valid `universalFilters` object in which
 * every field is its default:
 *
 *     "beds": 0, "baths": 0, "homeType": [], "price": [0, 3000000], ...
 *
 * bubbleAlertFilter translates that to a clause matching ~everything, so the nightly
 * email delivers townhouses to someone whose UI reads "My filters only" and whose
 * dashboard reads "4+ beds". Observed 2026-09-23 on a school bubble; the digest's
 * "filtered to:" line renders empty in that state, so nothing on screen contradicts it.
 *
 * WHY NOT REUSE bubbleAlertFilter'S `label`. It answers exactly this question, and the
 * worker uses it for that. But it reaches buildLensClauses → typesense/client, so
 * importing it into a client component drags the search client into the bundle. This is
 * the same predicate over the same two snapshot shapes, with no query building.
 *
 * Pure, no React, no client/server split — the dashboard controls and the tests share it.
 */
import { hasActiveLensFilters, type MarketActivityLens } from "@/lib/dashboard/config";
import { FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import type { CityLensFilters } from "@/lib/bubbles/serialize";

export function hasActiveAlertFilters(rawSnapshot: unknown): boolean {
  if (!rawSnapshot || typeof rawSnapshot !== "object") return false;

  // City/dashboard shape — the lens is the whole rule.
  const lens = (rawSnapshot as CityLensFilters).lens;
  if (lens) {
    try {
      return hasActiveLensFilters(lens as MarketActivityLens);
    } catch {
      return false; // malformed stored lens narrows nothing we can rely on
    }
  }

  // Terminal shape. A filter counts only if its own definition calls it active — the
  // same isActive the chip bar and bubbleAlertFilter's label use, so "shows a chip",
  // "names itself in the email" and "gates this control" can never disagree.
  const universal = (rawSnapshot as { universalFilters?: Record<string, unknown> }).universalFilters;
  if (!universal || typeof universal !== "object") return false;
  for (const [key, value] of Object.entries(universal)) {
    const def = FILTERS_BY_KEY[key];
    if (!def) continue; // renamed/removed filter — the clause builder ignores it too
    try {
      if (def.isActive(value as never)) return true;
    } catch {
      /* malformed stored value — not evidence of narrowing */
    }
  }
  return false;
}
