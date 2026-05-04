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
