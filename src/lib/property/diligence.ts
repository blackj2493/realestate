/**
 * Things to Know — deterministic "diligence flags" for a listing.
 *
 * The interpretive companion to PropertyDataSheet's risk group: where the datasheet
 * renders TRREB disclosure fields VERBATIM (IDX §6.3(f)), this layer is allowed to
 * CHARACTERIZE — because it's our own sourced analysis sitting alongside the listing,
 * not an alteration of it (same separation as The Read / Deal Score).
 *
 * COMPLIANCE (CLAUDE.md §4): pure deterministic mapping over already-present fields.
 * No LLM. Each flag carries a `source` so the claim is attributable, and an optional
 * `ask` (the "worth asking" prompt) that feeds the CTA ladder.
 *
 * Phase 1 (this module): payload-derived only — zero external data.
 * Phase 2: geo-joined public records (flood/rail/traffic) are produced server-side and
 * passed in as `external`; they merge into the same sorted list.
 */

export type RawPayload = Record<string, unknown>;

export interface DiligenceFlag {
  id: string;
  kind: "warn" | "info";
  /** 0–100; ranks within the card and feeds The Read's catch ledger. */
  severity: number;
  /** The fact, in plain English. */
  title: string;
  /** Attribution — what makes the claim checkable. */
  source: string;
  /** Optional "worth asking" prompt. */
  ask?: string;
}

// ── null-safe readers (CLAUDE.md §6: expect nulls, wrong types, empty arrays) ──
const BENIGN = /^(no|none|unknown|n\/a|nil)$/i;

function list(p: RawPayload, key: string): string[] {
  const v = p[key];
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  return arr
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}
function meaningful(values: string[]): string[] {
  return values.filter((v) => !BENIGN.test(v));
}
function str(p: RawPayload, key: string): string | null {
  const v = p[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function num(p: RawPayload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = v.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/**
 * Build the diligence-flag list from a listing payload, merging any externally-derived
 * (geo-joined) flags. Sorted: warnings first (severity desc), then info (severity desc).
 */
export function buildDiligenceFlags(p: RawPayload, external: DiligenceFlag[] = []): DiligenceFlag[] {
  const f: DiligenceFlag[] = [];

  // ── WARN — buyer-unfavorable / needs verification ──
  const easements = meaningful(list(p, "Disclosures"));
  if (easements.length)
    f.push({
      id: "easements",
      kind: "warn",
      severity: 55,
      title: `Title carries easements or restrictions: ${easements.join(" · ")}`,
      source: "TRREB disclosure",
      ask: "Have your lawyer review the specifics before you firm up.",
    });

  const designation = meaningful(list(p, "SpecialDesignation"));
  if (designation.length)
    f.push({
      id: "designation",
      kind: "warn",
      severity: 50,
      title: `Special designation: ${designation.join(" · ")}`,
      source: "TRREB disclosure",
      ask: "Heritage / conservation / environmental status can restrict alterations — confirm scope.",
    });

  if (meaningful(list(p, "UFFI")).length)
    f.push({
      id: "uffi",
      kind: "warn",
      severity: 48,
      title: "UFFI insulation disclosed",
      source: "TRREB disclosure",
      ask: "Can affect financing and insurance — confirm remediation.",
    });

  if (p.WaterfrontYN === true || list(p, "Waterfront").length > 0 || str(p, "WaterBodyName"))
    f.push({
      id: "waterfront",
      kind: "warn",
      severity: 46,
      title: "Waterfront property",
      source: "TRREB feed",
      ask: "Confirm flood mapping, insurance availability and shoreline-allowance rules.",
    });

  const rented = dedupe(
    meaningful([...list(p, "RentalItems"), ...list(p, "LeaseToOwnEquipment"), ...list(p, "UnderContract")]),
  );
  if (rented.length)
    f.push({
      id: "rented_equipment",
      kind: "warn",
      severity: 44,
      title: `Equipment that transfers with the home: ${rented.join(" · ")}`,
      source: "TRREB disclosure",
      ask: "Rentals (water heater, furnace, softener) add to monthly carry — confirm buyout costs.",
    });

  if (p.LocalImprovements === true) {
    const note = str(p, "LocalImprovementsComments");
    f.push({
      id: "local_improvements",
      kind: "warn",
      severity: 40,
      title: `Local-improvement charges may apply${note ? `: ${note}` : ""}`,
      source: "TRREB disclosure",
      ask: "Confirm the outstanding balance and remaining term.",
    });
  }

  if (p.SeasonalDwelling === true)
    f.push({
      id: "seasonal",
      kind: "warn",
      severity: 38,
      title: "Seasonal dwelling",
      source: "TRREB feed",
      ask: "Year-round financing and insurance may differ — confirm with your lender.",
    });

  const age = str(p, "ApproximateAge");
  if (age && /(51-99|100\+|99\+|over\s*100)/i.test(age) && p.NewConstructionYN !== true)
    f.push({
      id: "older_home",
      kind: "warn",
      severity: 34,
      title: `Older home (${age} yrs)`,
      source: "TRREB feed",
      ask: "Budget for roof, furnace and electrical lifecycle — verify ages on site.",
    });

  // ── INFO — upside / neutral context ──
  const kbg = num(p, "KitchensBelowGrade") ?? 0;
  const suiteStatus = str(p, "SuiteStatus");
  if (suiteStatus === "EXISTING_SUITE")
    f.push({
      id: "suite",
      kind: "info",
      severity: 28,
      title: "Existing second-unit / suite",
      source: "Derived from feed",
    });
  else if (kbg > 0 || suiteStatus === "POTENTIAL_CANDIDATE")
    f.push({
      id: "suite",
      kind: "info",
      severity: 26,
      title: "Basement-suite potential (kitchen below grade)",
      source: "Derived from feed",
      ask: "Confirm legal second-unit eligibility with the municipality.",
    });

  if (p.is_density_ready === true || p.multiplex_by_right === true)
    f.push({
      id: "density",
      kind: "info",
      severity: 25,
      title: "Density-ready zoning — garden suite / multiplex potential",
      source: "Zoning overlay",
    });

  const dir = str(p, "DirectionFaces");
  if (dir && /north/i.test(dir))
    f.push({
      id: "orientation",
      kind: "info",
      severity: 18,
      title: `Front faces ${dir.toLowerCase()}`,
      source: "Feed (DirectionFaces)",
      ask: "A north-facing front means a south-exposed back yard, but front rooms see less direct sun.",
    });

  return [...f, ...external].sort((a, b) =>
    a.kind === b.kind ? b.severity - a.severity : a.kind === "warn" ? -1 : 1,
  );
}
