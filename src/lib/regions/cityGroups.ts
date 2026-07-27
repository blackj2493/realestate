/**
 * cityGroups — the display layer's view of the CITY_GROUPS parent cities that
 * TRREB stores as many sub-values (Toronto districts, London directionals, Ottawa
 * OREB areas). CITY_GROUPS in @/lib/dashboard/area is the single source of truth;
 * this only reads it, so parents never drift out of sync.
 *
 * Used by the search bars to offer a synthetic "<City> — all districts" row.
 */

import { CITY_GROUPS } from "@/lib/dashboard/area";

/**
 * The parent city a typed query is reaching for, but ONLY when the terminal's
 * existing full-text scope (setLocation(parent) → `query: location`) actually
 * expands to the whole group — i.e. every member contains the parent name
 * ("Toronto C01", "London South"). Ottawa's OREB names ("Barrhaven", "Kanata")
 * do NOT, so a full-text "Ottawa" would silently under-return; those return null
 * here rather than offer a misleading city-wide row. (Scoping all of Ottawa in the
 * terminal would need a City:=[…] clause in the query builder — see report.)
 *
 * Match is a case-insensitive prefix of the parent name, so "tor", "toro" and
 * "toronto" all resolve to "Toronto" while the user is still typing.
 */
export function expandableCityGroupFor(query: string): string | null {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return null;
  for (const [parent, members] of Object.entries(CITY_GROUPS)) {
    const p = parent.toLowerCase();
    if (!p.startsWith(q)) continue;
    if (members.every((m) => m.toLowerCase().includes(p))) return parent;
  }
  return null;
}
