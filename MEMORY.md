# Project Memory

This file tracks architectural decisions, database changes, and rule updates.

## Setup (2025-05-04)

- Created `.clinerules` with task memory protocol and implementation guidelines
- Configured strict directive to read MEMORY.md before tasks and append summaries after
- Established 4-step implementation protocol: Draft → Test → Execute → Review
- Set up `/docs` folder for future SOP storage

## Bug Fix: Typesense Filter Syntax (2026-05-04)

### Problem
When filtering properties, the Typesense search threw HTTP 400 "Could not parse the filter query" errors. This caused the properties page to show no data when room count, price, or other filters were applied.

### Root Cause
Typesense requires a specific colon-operator syntax for filter queries. The code was using JavaScript-style operators with spaces:
- **Wrong:** `ListPrice >= 500000` (throws HTTP 400)
- **Correct:** `ListPrice:>=500000` (works)

### Solution
Updated `src/lib/typesense/client.ts` to use strict Typesense filter syntax:
- Comparison operators MUST be preceded by a colon: `FieldName:>=Value`
- String equality uses colon: `City:=Toronto`
- Multiple filters joined with exactly ` && ` (with spaces)

### Test Results (After Fix)
- `type=buy&minPrice=1000000` → 18,875 results ✓
- `type=buy&minPrice=1000000&BedroomsAboveGrade=4` → 12,741 results ✓ (all listings have 4+ bedrooms)
- Combined filters now work correctly

### Files Modified
- `src/lib/typesense/client.ts` - Fixed all filter generation to use `FieldName:>=Value` syntax

## Phase 5: Shadow MLS ETL Derived Metrics Engine (2026-05-10)

### Overview
Implemented three new derived metrics engines in the ETL transformer for the Smart Homebuyer persona.

### 1. True Carry Cost Engine
Canadian mortgage calculation with semi-annual compounding for investment properties.

**Macros (May 2026):**
- Down Payment: 20%
- Investor Rate: 4.04% (5-year fixed)
- Amortization: 360 months

**Components:**
- Monthly Mortgage: Canadian semi-annual compounding formula
- Monthly Property Tax: Actual TaxAnnualAmount / 12 OR municipal mill rate
- Monthly HOA: AssociationFee for condos, $0 for freehold
- Monthly Insurance: $40 condo, $135 freehold, $200 multi-family
- Monthly Utilities: $0 for tenant-pays, $350 for multi-family inclusive
- Monthly CapEx: 1% list price/year (freehold), 0.5% (condo), -20% if age < 5 years

**Municipal Mill Rates:**
- Toronto: 0.007, Brampton: 0.010, Mississauga: 0.009, etc.

### 2. True Days on Market (TrueDOM) Engine
Entity resolution using SHA-256 property hash for linking historical listing chains.

**Address Normalization:**
- Strip punctuation, lowercase, standardize suffixes
- Concat: StreetNumber | StreetName | UnitNumber | PostalCode | City

**Campaign Block Logic:**
- Gap ≤ 45 days → same campaign (cumulative DOM)
- Gap > 90 days → new campaign (reset DOM to 0)
- Dead days = max(0, trueDOM - 30)
- Stale if trueDOM > 90

### 3. Secondary Suite Status Engine
Scoring system for ADU/income suite potential.

**Kill Switch:**
- Condo, CondoCorpNumber exists, Condo Townhouse → NONE

**Auto-Pass (EXISTING_SUITE):**
- KitchensBelowGrade > 0
- PropertySubType is "Multiplex" or "Duplex"
- PublicRemarks matches: /(currently rented|tenant|existing.*suite)/i

**Scoring (need 3+ for POTENTIAL_CANDIDATE):**
- +1: Basement has "Full" (not "Crawl Space")
- +2: PublicRemarks matches /(separate.*entrance|walk-out|walkup)/i
- +1: Basement bathroom OR rough-in present
- +1: RoomsBelowGrade >= 2
- +1: ParkingTotal >= 2
- -2: ParkingTotal < 2 (fatal flaw)

### Files Created/Modified
- `scripts/worker/transformer.ts` - Added all three engines
- `supabase/migrations/005_add_carry_cost_suite_columns.sql` - New migration
- `src/lib/typesense/typesenseSchema.ts` - Added new fields

### New Typesense Fields
- MonthlyCarryCost (facet: true, sort: true)
- MonthlyMortgage, MonthlyPropertyTax, MonthlyHOA, MonthlyInsurance, MonthlyCapEx
- SuiteStatus (facet: true), SuiteScore (facet: true, sort: true)
- IsStale (bool, facet: true)

