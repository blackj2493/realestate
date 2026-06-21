/**
 * Rental Snapshot — the lease-listing replacement for the buy-and-hold Underwriting
 * Sandbox.
 *
 * On a For-Lease listing, `ListPrice` is the MONTHLY RENT, not a purchase price.
 * Feeding it to `computeUnderwriting` fabricates a $540 down payment and a 516% cap
 * rate (the bug this fixes). A lease listing has no acquisition to underwrite — its
 * value to a cashflow investor is as a RENT COMP. So instead of inventing a purchase,
 * we surface the lease economics: annualized rent and an honest rent-per-sqft.
 *
 * Compliance (CLAUDE.md §4): pure arithmetic over active-listing fields. No LLM, no
 * VOW data, no fabricated numbers — rent-$/sqft is omitted (not guessed) when no
 * area is known.
 */

/** Rent per square foot. `range` when area is only known as a band (LivingAreaRange). */
export interface RentPerSqft {
  kind: "exact" | "range";
  /** $/sqft at the LARGER area (lower bound of the rate). Equals `high` when exact. */
  low: number;
  /** $/sqft at the SMALLER area (upper bound of the rate). Equals `low` when exact. */
  high: number;
}

export interface RentalSnapshotInput {
  /** The listing's monthly rent (ListPrice on a lease, or the achieved leased price). */
  monthlyRent: number;
  /** Concrete interior area, when the feed gives one. Preferred over the range. */
  buildingAreaTotal?: number | null;
  /** Banded area string, e.g. "700-799" or "0-499". Used only when no concrete area. */
  livingAreaRange?: string | null;
  leaseTerm?: string | null;
  depositRequired?: boolean | null;
  rentIncludes?: string[] | null;
}

export interface RentalSnapshot {
  monthlyRent: number;
  annualRent: number;
  /** null when no usable area is known — we never guess a denominator. */
  rentPerSqft: RentPerSqft | null;
  leaseTerm: string | null;
  depositRequired: boolean | null;
  rentIncludes: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Pull positive integer area bounds out of a messy band string ("700-799", "0-499", "1,200"). */
function parseAreaBounds(range: string): number[] {
  const matches = range.replace(/,/g, "").match(/\d+(?:\.\d+)?/g);
  if (!matches) return [];
  return matches
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

/**
 * Rent per sqft, monthly basis (GTA residential convention). Exact when a concrete
 * BuildingAreaTotal exists; a range when only a banded LivingAreaRange is available
 * (smaller area → higher $/sqft, so the band's low area sets `high`). null otherwise.
 */
function computeRentPerSqft(
  monthlyRent: number,
  buildingAreaTotal?: number | null,
  livingAreaRange?: string | null
): RentPerSqft | null {
  if (monthlyRent <= 0) return null;

  if (typeof buildingAreaTotal === "number" && Number.isFinite(buildingAreaTotal) && buildingAreaTotal > 0) {
    const v = round2(monthlyRent / buildingAreaTotal);
    return { kind: "exact", low: v, high: v };
  }

  const bounds = livingAreaRange ? parseAreaBounds(livingAreaRange) : [];
  if (bounds.length === 0) return null;

  const smallest = bounds[0];
  const largest = bounds[bounds.length - 1];
  if (smallest === largest) {
    const v = round2(monthlyRent / smallest);
    return { kind: "exact", low: v, high: v };
  }
  return {
    kind: "range",
    low: round2(monthlyRent / largest), // larger area → lower rate
    high: round2(monthlyRent / smallest), // smaller area → higher rate
  };
}

/** Build the lease-listing snapshot from raw listing fields. Pure & deterministic. */
export function buildRentalSnapshot(input: RentalSnapshotInput): RentalSnapshot {
  const monthlyRent = Math.max(0, Number.isFinite(input.monthlyRent) ? input.monthlyRent : 0);
  const rentIncludes = (input.rentIncludes ?? [])
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s.length > 0);
  const leaseTerm = input.leaseTerm && input.leaseTerm.trim().length > 0 ? input.leaseTerm.trim() : null;

  return {
    monthlyRent,
    annualRent: monthlyRent * 12,
    rentPerSqft: computeRentPerSqft(monthlyRent, input.buildingAreaTotal, input.livingAreaRange),
    leaseTerm,
    depositRequired: input.depositRequired ?? null,
    rentIncludes,
  };
}
