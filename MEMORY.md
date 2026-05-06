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