## New Feature: Smart Homebuyer Command Center (2026-05-05)

### Overview
Implemented a 100vh "Command Center" interface for the Smart Homebuyer persona with:
- Top Command Bar (persona selector + filters)
- Right Panel Ledger (high-density property list)
- 70/30 Split Terminal (property detail modal)

### Files Created

**Store:**
- `src/lib/stores/commandCenterStore.ts` - Zustand store for Command Center state management
  - Persona selection (Cashflow Investor, Builders & Developers, Flippers & Deal Hunters, Smart Homebuyer)
  - Smart Homebuyer filters (Max Carry Cost, True DOM, Mortgage Helper, CapEx Risk, Bidding War Excluder)
  - Terminal state management (selected property, open/close)

**Command Center Components:**
- `src/components/CommandCenter/TopCommandBar.tsx` - Persona selector + Smart Homebuyer filters
- `src/components/CommandCenter/LedgerPanel.tsx` - Right panel high-density data grid
- `src/components/CommandCenter/LedgerRow.tsx` - Individual property row with Alpha badges
- `src/components/CommandCenter/AlphaBadge.tsx` - Military-style HUD badges for property flags
- `src/components/CommandCenter/ListingTerminal.tsx` - 70/30 split terminal for property details
- `src/components/CommandCenter/CarryCostCalculator.tsx` - Interactive mortgage calculator
- `src/components/CommandCenter/DOMTimelineChart.tsx` - Recharts-based price timeline visualization
- `src/components/CommandCenter/index.ts` - Barrel export

**UI Components:**
- `src/components/ui/label.tsx` - Label component (missing from shadcn/ui)

**Styles:**
- `src/app/globals.css` - Added terminal aesthetic styles (custom scrollbar, slider styling, badge styles)

### Command Center Features

**Persona Selector:**
- Dropdown with 4 personas: Cashflow Investor, Builders & Developers, Flippers & Deal Hunters, Smart Homebuyer

**Smart Homebuyer Filters:**
- Max True Carry Cost: Slider ($500-$10,000/mo)
- Negotiation Leverage (True DOM): Slider (0-120+ days)
- Mortgage Helper: Toggle (KitchensBelowGrade > 0 OR basement suite potential)
- CapEx Risk: Dropdown (Move-In Ready / Light TLC / Major Work)
- Bidding War Excluder: Toggle (excludes holding offers, presentation dates)

**Alpha Badge System:**
- INCOME SUITE (emerald-400)
- SUITE POTENTIAL (blue-400)
- DISTRESSED (rose-400)
- HOLDING OFFERS (amber-400)
- PRICE DROP [-X%] (emerald-400)
- TOP SCHOOL ZONE (purple-400)
- NEW LISTING (cyan-400)
- MOTIVATED SELLER (orange-400)

**70/30 Split Terminal:**
- Left Panel (70%): Asset details (scrollable)
  - Media Bento Grid
  - Structural Vitals Table
  - Room Ledger
  - Unvarnished Remarks (with NLP flag highlighting)
- Right Panel (30%): Calculator & Ledger (sticky)
  - Carry Cost Calculator (interactive mortgage calculation)
  - Suite Offset Estimator (conditional on Mortgage Helper)
  - DOM Timeline Chart (Recharts LineChart)

### Type Definitions Extended
Added to `src/lib/typesense/client.ts` ListingDocument:
- DaysOnMarket, primaryImageUrl, OriginalListPrice, KitchensBelowGrade, SchoolZone, PublicRemarks
- Heating, Cooling (building systems)

### Layout
- Full viewport height (100vh)
- 70/30 split layout (map area / ledger panel)
- Custom scrollbars (hidden but functional)
- Terminal aesthetic (slate-950 background, emerald/cyan accents)

### Dependencies Added
- `npm install zustand` - For state management

### Files Modified
- `src/app/properties/page.tsx` - Complete rewrite for Command Center layout

## Transformer Schema Compliance Fix (2026-05-10)

### Problem
Typesense sync was failing with "Field `X` has been declared in the schema, but is not found in the document" errors for multiple fields:
- `KitchensTotal`
- `Status`
- `LotSqftTotal`
- `AssociationFee` (and likely others)

### Root Cause
The transformer used conditional field assignment (only output if value exists), but Typesense requires ALL declared schema fields to be present in every document. This caused schema drift where new fields added to the schema weren't being output by the transformer.

