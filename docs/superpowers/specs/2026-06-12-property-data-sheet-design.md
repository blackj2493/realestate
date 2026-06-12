# Property Data Sheet — Design

**Date:** 2026-06-12
**Status:** Approved by user (this doc records the validated design)
**Surface:** Individual listing page (`src/app/(app)/properties/[id]/page.tsx`)

## Problem

The listing page renders ~45 TRREB payload fields while 50+ display-safe fields sit
unrendered in `full_payload` — including persona-critical data (TaxAssessedValue,
OccupantType, AssociationAmenities, InteriorFeatures, virtual tour URLs) and the
entire condo block where HouseSigma currently beats us (amenities, balcony, locker,
exposure, pets). §10 quality bar: "more data visible" is the dimension we win here.

Strategy decision (recorded): render **essentially the entire payload** as one
structured "Property Data Sheet" rather than building a per-user field-picker.
Field-level *hiding* by users is deferred indefinitely (compliance-gray, see below);
per-user *reordering* is a designed-for future seam, not built now.

## Compliance ground rules (IDX agreement, verified 2026-06-12)

- **§6.3(f):** IDX content may not be changed; reformatting only to the extent of
  choosing which fields to display "based on objective criteria such as geography or
  type of property." Therefore: values rendered **verbatim** (formatting = units,
  currency, array joins only); conditional display keyed on property type (condo
  group) is explicitly sanctioned; **per-user field hiding is gray** and requires
  BoR sign-off before ever building.
- **§6.3(c):** Brokerage display untouched by this feature.
- **§6.3(i):** "deemed reliable but is not guaranteed accurate" notice must be
  present on the page; verify it exists, add to sheet footer if not.
- **CLAUDE.md §4:** all formatting deterministic, no LLM transformation.
- VOW-gated fields: the sheet reads the same server-gated `full_payload` the page
  already uses, so anon scrubbing (ClosePrice etc.) is inherited. The registry does
  not include sold-outcome fields at all (they live in SoldOutcomeCard).
- Excluded by policy (broker-workflow data, not consumer display):
  `ShowingRequirements`, `ShowingAppointments`, `PrivateRemarks` (not in feed
  anyway), expiry/holdover fields.

## Architecture

### 1. Field registry — `src/lib/property/datasheet.ts` (new)

Single ordered, deterministic registry. Pure data + pure functions; no React.

```ts
export type DatasheetField = {
  key: string;                 // payload key (or synthetic key for combined rows)
  label: string;               // display label
  group: DatasheetGroupId;
  format: (p: RawPayload) => string | null;  // null = omit row
  href?: (p: RawPayload) => string | null;   // external link rows (virtual tour)
  flag?: (p: RawPayload) => boolean;         // risk-row amber accent
};

export type DatasheetGroup = { id: DatasheetGroupId; title: string; icon: string };

export function buildDatasheet(
  p: RawPayload,
  order?: DatasheetGroupId[],   // future seam: persona lens / per-user reorder
): { group: DatasheetGroup; rows: ResolvedRow[] }[]
```

Formatter rules (CLAUDE.md §6 hardening):

- Every formatter null-safe against missing keys, empty arrays, empty strings,
  zero-vs-null ambiguity. Empty/blank → `null` → row omitted.
- Arrays joined with `" · "`. Currency via `toLocaleString` + `$`. Units appended
  from companion fields (e.g. `LotSizeUnits`), never assumed.
- Values verbatim — no rewording, casing changes, or truncation (§6.3(f)).
- Combined rows allowed where the feed splits one fact across fields
  (e.g. Locker + LockerLevel + LockerUnit → one "Locker" row).

`buildDatasheet` returns only populated rows; groups with zero rows are dropped.

### 2. Groups and field inventory (registry order)

Groups 1–2 **absorb** the page's current "Structural Vitals" and "Property Summary"
sections (their inline `vitals`/`summary` arrays move into the registry; the two old
sections are removed from `page.tsx`). One coherent sheet replaces three fragmented
fact sections.

1. **Vitals** (absorbed) — PropertySubType/PropertyType, ArchitecturalStyle,
   ApproximateAge, lot W×D + units, DirectionFaces, heat (HeatType · HeatSource),
   Cooling, Basement, kitchens (total/above/below), rooms above/below,
   beds above/below.
2. **Building & Construction** — ConstructionMaterials, FoundationDetails, Roof,
   PropertyAttachedYN, NewConstructionYN, LinkYN, StructureType, BuilderName,
   SquareFootSource, LivingAreaRange.
3. **Interior** — InteriorFeatures, FireplaceYN + FireplaceFeatures (+
   FireplacesTotal when present), CentralVacuumYN, EnsuiteLaundryYN,
   LaundryFeatures, DenFamilyroomYN, ElevatorYN/ElevatorType, Furnished,
   AccessibilityFeatures, SeniorCommunityYN.
