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

## New UI: Split-View Properties Page (2026-05-04)

### Feature
Implemented a new split-view layout for the properties page with:
- **Left side (60%):** Interactive map (TerminalMap)
- **Right side (40%):** Scrollable property list with thumbnails
- **Top filter bar:** Developer persona-specific filters

### Filter Bar Components
- **Persona Switcher:** Primary | Yield | Value-Add modes
- **Price Range:** Min/Max inputs
- **Yield Slider:** For Yield Investor mode
- **Bedroom Stepper:** 0-10+ with increment buttons
- **Max DOM Input:** Days on market limit
- **Toggle Buttons:** Suite Potential, Distressed (Yield mode)
- **Lot Dimensions:** Width × Depth inputs (Value-Add mode)

### Property List Items
- Thumbnail image (w-32 h-24)
- Price in emerald monospace
- Address (line-clamped)
- Property type badge
- Days on market
- Bedroom/Bathroom/Square footage icons
- City label
- Save/heart button

### Files Modified
- `src/app/properties/page.tsx` - Complete rewrite with new layout

### Fixes (2026-05-04)
- **Scroll Issue Fixed:** Map (left side) is now fixed, only property list (right side) scrolls
- **Thumbnail Extraction:** Updated ETL transformer to properly extract optimal thumbnail from images array
  - Priority: Order === 0 or 1 with ImageSizeDescription === "Medium" > "Thumbnail" > "Large"
  - Falls back to first "Medium" image, then first available image
  - Stores in `primaryImageUrl` field for Typesense indexing
- **Scroll Layout:** Uses `height: calc(100vh - 8rem)` for proper viewport calculation with `shrink-0` on map container

### Image Fix (2026-05-04)
- **Next.js Image Config:** Verified `next.config.mjs` has `trreb-image.ampre.ca` in remotePatterns (already configured)
- **primaryImageUrl Field:** Updated ETL transformer to extract optimal thumbnail from images array (Order 0, Medium size)
- **API Route:** Now passes `primaryImageUrl` from Typesense through to frontend
- **PropertyListItem:** Uses `primaryImageUrl` with `onError` handler for fallback to placeholder
- **Debug Logging:** Added console.log to track image loading in browser console