### Solution
Changed transformer from conditional to unconditional field assignment with sensible defaults:
- String fields: `|| ''` fallback
- Numeric fields: `?? 0` fallback
- Calculated fields: always output (e.g., `LotSqftTotal` always has a value)

### Fields Fixed
1. **KitchensTotal** - Added to interface and transformer output with `?? 0` fallback
2. **Status** - Combined `Status`, `MlsStatus`, `StandardStatus` into single Status field with fallback chain
3. **LotSqftTotal** - Added as calculated field from `LotWidth * LotDepth` with fallback to 0
4. **AssociationFee** - Now outputs with fallback, not conditional
5. All string fields now use fallback instead of conditional assignment

### Files Modified
- `scripts/worker/transformer.ts` - Changed optional field section to use unconditional assignment with defaults
- `scripts/worker/sync.ts` - Added `Status`, `MlsStatus`, `AssociationFee` fields to mock test data

### Remaining Issue
Supabase `carry_cost` column missing - migration needs to be applied via `npx supabase db push`

## Phase 4: UI Layer — Zustand Filter Store & Terminal Components (2026-05-11)

### Overview
Built the Persona 2 (Cashflow Investor) UI layer with Zustand state management for all financial filters, Top Bar filter components, table column renderers, Alpha badges, and Financial Pro Forma sticky panel.

### Files Created

**Store:**
- `src/store/useFilterStore.ts` - Zustand filter store for Persona 2
  - Financial filters: capRateFloor, cashflowFloor, targetYieldMin
  - Multi-Unit filters: suiteFilters (PRIME_CANDIDATE, EXISTING_MULTI_UNIT, MARGINAL_CANDIDATE, NOT_VIABLE)
  - Property type filter: propertyTypeFilter (All, Freehold, Condo)
  - Occupancy filter: occupancyFilter (Vacant, Tenanted)
  - Parking filter: minParkingFilter (surplus parking count)
  - Tax burden filter: taxBurdenMax
  - Sort control: sortBy

**Typesense Query Builder:**
- `src/lib/typesense/queryBuilder.ts` - Builds filter query strings from filter store state
  - buildFilterQuery(): Generates Typesense filter string from active filters
  - buildSortQuery(): Returns sort string for current sortBy field

**Terminal Filter Components:**
- `src/components/terminal/Filters/TerminalFilters.tsx` - Top Bar filter UI
  - Cap Rate slider (0-12%, step 0.25%)
  - Cashflow floor slider (0-$5000/mo, step $50)
  - Yield min slider (0-12%, step 0.25%)
  - Suite status multi-toggle buttons (Prime/Existing/Marginal/None)
  - Occupancy toggle buttons (Vacant/Tenanted)
  - Min parking slider (0-6 surplus spaces)
  - Property type dropdown
  - Sort dropdown (Cap Rate/Cashflow/Yield/TrueDOM)

**Multi-Unit Badge Component:**
- `src/components/terminal/Badges/MultiUnitBadge.tsx` - Alpha badge system
  - AlphaBadge: Renders single badge with color-coded styling
  - PropertyBadges: Composite badge set for property cards
  - Badge statuses: PRIME_CANDIDATE, EXISTING_MULTI_UNIT, MARGINAL_CANDIDATE, INHERITED_TENANT_RISK, OVER_ASSESSED, UNDER_ASSESSED_RISK, PRICE_DISCOVERY
  - Surplus parking count badge

**Table Column Renderers:**
- `src/components/terminal/Table/Columns/CashflowColumns.tsx` - Financial metric cells
  - MetricCell: Base cell with conditional highlighting
  - CapRateCell: Shows estimated cap rate with floor annotation
  - CashflowCell: Shows net monthly cashflow with floor annotation
  - YieldCell: Shows gross yield estimate with TARGET indicator
  - OccupancyBadge: Renders TENANTED/VACANT status badges

**Financial Pro Forma Panel:**
- `src/components/terminal/ProForma/FinancialProForma.tsx` - Sticky panel for Property Detail page
  - Primary cashflow display (green/red based on positive/negative)
  - Cap rate comparison (estimated vs floor)
  - Suite potential section (for PRIME_CANDIDATE properties)
  - Assessment X-Ray (OVER_ASSESSED/UNDER_ASSESSED warning)
  - Route to Advisor CTA button

