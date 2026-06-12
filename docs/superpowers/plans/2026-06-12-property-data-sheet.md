# Property Data Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the full TRREB payload on the listing detail page as one "Property Data Sheet" (deterministic field registry → chip-nav + 2-column accordion grid), replacing the Structural Vitals and Property Summary sections.

**Architecture:** A pure server-side field registry (`src/lib/property/datasheet.ts`) maps payload keys → labeled, formatted, grouped rows; `page.tsx` calls `buildDatasheet(payload)` and passes plain JSON to a small client component (`PropertyDataSheet.tsx`) that owns only collapse state + chip navigation. Spec: `docs/superpowers/specs/2026-06-12-property-data-sheet-design.md`.

**Tech Stack:** Next.js App Router (server page + client island), TypeScript, Tailwind (slate/terminal palette), vitest (node env, pure logic only — no render tests).

**Branch:** `feat/property-data-sheet` (already cut from origin/main).

**Compliance invariants (do not violate):**
- Field values verbatim — formatting limited to units, currency, `" · "` array joins (IDX §6.3(f)).
- Registry must NOT contain sold-outcome VOW fields (`ClosePrice`, `CloseDate`, `ClosePriceHold`, `CloseDateHold`, `PurchaseContractDate`, `SoldEntryTimestamp`, `SoldConditionalEntryTimestamp`) or broker-workflow fields (`ShowingRequirements`, `ShowingAppointments`, `PrivateRemarks`, `ExpirationDate`, `HoldoverDays`).
- No LLM transformation anywhere (CLAUDE.md §4); all formatters deterministic.
- Windows env: use `npm.cmd` / `npx.cmd`.

---

### Task 1: Registry core — types, helpers, Vitals group

**Files:**
- Create: `src/lib/property/datasheet.ts`
- Test: `src/lib/property/datasheet.test.ts` (co-located, matching repo convention e.g. `src/lib/property/listingStatus.test.ts`)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/property/datasheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDatasheet, type RawPayload } from "./datasheet";

/** Realistic detached-house payload (subset of a real IDX response shape). */
export const DETACHED: RawPayload = {
  PropertySubType: "Detached",
  PropertyType: "Residential",
  ArchitecturalStyle: ["2-Storey"],
  ApproximateAge: "16-30",
  LotWidth: 46,
  LotDepth: 117.25,
  LotSizeUnits: "Feet",
  DirectionFaces: "West",
  HeatType: "Forced Air",
  HeatSource: "Electric",
  Cooling: ["Central Air"],
  Basement: ["Full", "Finished"],
  KitchensTotal: 1,
  KitchensAboveGrade: 1,
  KitchensBelowGrade: 0,
  RoomsAboveGrade: 10,
  RoomsBelowGrade: 4,
  BedroomsTotal: 4,
  BedroomsAboveGrade: 4,
  BedroomsBelowGrade: 0,
};

function rows(payload: RawPayload, groupId: string) {
  const g = buildDatasheet(payload).find((x) => x.group.id === groupId);
  return g ? g.rows : [];
}

function rowValue(payload: RawPayload, groupId: string, label: string) {
  return rows(payload, groupId).find((r) => r.label === label)?.value;
}

