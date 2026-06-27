/**
 * syncChips — make the live query state an exact mirror of the NL chip set.
 *
 * Authoritative over only the fields the parser can produce (price/beds/baths/
 * type/basement/school/parking/stale/price-drop/location): each is SET from its
 * chip or RESET to default when no chip is present. That makes add/remove/clear
 * trivially correct — removing a chip and re-syncing the remainder clears exactly
 * that filter and nothing else.
 */

import type { FilterValue } from "@/lib/filters/types";
import type { TerminalFilterState } from "@/lib/personas/personaConfig";
import type { SchoolState } from "@/lib/stores/commandCenterStore";
import type { ParsedChip } from "./types";

export interface ChipSyncDeps {
  setUniversalFilter: (key: string, value: FilterValue) => void;
  setFilter: <K extends keyof TerminalFilterState>(key: K, value: TerminalFilterState[K]) => void;
  setLocation: (loc: string) => void;
  setSchool: (patch: Partial<SchoolState>) => void;
  addFilter: (key: string) => void;
  removeAddedFilter: (key: string) => void;
  /** Mode-scoped price bounds so "clear price" restores the right slider extent. */
  priceBounds: { min: number; max: number };
}

const pick = (chips: ParsedChip[], kind: ParsedChip["kind"]) => chips.find((c) => c.kind === kind);
const all = (chips: ParsedChip[], kind: ParsedChip["kind"]) => chips.filter((c) => c.kind === kind);

export function syncChips(chips: ParsedChip[], deps: ChipSyncDeps): void {
  const { priceBounds } = deps;

  // Price — single range from the two bound chips (default to the slider extent).
  const lo = (pick(chips, "priceMin")?.value as number) ?? priceBounds.min;
  const hi = (pick(chips, "priceMax")?.value as number) ?? priceBounds.max;
  deps.setUniversalFilter("price", [lo, hi]);

  // Steppers (number = "minimum").
  deps.setUniversalFilter("beds", (pick(chips, "beds")?.value as number) ?? 0);
  deps.setUniversalFilter("baths", (pick(chips, "baths")?.value as number) ?? 0);
  deps.setUniversalFilter("parking", (pick(chips, "parking")?.value as number) ?? 0);

  // Enum/multi.
  deps.setUniversalFilter("homeType", (pick(chips, "homeType")?.value as string[]) ?? []);
  const basement = all(chips, "basement").flatMap((c) => c.value as string[]);
  deps.setUniversalFilter("basement", basement);

  // Track the deeper (added) chips so the active-filter strip + mobile sheet show them.
  if (pick(chips, "parking")) deps.addFilter("parking");
  else deps.removeAddedFilter("parking");
  if (basement.length) deps.addFilter("basement");
  else deps.removeAddedFilter("basement");

  // Persona signals.
  deps.setFilter("staleOnly", Boolean(pick(chips, "staleOnly")));
  deps.setFilter("minPriceDrop", (pick(chips, "priceDrop")?.value as number) ?? 0);

  // School lens.
  const school = pick(chips, "school");
  if (school) deps.setSchool({ enabled: true, minScore: school.value as number });
  else deps.setSchool({ enabled: false, minScore: 0 });

  // Location (drives the existing debounced search + auto-fit).
  const loc = pick(chips, "location");
  if (loc) deps.setLocation(loc.value as string);
}