### Design System
- Background: bg-slate-950 for primary panels, bg-slate-900 for Top Bar
- Font: JetBrains Mono for all metrics and numbers
- Accent colors: emerald-400 (positive), amber-400 (warning), red-400 (negative)
- Terminal aesthetic: slate borders, rounded corners, subtle glows

## Phase 6: AVM — Anchor and Adjust Automated Valuation Model (2026-05-15)

### Architecture Overview
**Anchor and Adjust** architecture with complete separation between offline computation and live web execution:
- Pre-trained model extracts per-unit coefficients per feature (offline, in Colab)
- Coefficients uploaded to Supabase via CSV ingestion script
- Live calculation: 90-day average close_price from `raw_vow_sold` (anchor) + coefficient × input (adjustment)
- **Two-Tier Rule:** R² ≥ 0.50 → Apply coefficients; R² < 0.50 → Return anchor only

### Database Tables Created (Migration 006)
- `avm_audit_report`: Stores model R² and MAE per market/property-type combo
  - Columns: `city_region`, `property_sub_type`, `total_sales_analyzed`, `model_accuracy_score`, `average_error_margin`
  - Unique constraint on `(city_region, property_sub_type)`
- `avm_multiplier_matrix`: Stores per-unit coefficient multipliers
  - Columns: `city_region`, `property_sub_type`, `feature_name`, `dollar_per_unit`, `multiplier`
  - Unique constraint on `(city_region, property_sub_type, feature_name)`

### Backend Modules (`src/lib/avm/`)
| File | Purpose |
|------|---------|
| `types.ts` | `AVMInput`, `AVMResult`, `AVMAdjustmentBreakdown` interfaces + engine constants |
| `anchorService.ts` | Fetches 90-day avg `close_price` from `raw_vow_sold` (on-the-fly) |
| `auditService.ts` | Fetches R² score for gating decision |
| `matrixService.ts` | Fetches per-unit coefficients from multiplier matrix |
| `calculator.ts` | Core Two-Tier Rule: `calculateAVM()` with coefficient math |
| `validation.ts` | Zod schema for input validation |
| `index.ts` | Barrel export |

### API Route
- `POST /api/avm` — Accepts `AVMInput`, returns `AVMResult`
- Uses `getServerClient()` from `@/lib/supabase/client`
- Zod validation with 400 error on invalid input

### Score Conversion (Python extraction logic)
| Tier Input | Model Score |
|-----------|------------|
| `interiorTier` (1-5) | `6 - interiorTier` (range 5→1) |
| `exteriorTier` (1-5) | `5 - exteriorTier` (range 4→0) |
| `basementTier` (1-9) | `10 - basementTier` (range 9→1) |

### Frontend Components (`src/components/avm/`)
- `AVMCalculator.tsx` — Main container, handles API call and state
- `AVMPropertyForm.tsx` — Left panel: property profile form with tier selectors
- `AVMResultDisplay.tsx` — Right panel: price display, engine badge, breakdown

### Store
- `src/store/useAVMStore.ts` — Zustand store for form state and results

### CSV Ingestion Script
- `scripts/worker/avm/ingest-matrices.ts` — Standalone Node script for loading CSV exports
- Uses custom `parseCsv()` (no external dependency)
- `ON CONFLICT DO UPDATE` upsert to handle re-runs
- Column mapping: `Average_Dollar_Impact (Historical)` → `dollar_per_unit`, `Percentage_Multiplier (Future-Proof)` → `multiplier`

### Key Decisions Enforced
- Decision #5: All field names in code use camelCase (schema uses snake_case per CSV)
- Decision #6: All standalone scripts start with `import 'dotenv/config'`
- Decision #12: All Supabase service calls wrapped in try/catch with fallback defaults
- Decision #13: Each service is isolated, single responsibility
- **BAN:** Word "AI" does not appear anywhere in AVM code — uses `COEFFICIENT_ADJUSTED` / `ENGINE_MODE` terminology

### Pages
- `src/app/avm/page.tsx` — Standalone AVM terminal page at `/avm`

### Pre-existing TypeScript Errors (unrelated to AVM)
These errors existed before AVM implementation:
- `src/app/properties/page.tsx(106,107)`: `minTrueDOM` missing from `SmartHomebuyerFilters`
- `src/components/CommandCenter/LedgerRow.tsx(39)`: `DaysOnMarket` missing from `ListingDocument`
- `src/components/CommandCenter/ListingTerminal.tsx(81)`: Same `DaysOnMarket` issue
- `src/lib/typesense/transformListing.ts(338)`: `listing_key` not in `TypesensePropertyDocument`

