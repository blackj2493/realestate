# Plan: Show the searched school on matched listings ("Schools near this home")

## Context
School-aware search (4 phases) shipped. A user then filtered listings by a specific school
(**Pierre Berton Public School**, Vaughan), got matching homes on the map, but when they
opened a matched home the detail panel did **not** show Pierre Berton.

Root cause (verified against data — not a matching bug): the filter and the display use
different school sets.
- **Filter** matches `NearbySchools:=<id>` — every public/catholic school within 2.5 km of
  the listing. Pierre Berton qualifies, so the home matches.
- **ListingTerminal** only renders the *nearest rated school per panel*
  (`ElemPublicSchool`, `ElemCatholicSchool`, …). Within 2.5 km of Pierre Berton there are
  4 public elementaries (Pierre Berton 0 km, **Fossil Hill 1.0 km**, Vellore Woods 1.75 km,
  Johnny Lombardi 1.95 km). For a home nearer Fossil Hill, the panel shows Fossil Hill and
  never the searched Pierre Berton — even though the home matched *because* Pierre Berton is
  nearby. Hence the disconnect.

Fix (display-only + one read endpoint): replace the misleading "nearest-per-panel" grid in
the listing detail with a complete **"Schools near this home"** list (all nearby
public/catholic schools, sorted by distance) and **pin/highlight the searched school**. The
data model, ETL, filter, sort, and map shading are correct and stay unchanged. No schema
change, no re-backfill.

## Approach
1. **New read endpoint** `src/app/api/schools/nearby/route.ts` — mirror the existing
   `src/app/api/schools/search/route.ts` (module-cached load of `data/ontario-schools.json`).
   `GET ?lat=&lng=&radius=2.5` → all public/catholic schools within radius, sorted by
   distance: `{ id, name, level, system, score, distanceKm }`. Include unrated schools
   (`score: null`) so the displayed set matches the `NearbySchools` filter exactly and the
   searched school is always present. Inline a small haversine (same formula as `assignSchools`
   in `src/lib/schools/nearestSchools.ts`); cap at ~30 results.
2. **ListingTerminal** `src/components/CommandCenter/ListingTerminal.tsx` — replace the
   per-panel `schoolRows` grid (added in Phase 4) with the fetched list:
   - On open, fetch `/api/schools/nearby` using `property.location` (`[lat, lng]`).
   - Read `school.targetSchool` from `useCommandCenterStore`. Render the searched school's row
     first with a "Searched" tag + highlight, then the nearest ~6–8 others. Each row: name,
     `Public/Catholic · Elementary/Secondary`, score badge (reuse the existing `scoreColor`
     helper), distance. Keep the EQAO / OGL-Ontario attribution line.
   - Show a "+N more within 2.5 km" note when truncated; handle loading/empty states.

The indexed per-panel score fields still drive filter/sort/shading; the now-display-unused
per-panel name/distance cargo fields stay in place (removing them would need a backfill).

## Critical files
- New: `src/app/api/schools/nearby/route.ts` (pattern: `src/app/api/schools/search/route.ts`)
- Edit: `src/components/CommandCenter/ListingTerminal.tsx` (replace the Phase-4 "Nearby Rated
  Schools" grid; add a `useCommandCenterStore` read for the active target school)

## Reused patterns
- Dataset load + module cache + JSON response shape: `src/app/api/schools/search/route.ts`.
- Haversine + 2.5 km radius (`NEARBY_RADIUS_KM`): `src/lib/schools/nearestSchools.ts`.
- `school.targetSchool` in `src/lib/stores/commandCenterStore.ts`; `scoreColor` already local
  to `ListingTerminal.tsx`.

## Verification
1. `npm run dev`; `GET /api/schools/nearby?lat=43.835&lng=-79.5775` → Pierre Berton at ~0 km
   plus Fossil Hill / Vellore Woods / Johnny Lombardi with ascending distances.
2. Browser: search "Pierre Berton", open a matched home → "Schools near this home" lists it,
   pinned with a "Searched" tag and its distance from the home; also confirm a downtown
   Toronto home shows a sensible distance-sorted list. (Manual — no browser-automation tool.)
3. `npx tsc --noEmit` and `npm run lint` clean (0 errors).