describe("buildDatasheet — vitals", () => {
  it("renders the absorbed Structural Vitals / Property Summary rows", () => {
    expect(rowValue(DETACHED, "vitals", "Property Type")).toBe("Detached");
    expect(rowValue(DETACHED, "vitals", "Style")).toBe("2-Storey");
    expect(rowValue(DETACHED, "vitals", "Property Age")).toBe("16-30");
    expect(rowValue(DETACHED, "vitals", "Lot Dimensions")).toBe("46 x 117.25 Feet");
    expect(rowValue(DETACHED, "vitals", "Direction Faces")).toBe("West");
    expect(rowValue(DETACHED, "vitals", "Heating")).toBe("Forced Air · Electric");
    expect(rowValue(DETACHED, "vitals", "Cooling")).toBe("Central Air");
    expect(rowValue(DETACHED, "vitals", "Basement")).toBe("Full · Finished");
    expect(rowValue(DETACHED, "vitals", "Kitchens")).toBe("1 (1 above · 0 below)");
    expect(rowValue(DETACHED, "vitals", "Rooms")).toBe("10 above · 4 below");
    expect(rowValue(DETACHED, "vitals", "Bedrooms")).toBe("4 above · 0 below");
  });

  it("omits rows for missing values and drops empty groups entirely", () => {
    const sheet = buildDatasheet({});
    expect(sheet).toEqual([]);
  });

  it("never throws on garbage payloads", () => {
    const garbage: RawPayload = {
      Cooling: [null, 42, { nested: true }, "Central Air", ""],
      Basement: "Finished",
      LotWidth: "not-a-number",
      ArchitecturalStyle: 7,
      KitchensTotal: null,
    };
    const sheet = buildDatasheet(garbage);
    expect(rowValue(garbage, "vitals", "Cooling")).toBe("42 · Central Air");
    expect(rowValue(garbage, "vitals", "Basement")).toBe("Finished");
    expect(rowValue(garbage, "vitals", "Lot Dimensions")).toBeUndefined();
    expect(sheet.every((g) => g.rows.length > 0)).toBe(true);
  });

  it("passes values through verbatim (odd casing/spacing preserved modulo trim)", () => {
    const p: RawPayload = { ApproximateAge: "  New  ", DirectionFaces: "wEsT" };
    expect(rowValue(p, "vitals", "Property Age")).toBe("New");
    expect(rowValue(p, "vitals", "Direction Faces")).toBe("wEsT");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/property/datasheet.test.ts`
Expected: FAIL — `Cannot find module './datasheet'` (or equivalent resolve error).

- [ ] **Step 3: Write the registry core**

Create `src/lib/property/datasheet.ts`:

```ts
/**
 * Property Data Sheet field registry — deterministic payload→rows mapping.
 *
 * Compliance (IDX §6.3(f), CLAUDE.md §4): values are rendered VERBATIM — the only
 * "formatting" permitted is trimming, currency/locale number display, unit
 * suffixes from companion fields, and joining array fields with " · ".
 * No sold-outcome VOW fields and no broker-workflow fields may ever be added
 * here (they are policy-excluded; see datasheet.test.ts policy suite).
 *
 * Pure logic — no React, no Node APIs — so it is unit-testable in vitest's
 * node environment and callable from the server page.
 */

import { formatPrice } from "@/lib/utils";

export type RawPayload = Record<string, unknown>;

export type DatasheetGroupId =
  | "vitals"
  | "building"
  | "interior"
  | "exterior"
  | "condo"
  | "utilities"
  | "taxes"
  | "transaction"
  | "risk";

export interface ResolvedRow {
  key: string;
  label: string;
  value: string;
  /** External link rows (virtual tours). */
  href?: string;
  /** Amber risk accent (risk group rows with a concerning value). */
  flagged?: boolean;
}

export interface DatasheetGroupMeta {
  id: DatasheetGroupId;
  title: string;
}

export interface ResolvedGroup {
  group: DatasheetGroupMeta;
  rows: ResolvedRow[];
}

interface DatasheetField {
  key: string;
  label: string;
  group: DatasheetGroupId;
  format: (p: RawPayload) => string | null;
  href?: (p: RawPayload) => string | null;
  flag?: (p: RawPayload) => boolean;
}

// ── null-safe readers (CLAUDE.md §6: expect nulls, wrong types, empty arrays) ──

/** Non-empty trimmed string, else null. Numbers pass through as strings. */
function str(p: RawPayload, key: string): string | null {
  const v = p[key];
  if (typeof v === "string") {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Finite number, else null. */
function num(p: RawPayload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Array field → primitive members as trimmed strings; scalars wrap; else []. */
function list(p: RawPayload, key: string): string[] {
  const v = p[key];
  const arr = Array.isArray(v) ? v : v != null ? [v] : [];
  return arr
    .filter((x): x is string | number => typeof x === "string" || typeof x === "number")
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}

/** Joined array row value ("A · B"), null when empty. */
function joined(p: RawPayload, key: string): string | null {
  const items = list(p, key);
  return items.length > 0 ? items.join(" · ") : null;
}

/** Boolean flag → "Yes" only when strictly true (a "No" row is noise). */
function yes(p: RawPayload, key: string): string | null {
  return p[key] === true ? "Yes" : null;
}

/** Currency display, null unless a positive finite number. */
function money(p: RawPayload, key: string): string | null {
  const v = num(p, key);
  return v !== null && v > 0 ? formatPrice(v) : null;
}

// ── group metadata (registry order = default display order) ──

const GROUPS: DatasheetGroupMeta[] = [
  { id: "vitals", title: "Vitals" },
  { id: "building", title: "Building & Construction" },
  { id: "interior", title: "Interior" },
  { id: "exterior", title: "Exterior, Lot & Land" },
  { id: "condo", title: "Condo & Building" },
  { id: "utilities", title: "Utilities & Systems" },
  { id: "taxes", title: "Taxes & Assessment" },
  { id: "transaction", title: "Transaction & Possession" },
  { id: "risk", title: "Risk & Disclosures" },
];

/** Condo group applies only to condo-class subtypes (objective criteria, §6.3(f)). */
function isCondoClass(p: RawPayload): boolean {
  const sub = (str(p, "PropertySubType") ?? "").toLowerCase();
  return sub.includes("condo") || sub.includes("co-op") || sub.includes("co-ownership");
}

const GROUP_APPLIES: Partial<Record<DatasheetGroupId, (p: RawPayload) => boolean>> = {
  condo: isCondoClass,
};

// ── field registry ──

const FIELDS: DatasheetField[] = [
  // ── Vitals (absorbs the old Structural Vitals + Property Summary sections) ──
  {
    key: "PropertySubType",
    label: "Property Type",
    group: "vitals",
    format: (p) => str(p, "PropertySubType") ?? str(p, "PropertyType"),
  },
  { key: "ArchitecturalStyle", label: "Style", group: "vitals", format: (p) => joined(p, "ArchitecturalStyle") },
  { key: "ApproximateAge", label: "Property Age", group: "vitals", format: (p) => str(p, "ApproximateAge") },
  {
    key: "LotWidth",
    label: "Lot Dimensions",
    group: "vitals",
    format: (p) => {
      const w = num(p, "LotWidth");
      if (w === null || w <= 0) return null;
      const d = num(p, "LotDepth");
      const units = str(p, "LotSizeUnits");
      return [`${w} x ${d ?? "N/A"}`, units].filter(Boolean).join(" ");
    },
  },
  { key: "DirectionFaces", label: "Direction Faces", group: "vitals", format: (p) => str(p, "DirectionFaces") },
  {
    key: "HeatType",
    label: "Heating",
    group: "vitals",
    format: (p) => [str(p, "HeatType"), str(p, "HeatSource")].filter(Boolean).join(" · ") || null,
  },
  { key: "Cooling", label: "Cooling", group: "vitals", format: (p) => joined(p, "Cooling") },
  { key: "Basement", label: "Basement", group: "vitals", format: (p) => joined(p, "Basement") },
  {
    key: "KitchensTotal",
    label: "Kitchens",
    group: "vitals",
    format: (p) => {
      const total = num(p, "KitchensTotal");
      const above = num(p, "KitchensAboveGrade");
      const below = num(p, "KitchensBelowGrade");
      if (total === null && above === null && below === null) return null;
      return `${total ?? 0} (${above ?? 0} above · ${below ?? 0} below)`;
    },
  },
  {
    key: "RoomsAboveGrade",
    label: "Rooms",
    group: "vitals",
    format: (p) => {
      const above = num(p, "RoomsAboveGrade");
      const below = num(p, "RoomsBelowGrade");
      if (above === null && below === null) return null;
      return `${above ?? 0} above · ${below ?? 0} below`;
    },
  },
  {
    key: "BedroomsAboveGrade",
    label: "Bedrooms",
    group: "vitals",
    format: (p) => {
      const above = num(p, "BedroomsAboveGrade") ?? num(p, "BedroomsTotal");
      const below = num(p, "BedroomsBelowGrade");
      if (above === null && below === null) return null;
      return `${above ?? 0} above · ${below ?? 0} below`;
    },
  },
];

const DEFAULT_ORDER: DatasheetGroupId[] = GROUPS.map((g) => g.id);

/**
 * Resolve the registry against a payload. Only populated rows are returned;
 * groups with zero rows are dropped. `order` is the future persona-lens /
 * per-user reorder seam — it may reorder groups but can never add or remove
 * fields (per-user hiding is compliance-gated; see spec).
 */
export function buildDatasheet(p: RawPayload, order?: DatasheetGroupId[]): ResolvedGroup[] {
  const groupOrder = order && order.length > 0 ? order : DEFAULT_ORDER;
  const out: ResolvedGroup[] = [];
  for (const id of groupOrder) {
    const meta = GROUPS.find((g) => g.id === id);
    if (!meta) continue;
    const applies = GROUP_APPLIES[id];
    if (applies && !applies(p)) continue;
    const rows: ResolvedRow[] = [];
    for (const f of FIELDS) {
      if (f.group !== id) continue;
      let value: string | null = null;
      try {
        value = f.format(p);
      } catch {
        value = null; // formatter must never take the page down on garbage feed data
      }
      if (value === null) continue;
      const row: ResolvedRow = { key: f.key, label: f.label, value };
      if (f.href) {
        try {
          const href = f.href(p);
          if (href) row.href = href;
        } catch {
          /* omit link, keep row */
        }
      }
      if (f.flag) {
        try {
          row.flagged = f.flag(p);
        } catch {
          row.flagged = false;
        }
      }
      rows.push(row);
    }
    if (rows.length > 0) out.push({ group: meta, rows });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/property/datasheet.test.ts`
Expected: PASS (4 tests).

Note: the garbage test expects `Cooling: [null, 42, {...}, "Central Air", ""]` → `"42 · Central Air"` (primitives kept, objects/empties dropped) — confirm that exact value.

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/datasheet.ts src/lib/property/datasheet.test.ts
git commit -m "feat(listing): data sheet registry core — vitals group, null-safe formatters"
```

---

### Task 2: Remaining groups — building/interior/exterior/condo/utilities/taxes/transaction/risk

**Files:**
- Modify: `src/lib/property/datasheet.ts` (append to `FIELDS`)
- Modify: `src/lib/property/datasheet.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/property/datasheet.test.ts`:

```ts
const CONDO: RawPayload = {
  PropertySubType: "Condo Apartment",
  AssociationAmenities: ["Gym", "Concierge", "Visitor Parking"],
  BalconyType: "Open",
  Exposure: "Se",
  Locker: "Owned",
  LockerLevel: "B",
  LockerUnit: "27",
  PetsAllowed: ["Restricted"],
  AssociationFeeIncludes: ["Heat Included", "Water Included"],
  CondoCorpNumber: 1234,
  AssociationName: "TSCC",
  PropertyManagementCompany: "Crossbridge",
  LegalStories: "12",
};

describe("buildDatasheet — group coverage", () => {
  it("building & construction", () => {
    const p: RawPayload = {
      ConstructionMaterials: ["Brick", "Stone"],
      FoundationDetails: ["Concrete"],
      Roof: ["Shingles"],
      StructureType: ["House"],
      PropertyAttachedYN: false,
      NewConstructionYN: true,
      LivingAreaRange: "2000-2500",
      SquareFootSource: "MPAC",
    };
    expect(rowValue(p, "building", "Construction")).toBe("Brick · Stone");
    expect(rowValue(p, "building", "Foundation")).toBe("Concrete");
    expect(rowValue(p, "building", "Roof")).toBe("Shingles");
    expect(rowValue(p, "building", "New Construction")).toBe("Yes");
    // boolean false → row omitted (only-true policy)
    expect(rowValue(p, "building", "Attached")).toBeUndefined();
    expect(rowValue(p, "building", "Approx. Square Footage")).toBe("2000-2500");
    expect(rowValue(p, "building", "Sqft Source")).toBe("MPAC");
  });

  it("interior", () => {
    const p: RawPayload = {
      InteriorFeatures: ["Built-In Oven", "Central Vacuum"],
      FireplaceYN: true,
      FireplaceFeatures: ["Natural Gas"],
      CentralVacuumYN: true,
      EnsuiteLaundryYN: true,
      LaundryFeatures: ["Ensuite"],
      DenFamilyroomYN: true,
      ElevatorYN: true,
      Furnished: "Unfurnished",
      AccessibilityFeatures: ["Ramped Entrance"],
      SeniorCommunityYN: true,
    };
    expect(rowValue(p, "interior", "Interior Features")).toBe("Built-In Oven · Central Vacuum");
    expect(rowValue(p, "interior", "Fireplace")).toBe("Natural Gas");
    expect(rowValue(p, "interior", "Central Vacuum")).toBe("Yes");
    expect(rowValue(p, "interior", "Family Room")).toBe("Yes");
    expect(rowValue(p, "interior", "Furnished")).toBe("Unfurnished");
    // FireplaceYN true with no features still shows "Yes"
    expect(rowValue({ FireplaceYN: true }, "interior", "Fireplace")).toBe("Yes");
  });

  it("exterior, lot & land", () => {
    const p: RawPayload = {
      ExteriorFeatures: ["Awnings", "Patio"],
      LotShape: "Pie",
      LotIrregularities: "Widens at rear",
      LotFeatures: ["Cul de Sac/Dead End"],
      LotSizeRangeAcres: "< .50",
      PoolFeatures: ["Inground"],
      SpaYN: true,
      View: ["Pond"],
      WaterfrontYN: true,
      Waterfront: ["Direct"],
      WaterBodyName: "Lake Simcoe",
      Topography: ["Flat"],
      OtherStructures: ["Garden Shed"],
      GarageType: "Attached",
      CoveredSpaces: 2,
      ParkingSpaces: 4,
      ParkingFeatures: ["Private Double"],
    };
    expect(rowValue(p, "exterior", "Exterior Features")).toBe("Awnings · Patio");
    expect(rowValue(p, "exterior", "Lot Shape")).toBe("Pie");
    expect(rowValue(p, "exterior", "Pool")).toBe("Inground");
    expect(rowValue(p, "exterior", "Waterfront")).toBe("Direct");
    expect(rowValue(p, "exterior", "Body of Water")).toBe("Lake Simcoe");
    expect(rowValue(p, "exterior", "Garage Type")).toBe("Attached");
    expect(rowValue(p, "exterior", "Garage Spaces")).toBe("2");
    expect(rowValue(p, "exterior", "Drive Parking")).toBe("4");
  });

  it("condo group renders for condo-class subtypes only", () => {
    expect(rowValue(CONDO, "condo", "Building Amenities")).toBe("Gym · Concierge · Visitor Parking");
    expect(rowValue(CONDO, "condo", "Balcony")).toBe("Open");
    expect(rowValue(CONDO, "condo", "Exposure")).toBe("Se");
    expect(rowValue(CONDO, "condo", "Locker")).toBe("Owned · Level B · Unit 27");
    expect(rowValue(CONDO, "condo", "Pets")).toBe("Restricted");
    expect(rowValue(CONDO, "condo", "Fee Includes")).toBe("Heat Included · Water Included");
    expect(rowValue(CONDO, "condo", "Condo Corp #")).toBe("1234");
    expect(rowValue(CONDO, "condo", "Level")).toBe("12");
    // Detached payload with condo fields present → condo group still suppressed
    const detachedWithNoise: RawPayload = { ...CONDO, PropertySubType: "Detached" };
    expect(rows(detachedWithNoise, "condo")).toEqual([]);
  });

  it("utilities & systems", () => {
    const p: RawPayload = {
      WaterSource: ["Municipal"],
      Sewer: ["Sewer"],
      ElectricYNA: "Available",
      CableYNA: "Available",
      GasYNA: "Available",
      AlternativePower: ["Solar"],
      Amps: 200,
      Volts: 240,
      RuralUtilities: ["Internet High Speed"],
      SecurityFeatures: ["Alarm System"],
    };
    expect(rowValue(p, "utilities", "Water")).toBe("Municipal");
    expect(rowValue(p, "utilities", "Sewer")).toBe("Sewer");
    expect(rowValue(p, "utilities", "Hydro")).toBe("Available");
    expect(rowValue(p, "utilities", "Amps")).toBe("200");
    expect(rowValue(p, "utilities", "Volts")).toBe("240");
    // VOW-only scalar fallback: Water string when WaterSource array missing
    expect(rowValue({ Water: "Municipal" }, "utilities", "Water")).toBe("Municipal");
  });

  it("taxes & assessment", () => {
    const p: RawPayload = {
      TaxAnnualAmount: 8456.34,
      TaxYear: 2024,
      TaxAssessedValue: 910000,
      AssessmentYear: 2024,
      TaxType: "Annual",
      RollNumber: "211012000123400",
      TaxLegalDescription: "LOT 12, PLAN 43M-1234",
      AdditionalMonthlyFee: 120,
      AdditionalMonthlyFeeFrequency: "Monthly",
    };
    expect(rowValue(p, "taxes", "Annual Taxes")).toMatch(/8,456/);
    expect(rowValue(p, "taxes", "Annual Taxes")).toContain("(2024)");
    expect(rowValue(p, "taxes", "Assessed Value")).toMatch(/910,000/);
    expect(rowValue(p, "taxes", "Assessed Value")).toContain("(2024)");
    expect(rowValue(p, "taxes", "Assessment Roll #")).toBe("211012000123400");
    expect(rowValue(p, "taxes", "Legal Description")).toBe("LOT 12, PLAN 43M-1234");
    expect(rowValue(p, "taxes", "POTL Monthly Fee")).toMatch(/120.*Monthly/);
  });

  it("transaction & possession (incl. virtual tour link rows)", () => {
    const p: RawPayload = {
      PossessionType: "Flexible",
      PossessionDetails: "TBA 30-60 days",
      OccupantType: "Tenant",
      HSTApplication: ["Included"],
      ChattelsYN: true,
      VirtualTourURLUnbranded: "https://tour.example.com/abc",
    };
    expect(rowValue(p, "transaction", "Possession")).toBe("Flexible");
    expect(rowValue(p, "transaction", "Possession Notes")).toBe("TBA 30-60 days");
    expect(rowValue(p, "transaction", "Occupancy")).toBe("Tenant");
    expect(rowValue(p, "transaction", "Chattels Included")).toBe("Yes");
    const tour = rows(p, "transaction").find((r) => r.label === "Virtual Tour");
    expect(tour?.href).toBe("https://tour.example.com/abc");
    expect(tour?.value).toBe("View tour");
    // Non-http(s) URL → link suppressed entirely
    expect(rows({ VirtualTourURLUnbranded: "javascript:alert(1)" }, "transaction")).toEqual([]);
  });

  it("risk & disclosures with flag semantics", () => {
    const risky: RawPayload = {
      UFFI: "Yes",
      Disclosures: ["Easement", "Right Of Way"],
      LocalImprovements: true,
      LocalImprovementsComments: "Road paving levy until 2027",
      SpecialDesignation: ["Heritage"],
      SeasonalDwelling: true,
    };
    const r = rows(risky, "risk");
    expect(r.find((x) => x.label === "UFFI")).toMatchObject({ value: "Yes", flagged: true });
    expect(r.find((x) => x.label === "Easements / Restrictions")).toMatchObject({
      value: "Easement · Right Of Way",
      flagged: true,
    });
    expect(r.find((x) => x.label === "Local Improvements")).toMatchObject({ value: "Yes", flagged: true });
    expect(r.find((x) => x.label === "Local Improvements Notes")).toMatchObject({
      value: "Road paving levy until 2027",
    });
    expect(r.find((x) => x.label === "Special Designation")).toMatchObject({ flagged: true });
    // Benign values render unflagged ("None" is useful affirmative absence)
    const benign: RawPayload = { UFFI: "No", Disclosures: ["None"], SpecialDesignation: ["Unknown"] };
    const b = rows(benign, "risk");
    expect(b.find((x) => x.label === "UFFI")).toMatchObject({ value: "No", flagged: false });
    expect(b.find((x) => x.label === "Easements / Restrictions")).toMatchObject({ flagged: false });
    expect(b.find((x) => x.label === "Special Designation")).toMatchObject({ flagged: false });
  });
});

describe("buildDatasheet — policy & ordering", () => {
  it("never renders excluded VOW-sold or broker-workflow fields", () => {
    const hostile: RawPayload = {
      ...DETACHED,
      ClosePrice: 999999,
      CloseDate: "2026-01-01",
      ClosePriceHold: 999999,
      PurchaseContractDate: "2026-01-01",
      SoldEntryTimestamp: "2026-01-01T00:00:00Z",
      ShowingRequirements: ["Lockbox"],
      ShowingAppointments: "Call LBO",
      PrivateRemarks: "seller motivated",
      ExpirationDate: "2026-09-01",
      HoldoverDays: 90,
    };
    const allText = JSON.stringify(buildDatasheet(hostile));
    expect(allText).not.toContain("999999");
    expect(allText).not.toContain("999,999");
    expect(allText).not.toContain("Lockbox");
    expect(allText).not.toContain("seller motivated");
    expect(allText).not.toContain("Call LBO");
  });

  it("order param reorders groups without dropping any", () => {
    const p: RawPayload = { ...DETACHED, TaxAnnualAmount: 5000 };
    const reordered = buildDatasheet(p, ["taxes", "vitals"]);
    expect(reordered.map((g) => g.group.id)).toEqual(["taxes", "vitals"]);
    const defaultIds = buildDatasheet(p).map((g) => g.group.id);
    expect(defaultIds).toEqual(["vitals", "taxes"]);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx.cmd vitest run src/lib/property/datasheet.test.ts`
Expected: Task 1 tests PASS; all new `group coverage` tests FAIL (rows undefined).

- [ ] **Step 3: Append the remaining field definitions**

In `src/lib/property/datasheet.ts`, add two helpers after `money` and append to `FIELDS` (before the closing `];`):

```ts
/** Only http(s) URLs are linkable; anything else is dropped (defence vs feed garbage). */
function safeUrl(p: RawPayload, key: string): string | null {
  const v = str(p, key);
  return v && /^https?:\/\//i.test(v) ? v : null;
}

/** True when a risk value is "concerning": present and not a benign None/No/Unknown. */
function concerning(values: string[]): boolean {
  const benign = /^(no|none|unknown|n\/a)$/i;
  return values.some((v) => !benign.test(v));
}
```

```ts
  // ── Building & Construction ──
  { key: "ConstructionMaterials", label: "Construction", group: "building", format: (p) => joined(p, "ConstructionMaterials") },
  { key: "FoundationDetails", label: "Foundation", group: "building", format: (p) => joined(p, "FoundationDetails") },
  { key: "Roof", label: "Roof", group: "building", format: (p) => joined(p, "Roof") },
  { key: "StructureType", label: "Structure", group: "building", format: (p) => joined(p, "StructureType") },
  { key: "PropertyAttachedYN", label: "Attached", group: "building", format: (p) => yes(p, "PropertyAttachedYN") },
  { key: "NewConstructionYN", label: "New Construction", group: "building", format: (p) => yes(p, "NewConstructionYN") },
  { key: "LinkYN", label: "Link Property", group: "building", format: (p) => yes(p, "LinkYN") },
  { key: "BuilderName", label: "Builder", group: "building", format: (p) => str(p, "BuilderName") },
  { key: "LivingAreaRange", label: "Approx. Square Footage", group: "building", format: (p) => str(p, "LivingAreaRange") },
  { key: "SquareFootSource", label: "Sqft Source", group: "building", format: (p) => str(p, "SquareFootSource") },

  // ── Interior ──
  { key: "InteriorFeatures", label: "Interior Features", group: "interior", format: (p) => joined(p, "InteriorFeatures") },
  {
    key: "FireplaceYN",
    label: "Fireplace",
    group: "interior",
    format: (p) => {
      const features = joined(p, "FireplaceFeatures");
      const count = num(p, "FireplacesTotal");
      if (features) return count && count > 1 ? `${count} · ${features}` : features;
      if (p["FireplaceYN"] === true) return count && count > 1 ? `${count}` : "Yes";
      return null;
    },
  },
  { key: "CentralVacuumYN", label: "Central Vacuum", group: "interior", format: (p) => yes(p, "CentralVacuumYN") },
  { key: "EnsuiteLaundryYN", label: "Ensuite Laundry", group: "interior", format: (p) => yes(p, "EnsuiteLaundryYN") },
  { key: "LaundryFeatures", label: "Laundry Access", group: "interior", format: (p) => joined(p, "LaundryFeatures") },
  { key: "DenFamilyroomYN", label: "Family Room", group: "interior", format: (p) => yes(p, "DenFamilyroomYN") },
  {
    key: "ElevatorYN",
    label: "Elevator",
    group: "interior",
    format: (p) => str(p, "ElevatorType") ?? yes(p, "ElevatorYN"),
  },
  { key: "Furnished", label: "Furnished", group: "interior", format: (p) => str(p, "Furnished") },
  { key: "AccessibilityFeatures", label: "Accessibility", group: "interior", format: (p) => joined(p, "AccessibilityFeatures") },
  { key: "SeniorCommunityYN", label: "Retirement Community", group: "interior", format: (p) => yes(p, "SeniorCommunityYN") },

  // ── Exterior, Lot & Land ──
  { key: "ExteriorFeatures", label: "Exterior Features", group: "exterior", format: (p) => joined(p, "ExteriorFeatures") },
  { key: "LotShape", label: "Lot Shape", group: "exterior", format: (p) => str(p, "LotShape") },
  { key: "LotIrregularities", label: "Lot Irregularities", group: "exterior", format: (p) => str(p, "LotIrregularities") },
  { key: "LotFeatures", label: "Lot Features", group: "exterior", format: (p) => joined(p, "LotFeatures") },
  { key: "LotSizeRangeAcres", label: "Acreage", group: "exterior", format: (p) => str(p, "LotSizeRangeAcres") },
  { key: "PoolFeatures", label: "Pool", group: "exterior", format: (p) => joined(p, "PoolFeatures") },
  { key: "SpaYN", label: "Spa / Hot Tub", group: "exterior", format: (p) => yes(p, "SpaYN") },
  { key: "View", label: "View", group: "exterior", format: (p) => joined(p, "View") },
  {
    key: "WaterfrontYN",
    label: "Waterfront",
    group: "exterior",
    format: (p) =>
      joined(p, "Waterfront") ?? joined(p, "WaterfrontFeatures") ?? yes(p, "WaterfrontYN"),
  },
  { key: "WaterBodyName", label: "Body of Water", group: "exterior", format: (p) => str(p, "WaterBodyName") },
  { key: "Topography", label: "Topography", group: "exterior", format: (p) => joined(p, "Topography") },
  { key: "OtherStructures", label: "Other Structures", group: "exterior", format: (p) => joined(p, "OtherStructures") },
  { key: "GarageType", label: "Garage Type", group: "exterior", format: (p) => str(p, "GarageType") },
  {
    key: "CoveredSpaces",
    label: "Garage Spaces",
    group: "exterior",
    format: (p) => {
      const v = num(p, "CoveredSpaces");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  {
    key: "ParkingSpaces",
    label: "Drive Parking",
    group: "exterior",
    format: (p) => {
      const v = num(p, "ParkingSpaces");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  { key: "ParkingFeatures", label: "Parking Features", group: "exterior", format: (p) => joined(p, "ParkingFeatures") },

  // ── Condo & Building (group gated by isCondoClass) ──
  { key: "AssociationAmenities", label: "Building Amenities", group: "condo", format: (p) => joined(p, "AssociationAmenities") },
  { key: "BalconyType", label: "Balcony", group: "condo", format: (p) => str(p, "BalconyType") },
  { key: "Exposure", label: "Exposure", group: "condo", format: (p) => str(p, "Exposure") },
  {
    key: "Locker",
    label: "Locker",
    group: "condo",
    format: (p) => {
      const parts = [
        str(p, "Locker"),
        str(p, "LockerLevel") ? `Level ${str(p, "LockerLevel")}` : null,
        str(p, "LockerUnit") ? `Unit ${str(p, "LockerUnit")}` : null,
        str(p, "LockerNumber") ? `#${str(p, "LockerNumber")}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join(" · ") : null;
    },
  },
  { key: "PetsAllowed", label: "Pets", group: "condo", format: (p) => joined(p, "PetsAllowed") },
  { key: "AssociationFeeIncludes", label: "Fee Includes", group: "condo", format: (p) => joined(p, "AssociationFeeIncludes") },
  { key: "CondoCorpNumber", label: "Condo Corp #", group: "condo", format: (p) => str(p, "CondoCorpNumber") },
  { key: "AssociationName", label: "Registry Office", group: "condo", format: (p) => str(p, "AssociationName") },
  { key: "PropertyManagementCompany", label: "Property Management", group: "condo", format: (p) => str(p, "PropertyManagementCompany") },
  { key: "LegalStories", label: "Level", group: "condo", format: (p) => str(p, "LegalStories") },

  // ── Utilities & Systems ──
  {
    key: "WaterSource",
    label: "Water",
    group: "utilities",
    format: (p) => joined(p, "WaterSource") ?? str(p, "Water"),
  },
  { key: "Sewer", label: "Sewer", group: "utilities", format: (p) => joined(p, "Sewer") },
  { key: "ElectricYNA", label: "Hydro", group: "utilities", format: (p) => str(p, "ElectricYNA") },
  { key: "CableYNA", label: "Cable", group: "utilities", format: (p) => str(p, "CableYNA") },
  { key: "GasYNA", label: "Gas", group: "utilities", format: (p) => str(p, "GasYNA") },
  { key: "AlternativePower", label: "Alternative Power", group: "utilities", format: (p) => joined(p, "AlternativePower") },
  {
    key: "Amps",
    label: "Amps",
    group: "utilities",
    format: (p) => {
      const v = num(p, "Amps");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  {
    key: "Volts",
    label: "Volts",
    group: "utilities",
    format: (p) => {
      const v = num(p, "Volts");
      return v !== null && v > 0 ? String(v) : null;
    },
  },
  { key: "RuralUtilities", label: "Rural Services", group: "utilities", format: (p) => joined(p, "RuralUtilities") },
  { key: "SecurityFeatures", label: "Sprinklers / Security", group: "utilities", format: (p) => joined(p, "SecurityFeatures") },

  // ── Taxes & Assessment ──
  {
    key: "TaxAnnualAmount",
    label: "Annual Taxes",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "TaxAnnualAmount");
      if (!amount) return null;
      const year = num(p, "TaxYear");
      return year ? `${amount} (${year})` : amount;
    },
  },
  {
    key: "TaxAssessedValue",
    label: "Assessed Value",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "TaxAssessedValue");
      if (!amount) return null;
      const year = num(p, "AssessmentYear");
      return year ? `${amount} (${year})` : amount;
    },
  },
  { key: "TaxType", label: "Tax Type", group: "taxes", format: (p) => str(p, "TaxType") },
  { key: "RollNumber", label: "Assessment Roll #", group: "taxes", format: (p) => str(p, "RollNumber") },
  { key: "TaxLegalDescription", label: "Legal Description", group: "taxes", format: (p) => str(p, "TaxLegalDescription") },
  {
    key: "AdditionalMonthlyFee",
    label: "POTL Monthly Fee",
    group: "taxes",
    format: (p) => {
      const amount = money(p, "AdditionalMonthlyFee");
      if (!amount) return null;
      const freq = str(p, "AdditionalMonthlyFeeFrequency");
      return freq ? `${amount} · ${freq}` : amount;
    },
  },

  // ── Transaction & Possession ──
  { key: "PossessionType", label: "Possession", group: "transaction", format: (p) => str(p, "PossessionType") },
  { key: "PossessionDetails", label: "Possession Notes", group: "transaction", format: (p) => str(p, "PossessionDetails") },
  { key: "OccupantType", label: "Occupancy", group: "transaction", format: (p) => str(p, "OccupantType") },
  { key: "HSTApplication", label: "HST", group: "transaction", format: (p) => joined(p, "HSTApplication") },
  { key: "ChattelsYN", label: "Chattels Included", group: "transaction", format: (p) => yes(p, "ChattelsYN") },
  {
    key: "VirtualTourURLUnbranded",
    label: "Virtual Tour",
    group: "transaction",
    format: (p) => (safeUrl(p, "VirtualTourURLUnbranded") ? "View tour" : null),
    href: (p) => safeUrl(p, "VirtualTourURLUnbranded"),
  },
  {
    key: "VirtualTourURLBranded",
    label: "Virtual Tour (branded)",
    group: "transaction",
    format: (p) => (safeUrl(p, "VirtualTourURLBranded") ? "View tour" : null),
    href: (p) => safeUrl(p, "VirtualTourURLBranded"),
  },

  // ── Risk & Disclosures ──
  {
    key: "UFFI",
    label: "UFFI",
    group: "risk",
    format: (p) => str(p, "UFFI"),
    flag: (p) => concerning([str(p, "UFFI") ?? ""].filter(Boolean)),
  },
  {
    key: "Disclosures",
    label: "Easements / Restrictions",
    group: "risk",
    format: (p) => joined(p, "Disclosures"),
    flag: (p) => concerning(list(p, "Disclosures")),
  },
  {
    key: "LocalImprovements",
    label: "Local Improvements",
    group: "risk",
    format: (p) => yes(p, "LocalImprovements"),
    flag: (p) => p["LocalImprovements"] === true,
  },
  {
    key: "LocalImprovementsComments",
    label: "Local Improvements Notes",
    group: "risk",
    format: (p) => str(p, "LocalImprovementsComments"),
  },
  {
    key: "SpecialDesignation",
    label: "Special Designation",
    group: "risk",
    format: (p) => joined(p, "SpecialDesignation"),
    flag: (p) => concerning(list(p, "SpecialDesignation")),
  },
  { key: "SeasonalDwelling", label: "Seasonal Dwelling", group: "risk", format: (p) => yes(p, "SeasonalDwelling") },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/property/datasheet.test.ts`
Expected: PASS (all suites). If the risk-flag tests fail on `flagged: false` vs `undefined`, note `buildDatasheet` sets `row.flagged` whenever `f.flag` exists (it always evaluates, defaulting to false on throw) — assert accordingly.

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/datasheet.ts src/lib/property/datasheet.test.ts
git commit -m "feat(listing): data sheet registry — all 9 field groups, condo gating, risk flags, policy exclusions"
```

---

### Task 3: PropertyDataSheet client component (chip nav + accordion grid)

**Files:**
- Create: `src/components/Property/PropertyDataSheet.tsx` (note existing capital-P `Property` dir, matching `UnderwritingSandbox.tsx` etc.)

No unit test (UI component; repo convention is typecheck/lint/build + manual — vitest is node-env, no jsdom).

- [ ] **Step 1: Write the component**

```tsx
"use client";

/**
 * Property Data Sheet — chip-nav + 2-column accordion grid (spec 2026-06-12).
 *
 * Server page resolves the registry (buildDatasheet) and passes plain JSON;
 * this island owns ONLY collapse state and chip scroll-jumps. All group
 * content is server-rendered open (crawlers / no-JS see every field); we
 * collapse the long tail on mobile after mount (progressive enhancement).
 */

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ExternalLink, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedGroup } from "@/lib/property/datasheet";

export default function PropertyDataSheet({ groups }: { groups: ResolvedGroup[] }) {
  // SSR + first paint: everything open. After mount, collapse all but the
  // first group on small screens (matches spec: mobile = 9 tappable headers).
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((g) => [g.group.id, true])),
  );
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(max-width: 1023px)").matches) {
      setOpen((prev) => {
        const next = { ...prev };
        groups.forEach((g, i) => {
          next[g.group.id] = i === 0;
        });
        return next;
      });
    }
    // groups identity is stable per page load (server-resolved prop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (groups.length === 0) return null;

  const jumpTo = (id: string) => {
    setOpen((prev) => ({ ...prev, [id]: true }));
    // open first so the scroll target has its final height
    requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="mb-6">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        <Table2 className="h-4 w-4 text-emerald-400" />
        Property Data Sheet
      </h3>

      {/* Chip nav — tab-like wayfinding without hiding content */}
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap">
        {groups.map(({ group, rows }) => {
          const isRisk = group.id === "risk";
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => jumpTo(group.id)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 font-mono text-xs transition-colors",
                isRisk
                  ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                  : "border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-200",
              )}
            >
              {isRisk ? "⚠ " : ""}
              {group.title} · {rows.length}
            </button>
          );
        })}
      </div>

      {/* 2-col accordion card grid */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {groups.map(({ group, rows }) => {
          const isRisk = group.id === "risk";
          const isOpen = open[group.id] ?? true;
          return (
            <section
              key={group.id}
              id={`datasheet-${group.id}`}
              ref={(el) => {
                sectionRefs.current[group.id] = el;
              }}
              className={cn(
                "scroll-mt-6 rounded-lg border bg-slate-900/30",
                isRisk ? "border-amber-500/30" : "border-slate-800",
              )}
            >
              <button
                type="button"
                onClick={() => setOpen((prev) => ({ ...prev, [group.id]: !isOpen }))}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <span
                  className={cn(
                    "flex items-center gap-2 text-xs font-semibold uppercase tracking-wider",
                    isRisk ? "text-amber-300" : "text-slate-200",
                  )}
                >
                  {isRisk && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                  {group.title}
                  <span className="font-mono font-normal text-slate-500">· {rows.length}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-slate-500 transition-transform",
                    isOpen ? "rotate-180" : "rotate-0",
                  )}
                />
              </button>
              {/* hidden (not unmounted): content stays in the DOM for SEO/find-in-page */}
              <div className={cn("px-4 pb-4", !isOpen && "hidden")}>
                <div className="grid grid-cols-1 gap-y-2">
                  {rows.map((row) => (
                    <div key={row.key} className="flex items-baseline justify-between gap-4">
                      <span className="shrink-0 text-xs text-slate-500">{row.label}</span>
                      {row.href ? (
                        <a
                          href={row.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-cyan-500/40 px-2.5 py-0.5 font-mono text-xs text-cyan-300 hover:bg-cyan-500/10"
                        >
                          {row.value}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span
                          className={cn(
                            "text-right font-mono text-sm",
                            row.flagged ? "text-amber-300" : "text-slate-200",
                          )}
                        >
                          {row.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npm.cmd run typecheck` then `npm.cmd run lint`
Expected: both pass (warnings OK, zero errors). If `react-hooks/exhaustive-deps` flags the mount effect despite the disable comment, keep the comment placement directly above the dep array line.

- [ ] **Step 3: Commit**

```bash
git add src/components/Property/PropertyDataSheet.tsx
git commit -m "feat(listing): PropertyDataSheet — chip-nav + 2-col accordion grid client island"
```

---

### Task 4: Page integration — replace Structural Vitals + Property Summary

**Files:**
- Modify: `src/app/(app)/properties/[id]/page.tsx`

- [ ] **Step 1: Add imports**

In the import block (after the `RoomMap` import is fine):

```ts
import PropertyDataSheet from "@/components/Property/PropertyDataSheet";
import { buildDatasheet, type RawPayload } from "@/lib/property/datasheet";
```

- [ ] **Step 2: Remove the absorbed builders**

Delete from the page body (currently `page.tsx:281-313`):
- `const style = asArray(p.ArchitecturalStyle).join(", ");`
- `const basement = asArray(p.Basement).join(", ");`
- `const cooling = asArray(p.Cooling).join(", ");`
- the entire `const vitals: Array<{ label: string; value: string }> = [...]` block
- the entire `const summary: Array<{ label: string; value: string }> = [...]` block

Add in their place:

```ts
  const datasheet = buildDatasheet(detail.full_payload as RawPayload);
```

Then delete the now-unused `asArray` helper (`page.tsx:103-106`) — verify with a grep that nothing else in the file references it before deleting.

- [ ] **Step 3: Replace the two sections in JSX**

Delete both blocks (currently `page.tsx:464-488`):

```tsx
            {/* Structural Vitals */}
            <Section title="Structural Vitals" icon={<Home className="h-4 w-4 text-emerald-400" />}>
              ...
            </Section>

            {/* Property Summary (richer than the modal) */}
            <Section title="Property Summary" icon={<Building2 className="h-4 w-4 text-emerald-400" />}>
              ...
            </Section>
```

Insert in their place:

```tsx
            {/* Property Data Sheet — full TRREB payload, registry-driven (spec 2026-06-12) */}
            <PropertyDataSheet groups={datasheet} />
```

- [ ] **Step 4: Clean up dangling imports**

`Home` (lucide) was only used by the Structural Vitals section header — remove it from the lucide import if nothing else uses it (`Building2` is still used by the "Listed By" section and brokerage line; keep it). Verify with a grep for `<Home` in the file.

- [ ] **Step 5: Typecheck, lint, full test suite**

Run: `npm.cmd run typecheck && npm.cmd run lint && npm.cmd run test`
Expected: all pass (no unused-variable errors from the deletions; full suite green).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/properties/[id]/page.tsx"
git commit -m "feat(listing): replace Structural Vitals + Property Summary with registry-driven Property Data Sheet"
```

---

### Task 5: Build + manual verification + push

- [ ] **Step 1: Production build**

Run: `npm.cmd run build`
Expected: compiles clean (the page is `force-dynamic`; no static-generation surprises).

- [ ] **Step 2: Manual smoke test (requires `.env.local`)**

Run: `npm.cmd run dev`, then open a listing detail page (`/properties/<any listing id from the terminal list>`):
- Data sheet renders below the spec cells where Structural Vitals used to be; old two sections gone.
- Chip row shows populated groups with counts; clicking a chip scrolls to and opens that card.
- Desktop ≥1024px: 2-column card grid, all groups open.
- Narrow the window <1024px and reload: only the first group open, rest collapsed but expandable; chip row horizontally scrollable.
- A condo listing shows the Condo & Building card; a detached one doesn't.
- View page source (SSR HTML): collapsed groups' field values are present in the HTML.
- Check one listing with a virtual tour (pill opens in new tab) if findable.
- Verify the "deemed reliable but is not guaranteed accurate" notice is present on the page (site footer/disclaimers); if missing, add this line under the data sheet heading inside `PropertyDataSheet`: `<p className="mb-3 text-[10px] text-slate-600">Information deemed reliable but is not guaranteed accurate by PROPTX.</p>` (§6.3(i)).

- [ ] **Step 3: Push**

```bash
git push -u origin feat/property-data-sheet
```

---

## Self-review notes (run after drafting — completed)

- **Spec coverage:** registry + 9 groups (Tasks 1–2), condo gating (T2), risk flags (T2), policy exclusions test (T2), verbatim test (T1), order seam (T2 test), client island + chip nav + 2-col grid + mobile collapse + SSR-open SEO (T3), absorb-and-replace placement (T4), §6.3(i) notice check (T5). Virtual tour link rows: T2 + T3 pill rendering.
- **Type consistency:** `ResolvedGroup { group: DatasheetGroupMeta; rows: ResolvedRow[] }` is the shape used by both the test helpers (`find((x) => x.group.id === ...)`) and the component (`groups.map(({ group, rows }) => ...)`).
- **Known judgment calls (intentional):** boolean fields render only when `true`; "None"-type risk values render unflagged (affirmative absence is information); `Exposure: "Se"` rendered verbatim (no case normalization — §6.3(f)).