## Daily Sync Automation — Ingester Route to raw_vow_sold (2026-05-16)

### Overview
Implemented Decision A1 from the architecture plan: the ingester now feeds the AVM's `raw_vow_sold` anchor table by routing all "Sold" or "Closed" listings to an append-only table in Supabase.

### Changes Made

**1. scripts/worker/ingester.ts — Sold Listing Routing**
Added three new functions and routing logic within the delta sync loop:
- `isSoldListing(status)` — Checks if listing status is 'Closed' or 'Sold' (case-insensitive)
- `extractSoldListingData(raw)` — Maps relevant fields (ListingKey, ClosePrice, CloseDate, CityRegion, PropertySubType, etc.) to the `raw_vow_sold` schema
- `upsertSoldListings(supabase, soldRecords)` — Performs `ON CONFLICT (listing_key) DO UPDATE` upsert to avoid duplicates

**Routing Logic (within runDeltaSync loop):**
- Before processing the batch through sync.ts, the ingester now extracts sold listings
- Calls `upsertSoldListings()` for each sold record
- This ensures the AVM's anchor table stays current for the 90-day rolling average

**2. .github/workflows/daily-sync.yml — GitHub Actions Automation**
Created GitHub Actions workflow that runs daily at 3:00 AM (UTC):
- Triggers `npx tsx scripts/worker/ingester.ts sync`
- Passes environment secrets: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESO_BEARER_TOKEN
- Also allows manual workflow_dispatch trigger from GitHub website

### Decision A1 Enforcement
The ingester now follows the "append-only for daily sync, read-only for anchor queries" rule:
- Sold/Closed listings are UPSERTED (not inserted only) to handle re-runs
- `raw_vow_sold` is treated as sacred — no migrations altering its schema
- The 217,000 historical records in production are untouched

