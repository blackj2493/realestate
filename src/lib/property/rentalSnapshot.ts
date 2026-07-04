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
  /**
   * Typical up-front cash for a tenant: first + last month's rent (the standard
   * Ontario move-in; the last-month deposit is the legal rent deposit). A guideline,
   * not a listing fact — labelled as such in the UI. 0 when rent is unknown.
   */
  moveInEstimate: number;
  /**
   * Household income a tenant typically needs to qualify, from the widely used
   * "rent ≤ 30% of gross income" screen: annualRent / 0.30. A guideline. 0 when
   * rent is unknown.
   */
  incomeToQualify: number;
  /**
   * Core utilities (Heat / Hydro / Water) the tenant will likely pay on top of rent,
   * derived as the complement of RentIncludes. Empty when nothing is listed as
   * included (no signal → we don't assert) or when the listing is all-inclusive.
   */
  utilitiesExtra: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Core utilities a tenant pays unless the listing says they're included. */
const CORE_UTILITIES: { label: string; re: RegExp }[] = [
  { label: "Heat", re: /heat/i },
  { label: "Hydro", re: /hydro|electri/i },
  { label: "Water", re: /water/i },
];

/**
 * Core utilities NOT listed as included in rent → the tenant likely pays them. Returns
 * [] when RentIncludes is empty (no signal, so we don't assert) or all-inclusive.
 */
function utilitiesNotIncluded(rentIncludes: string[]): string[] {
  if (rentIncludes.length === 0) return [];
  const hay = rentIncludes.join(" · ").toLowerCase();
  if (/all inclusive|all utilities/.test(hay)) return [];
  return CORE_UTILITIES.filter((u) => !u.re.test(hay)).map((u) => u.label);
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
  // $0/$1 asks are placeholder pricing ("contact brokerage" convention — the same
  // placeholders the terminal's ListPrice:>=1 rent floor tolerates). Deriving a
  // "$52,970/mo total" from a $1/sqft placeholder amplifies noise into a
  // real-looking figure, so placeholders derive nothing (found in the Phase-1
  // feature sweep on a live $1/sqft industrial lease).
  if (price > 1) {
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

  const annualRent = monthlyRent * 12;
  return {
    monthlyRent,
    annualRent,
    rentPerSqft: computeRentPerSqft(monthlyRent, input.buildingAreaTotal, input.livingAreaRange),
    leaseTerm,
    depositRequired: input.depositRequired ?? null,
    rentIncludes,
    moveInEstimate: monthlyRent * 2, // first + last month
    incomeToQualify: Math.round(annualRent / 0.3), // rent ≤ 30% of gross income
    utilitiesExtra: utilitiesNotIncluded(rentIncludes),
  };
}

// ── Rental at a glance ────────────────────────────────────────────────────────
// The handful of facts a tenant scans for first — what part of the property is for
// lease, pets, furnished, laundry, availability, parking, payment, and what they need
// to apply — pulled out of the deep data sheet and shown in a strip near the top on
// lease listings. Pets in particular is otherwise stuck in the condo-only data sheet
// group, so a leased freehold house never surfaces its pet policy at all.

type RawPayload = Record<string, unknown>;

/** Non-empty trimmed string (numbers pass through), else null. */
function gstr(p: RawPayload, key: string): string | null {
  const v = p[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Array field → trimmed non-empty members joined with " · ", else null. */
function gjoined(p: RawPayload, key: string): string | null {
  const v = p[key];
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  const items = arr
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
  return items.length > 0 ? items.join(" · ") : null;
}

/** Positive finite number, else null. */
function gposnum(p: RawPayload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Format a leading ISO date ("2026-08-01" → "Aug 1, 2026"); non-date strings pass
 * through unchanged. Parses the Y-M-D parts directly rather than via `new Date()` so
 * it's timezone-independent (a UTC-parsed date would shift a day in negative offsets).
 */
function fmtAvailable(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return v;
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return v;
  return `${MONTHS[monthIdx]} ${Number(m[3])}, ${m[1]}`;
}

/** Boolean lease-requirement flags → the tenant-facing "what you need to apply" list. */
const APPLY_REQUIREMENTS: { key: string; label: string }[] = [
  { key: "RentalApplicationYN", label: "Application" },
  { key: "CreditCheckYN", label: "Credit check" },
  { key: "ReferencesRequiredYN", label: "References" },
  { key: "EmploymentLetterYN", label: "Employment letter" },
];

export interface RentalGlance {
  /** PetsAllowed — e.g. "Restricted", "Yes", "No". */
  pets: string | null;
  /** Which part of the property is for lease — "Entire Property", "Basement", "Main", etc. */
  portion: string | null;
  /** Furnished — e.g. "Furnished", "Unfurnished", "Partially". */
  furnished: string | null;
  /** In-suite laundry, or the listing's laundry features. */
  laundry: string | null;
  /** When the unit is available — possession date, then possession type/notes. */
  available: string | null;
  /** Total parking spaces (drive + covered), when known and > 0. */
  parking: number | null;
  /** How rent is paid — frequency and/or method ("Monthly · Cheque"). */
  payment: string | null;
  /** True → the unit has its own private entrance (relevant for basement / portion leases). */
  privateEntrance: boolean;
  /** What a tenant needs to apply — application, credit check, references, employment letter. */
  applyRequirements: string[];
}

/** Build the at-a-glance rental facts from a raw listing payload. Pure & deterministic. */
export function buildRentalGlance(p: RawPayload): RentalGlance {
  const laundry =
    p.EnsuiteLaundryYN === true ? "In-suite" : gjoined(p, "LaundryFeatures");
  const availableRaw = gstr(p, "PossessionDate") ?? gstr(p, "PossessionType") ?? gstr(p, "PossessionDetails");
  const payment = [gstr(p, "PaymentFrequency"), gstr(p, "PaymentMethod")].filter(Boolean).join(" · ") || null;
  return {
    pets: gjoined(p, "PetsAllowed"),
    portion: gjoined(p, "PortionPropertyLease"),
    furnished: gstr(p, "Furnished"),
    laundry,
    available: availableRaw ? fmtAvailable(availableRaw) : null,
    parking: gposnum(p, "ParkingTotal") ?? gposnum(p, "CoveredSpaces"),
    payment,
    privateEntrance: p.PrivateEntranceYN === true,
    applyRequirements: APPLY_REQUIREMENTS.filter((r) => p[r.key] === true).map((r) => r.label),
  };
}
