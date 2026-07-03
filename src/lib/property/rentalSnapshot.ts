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

// ── Commercial lease economics (commercial-gap Phase 1) ──
//
// Commercial leases are NOT quoted like residential ones. TRREB's ListPriceUnit
// carries the basis: "Month" (total monthly rent), "Per Sq Ft" / "Sq Ft Net" /
// "Sq Ft Gross" (a $/sqft/yr rate — the industry convention), or "Year" (total
// annual rent). Reading a $22/sqft/yr quote as a $22 monthly rent (or vice versa)
// is a 1000× fabrication, so basis detection gates ALL derived math: an unknown
// basis renders the asking figure verbatim and derives nothing.

export type CommercialLeaseBasis = "month" | "psf-year" | "year" | "unknown";

export interface CommercialLeaseInput {
  /** ListPrice as fed — its meaning depends on listPriceUnit. */
  listPrice: number;
  /** TRREB ListPriceUnit, e.g. "Month", "Per Sq Ft", "Sq Ft Net", "Year". */
  listPriceUnit?: string | null;
  /** Leasable area (BuildingAreaTotal), sqft. Denominator/multiplier for psf math. */
  buildingAreaTotal?: number | null;
  leaseTerm?: string | null;
  rentIncludes?: string[] | null;
  /** Verbatim TMI string when the feed carries the dedicated field. */
  tmi?: string | null;
  /** TaxType/TaxAnnualAmount pair — TRREB also quotes TMI as TaxType="TMI". */
  taxType?: string | null;
  taxAnnualAmount?: number | null;
}

export interface CommercialLeaseSnapshot {
  basis: CommercialLeaseBasis;
  /** Monthly total rent; null when it cannot be derived without guessing. */
  monthlyRent: number | null;
  /** Annualized total rent; null when underivable. */
  annualRent: number | null;
  /** Asking rate in $/sqft/yr — the commercial comparison number; null when underivable. */
  perSqftYear: number | null;
  areaSqft: number | null;
  leaseTerm: string | null;
  /** Verbatim TMI display ("$4.50", "$18.40"), from the TMI field or the TaxType=TMI pair. */
  tmiDisplay: string | null;
  rentIncludes: string[];
}

/** Classify TRREB's ListPriceUnit into a lease-price basis. Unknown stays unknown. */
export function classifyLeaseBasis(listPriceUnit?: string | null): CommercialLeaseBasis {
  const u = (listPriceUnit ?? "").trim().toLowerCase();
  if (!u) return "unknown";
  if (u.includes("month")) return "month";
  if (u.includes("sq")) return "psf-year"; // "Per Sq Ft", "Sq Ft Net", "Sq Ft Gross"
  if (u.includes("year") || u.includes("annual")) return "year";
  return "unknown";
}

/** Build the commercial-lease snapshot. Pure & deterministic; derives only what the
 *  quoted basis supports — never guesses a denominator or a basis. */
export function buildCommercialLeaseSnapshot(input: CommercialLeaseInput): CommercialLeaseSnapshot {
  const price = Number.isFinite(input.listPrice) && input.listPrice > 0 ? input.listPrice : 0;
  const area =
    typeof input.buildingAreaTotal === "number" &&
    Number.isFinite(input.buildingAreaTotal) &&
    input.buildingAreaTotal > 0
      ? input.buildingAreaTotal
      : null;
  const basis = classifyLeaseBasis(input.listPriceUnit);

  let monthlyRent: number | null = null;
  let annualRent: number | null = null;
  let perSqftYear: number | null = null;
  if (price > 0) {
    if (basis === "month") {
      monthlyRent = price;
      annualRent = price * 12;
      perSqftYear = area ? round2((price * 12) / area) : null;
    } else if (basis === "year") {
      annualRent = price;
      monthlyRent = round2(price / 12);
      perSqftYear = area ? round2(price / area) : null;
    } else if (basis === "psf-year") {
      perSqftYear = round2(price);
      annualRent = area ? Math.round(price * area) : null;
      monthlyRent = area ? Math.round((price * area) / 12) : null;
    }
  }

  const tmiField = input.tmi && input.tmi.trim().length > 0 ? input.tmi.trim() : null;
  const tmiFromTax =
    (input.taxType ?? "").trim().toUpperCase() === "TMI" &&
    typeof input.taxAnnualAmount === "number" &&
    Number.isFinite(input.taxAnnualAmount) &&
    input.taxAnnualAmount > 0
      ? `$${input.taxAnnualAmount.toFixed(2)}`
      : null;

  return {
    basis,
    monthlyRent,
    annualRent,
    perSqftYear,
    areaSqft: area,
    leaseTerm: input.leaseTerm && input.leaseTerm.trim().length > 0 ? input.leaseTerm.trim() : null,
    tmiDisplay: tmiField ?? tmiFromTax,
    rentIncludes: (input.rentIncludes ?? [])
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter((s) => s.length > 0),
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