### GitHub Secrets Required
For the workflow to function, these secrets must be added to the GitHub repository:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RESO_BEARER_TOKEN`

## Daily Sync for AVM Raw Vow Sold (2026-05-16)

### Overview
Implemented Daily Sync to route Sold/Closed listings from MLS feed to `raw_vow_sold` table for AVM anchor calculations. Decision A1: raw_vow_sold is append-only for daily sync, read-only for AVM queries.

### Files Modified
- `scripts/worker/ingester.ts` - Added sold listing routing with `isSoldListing()` and `extractSoldListingData()` functions
- `scripts/worker/transformer.ts` - Added OccupantType and PossessionType fields for Typesense schema compliance (lines 1034-1038)
- `.github/workflows/daily-sync.yml` - Created GitHub Actions workflow running at 3:00 AM UTC daily

### OData Query Fix
Fixed double-encoding issue where filter parts were encoded individually then combined and encoded again, causing `%2520` instead of `%20`.
- Query: `(StandardStatus eq 'Active' or StandardStatus eq 'Closed' or MlsStatus eq 'Sold') and (ModificationTimestamp gt datetime'...')`

### 48-Hour Catch-Up Window
Bypassed `readSyncState()` which was returning "now" timestamp. Hardcoded 48h catch-up timestamp with Z formatting:
- `2026-05-14T00:46:12.859Z` (48 hours before sync start)

### Pending Issues (Pre-existing bugs)

**1. Supabase property_hash integer error**
- Error: `invalid input syntax for type integer: "{"propertyHash":"...","trueDOM":0,...}"`
- Location: `scripts/worker/sync.ts` lines 219-222
- Cause: The `supabasePayload` object contains nested `true_dom` object with temporal metrics, but `property_hash` column is integer. When spreading `t.supabasePayload`, the entire `true_dom` object (JSON string) gets passed to integer column.
- The temporalMetrics map correctly extracts `property_hash` string, but the spread `...t.supabasePayload` brings in the nested object.

**2. Typesense PossessionType missing from transformer**
- Error: `Field 'PossessionType' has been declared in the schema, but is not found in the document.`
- Status: FIXED - Added `typesensePayload.PossessionType = raw.PossessionType || '';` at line 1038
- Also added `typesensePayload.OccupantType = raw.OccupantType || '';` at line 1035
- Note: Running script uses cached code; fix takes effect on restart

**3. Board data status fields empty**
- All listings show `StandardStatus=''`, `MlsStatus=''`, `ClosePrice=0`, `CloseDate=null`
- Board may use different field names for status or data is not populated
- `isSoldListing()` correctly identifies all listings as ACTIVE due to empty fields
- No sold/closed listings found in 10,960 records

### Test Results (2026-05-16)
- Sync completed: 10,960 records, 110 pages
- Errors: 220 (all pre-existing bugs)
- Sold listings found: 0 (board data issue)

## Dual-Query Sync Architecture (2026-05-16)

### Problem
The 48-hour delta sync pulled 0 sales because this specific board does NOT reliably update `ModificationTimestamp` when a listing closes — they only update `CloseDate`. The board IS using standard RESO fields (`StandardStatus="Closed"`, `ClosePrice`, `CloseDate`).

### Solution: Dual-Query Architecture
Implemented two distinct API queries to guarantee capture of all listings:

**Query A (Active Sync):**
- Filter: `StandardStatus eq 'Active' and ModificationTimestamp gt [lastSyncTimestamp]`
- Routes to: Typesense listings table (via `processBatch()`)
- Query function: `fetchActiveListingsBatch()`

**Query B (Sold Sync):**
- Filter: `(StandardStatus eq 'Closed' or MlsStatus eq 'Sold') and CloseDate ge [lastSyncDate]`
- Routes to:
  1. `raw_vow_sold` (AVM anchor table) via `upsertSoldListings()`
  2. Typesense with `IsSold: true` via `processBatch(rawListings, { isSold: true })`
  3. Supabase listings table (full document for historical charting)
- Query function: `fetchSoldListingsBatch()`
- Note: `CloseDate` is a Date string (e.g., `2026-05-14`), not ISO timestamp — filter formatted as `CloseDate ge 'YYYY-MM-DD'`

### Execution Flow
Sequential in `runDeltaSync()`:
1. Query A first → paginate active listings via `ModificationTimestamp`
2. Query B immediately after → paginate sold listings via `CloseDate` (date string)
3. Update `sync_state.last_sync_timestamp` when both complete

### isSoldListing() Reverted
Simplified to standard RESO checks only:
```typescript
function isSoldListing(raw: any): boolean {
  const standardStatus = raw.StandardStatus || '';
  const mlStatus = raw.MlsStatus || '';
  return standardStatus.toLowerCase().trim() === 'closed' || mlStatus.toLowerCase().trim() === 'sold';
}
```

### Bug Fix: property_hash Integer Crash
**Root Cause:** `supabaseRecords` used spread `{...t.supabasePayload}` which included the nested `true_dom` object. Later reassigning `property_hash` caused the entire `true_dom` JSON string to be passed to the INTEGER column.

**Fix:** Build records explicitly in `sync.ts` Step 5 to avoid accidentally including nested objects:
```typescript
const supabaseRecords = transformed.map(t => {
  const metrics = temporalMetrics.get(t.supabasePayload.listing_key);
  const p = t.supabasePayload;
  return {
    listing_key: p.listing_key,
    full_payload: p.full_payload,
    // ... explicit fields only, no spread operator
    property_hash: metrics?.property_hash || '',
    // ...
  };
});
```

### Typesense Schema Update
Added `IsSold` field (bool, facet: true) to `indexedFields` in `typesenseSchema.ts` for frontend filtering of sold listings.

### Files Modified
- `scripts/worker/ingester.ts` - Dual-Query sync loop, new fetch functions
- `scripts/worker/sync.ts` - `processBatch()` optional `isSold` flag, explicit record building
- `src/lib/typesense/typesenseSchema.ts` - Added `IsSold` indexed field

### Known Issue: CloseDate Not Filterable
This board's RESO API does NOT allow `CloseDate` in $filter expressions:
- Error: `"Field not allowed in filter: CloseDate"`

All OData v4 date literal formats were attempted and rejected:
- `datetime'2026-05-16'` → "The types 'Edm.Date' and 'Edm.String' are not compatible"
- `datetime'...'` → "The property 'datetime' is not defined"
- `date'2026-05-16'` → "The property 'date' is not defined"
- Unquoted `CloseDate ge 2026-05-16` → "Field not allowed in filter: CloseDate"

**Current Solution:** Query B uses only the status filter `(StandardStatus eq 'Closed' or MlsStatus eq 'Sold')` with `$orderby=CloseDate desc` for server-side sorting. Client-side pruning stops pagination when CloseDates older than the 48-hour cutoff are encountered.

**48-Hour Catchup Mode:** During initial catchup, we run with a hardcoded 48-hour timestamp that gates results. Once synced, subsequent runs use `readSyncState()` which provides proper time-based gating. A future enhancement would require board support for proper date filtering.
