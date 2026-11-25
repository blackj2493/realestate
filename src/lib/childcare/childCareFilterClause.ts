/**
 * Typesense filter clause for the map's "Child care" tool (browser-safe, no fs).
 *
 * Each kind reads one precomputed field (see nearestChildCare.ts). A listing outside
 * Toronto has the field missing or at the 99 sentinel, so `<=X` never matches it.
 */
import type { ChildCareKind, ChildCareState } from "@/lib/stores/commandCenterStore";

export const CHILD_CARE_FIELD: Record<ChildCareKind, string> = {
  infant: "NearestInfantCareKm",
  any: "NearestChildCareKm",
  cwelcc: "NearestCwelccKm",
};

/** Short label for chips: "Infant care", "Child care", "$10-a-day care". */
export const CHILD_CARE_KIND_LABEL: Record<ChildCareKind, string> = {
  infant: "Infant care",
  any: "Child care",
  cwelcc: "$10-a-day care",
};

/** "500m" / "1km" / "1.5km" — same style as the amenity chips. */
export function formatChildCareKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km}km`;
}

export function childCareFilterClause(state: Pick<ChildCareState, "enabled" | "kind" | "maxKm">): string | null {
  if (!state.enabled) return null;
  if (!Number.isFinite(state.maxKm) || state.maxKm <= 0) return null;
  const field = CHILD_CARE_FIELD[state.kind] ?? CHILD_CARE_FIELD.infant;
  return `${field}:<=${state.maxKm}`;
}