4. **Exterior, Lot & Land** — ExteriorFeatures, LotShape, LotIrregularities,
   LotFeatures, LotSizeRangeAcres, PoolFeatures, SpaYN, View, WaterfrontYN +
   Waterfront/WaterfrontFeatures, WaterBodyName, Topography, OtherStructures,
   GarageType + GarageYN/AttachedGarageYN, ParkingFeatures, ParkingSpaces +
   CoveredSpaces breakdown.
5. **Condo & Building** — `appliesTo`: condo-class PropertySubType (Condo Apartment,
   Condo Townhouse, Co-op, Co-Ownership, Common Element Condo — match on
   substring "Condo" plus explicit co-op variants). AssociationAmenities,
   BalconyType, Exposure, Locker (+level/number/unit combined), PetsAllowed,
   AssociationFeeIncludes, CondoCorpNumber, AssociationName,
   PropertyManagementCompany, LegalStories ("Level").
6. **Utilities & Systems** — WaterSource/Water, Sewer, ElectricYNA, CableYNA,
   GasYNA, AlternativePower, Amps/Volts, RuralUtilities, SecurityFeatures.
7. **Taxes & Assessment** — TaxAnnualAmount (+ TaxYear), TaxAssessedValue (+
   AssessmentYear), RollNumber, TaxLegalDescription, TaxType, AdditionalMonthlyFee
   (+ frequency).
8. **Transaction & Possession** — PossessionType, PossessionDetails, OccupantType,
   HSTApplication, ChattelsYN, VirtualTourURLUnbranded / ...Branded (rendered as
   external-link pills, `rel="noopener noreferrer"`).
9. **⚠ Risk & Disclosures** — UFFI (flag when not "No"/empty), Disclosures
   (easements/restrictions), LocalImprovements + LocalImprovementsComments,
   SpecialDesignation, SeasonalDwelling. Amber-accented group; renders only when
   ≥1 row is populated. Highest-differentiation group on the sheet.

Fields present only in the VOW schema (e.g. FireplacesTotal, GasYNA, Water) simply
self-omit on IDX-fed active listings and appear on sold pages where the payload
carries them — no branching needed.

### 3. Rendering — `src/components/property/PropertyDataSheet.tsx` (new)

- **Server component, zero client JS.** Collapsibles are native
  `<details open>` / `<summary>`.
- One `<Section title="Property Data Sheet">` (existing `Section` wrapper, existing
  icon language) containing the group list.
- Group header row: title + populated-row count (e.g. "Interior · 7"), chevron via
  CSS `details[open]` marker styling.
- Rows: 2-col definition grid `grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2`;
  label `text-xs text-slate-500`, value `font-mono text-sm text-slate-200` —
  identical palette to the sections it replaces.
- Risk group: `border-amber-500/30`, `text-amber-400` accents, AlertTriangle icon.
- Link rows (virtual tour): pill-style anchor, ExternalLink icon.
- Default open state (server-rendered, so identical across viewports): Vitals,
  Building & Construction, and Risk & Disclosures (when present) render with
  `open`; remaining groups closed. Users expand freely; no state persistence.
- Placement in `page.tsx`: where Structural Vitals currently sits (directly below
  spec cells), replacing Structural Vitals + Property Summary.

### 4. Future seam (not built now)

`buildDatasheet(p, order?)` accepts an optional group order. Phase 2 (persona lens)
or per-user reordering passes a stored preference here. No preference storage,
UI, or schema ships in this phase. Per-user *hiding* additionally requires BoR
sign-off per §6.3(f) before design.

## Error handling

- Garbage payloads (nulls, wrong types, `"Semi-Detached "`-style trailing spaces,
  empty arrays) must never throw: every formatter wraps reads defensively and
  returns `null` on anything unrenderable.
- Non-string array members coerced via `String()` only when primitive; objects → omit.
- The component renders nothing (no empty Section shell) if every group is empty.

## Testing (vitest, node-env, pure logic — no render tests)

`src/lib/property/__tests__/datasheet.test.ts`:

1. Full realistic payload (derived from `.claude/docs/api/vow-response-example.json`
   + IDX fields) → expected groups/rows snapshot-ish assertions.
2. Null-safety sweep: `{}` payload → empty result, no throw; payload with empty
   arrays/empty strings → rows omitted.
3. Condo `appliesTo`: Detached payload → no Condo group; "Condo Apartment" → group
   present.
4. Risk flags: UFFI "Yes" → flagged row; UFFI "No"/absent → row logic per spec.
5. Policy exclusions: ShowingRequirements / sold-outcome keys never appear in any
   row regardless of payload content.
6. Verbatim guarantee: a value with odd casing/spacing passes through unchanged
   (modulo join/units formatting).
7. `order` param reorders groups without dropping any.

## Out of scope (recorded for later phases)

- Persona lens reorder/highlight (Phase 2).
- Per-user pin/reorder UI + `profiles` storage (Phase 2/3); per-user hide (BoR gate).
- Assessment-vs-list derived gap metric (deferred — data sheet shows raw values).
- Compare-view / Terminal propagation of the sheet.
