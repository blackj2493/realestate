/**
 * Does a region label actually resolve to inventory?
 *
 * `config.regions` is free text. FirstRunRegionPicker saves whatever LocationSearch
 * emits, and LocationSearch's Enter path (`resolveTextTarget`) turns ANY typed string
 * into a place label — no suggestion has to be chosen. On 2026-08-08 a user typed a full
 * street address and it was stored verbatim, so `areaFilter` has been building
 *
 *   (City:=`7725 shagbark avenue niagara falls ON L2H 3R9` || CityRegion:=`…`)
 *
 * on every dashboard load since — 0 hits, a permanently empty section, no explanation.
 *
 * THE TEST IS A COUNT THROUGH `areaFilter` ITSELF, never a shape heuristic, because real
 * region values look nothing alike and several of them look "wrong":
 *   • `Toronto C01`                      — a City value with a district code
 *   • `7711 - Barrhaven - Half Moon Bay` — a CityRegion that OPENS with a digit block
 *   • `Toronto` / `Ottawa` / `London`    — CITY_GROUPS parents, not feed values at all
 *   • `High Park-Swansea`, `Cooksville`  — CityRegion values under a parent city
 * All four shapes are saved by real users today and all four must keep working. A regex
 * that rejected the street address would reject the Barrhaven CityRegion with it.
 *
 * FAILS OPEN. A Typesense error answers `true`: a search outage must never stop someone
 * adding a market they can see on the map. The cost of a false accept is one empty
 * section the user can remove; the cost of a false reject is a blocked signup.
 */
import { searchClauseCounts } from "@/lib/typesense/client";
import { areaFilter, regionArea } from "@/lib/dashboard/area";

export async function regionResolves(name: string): Promise<boolean> {
  const label = (name ?? "").trim();
  if (!label) return false;
  try {
    // No transaction-type filter: a lease-only or sold-heavy area is still a real area.
    const [found] = await searchClauseCounts({
      baseFilterBy: "",
      clauses: [areaFilter(regionArea(label))],
    });
    return (found ?? 0) > 0;
  } catch {
    return true;
  }
}
