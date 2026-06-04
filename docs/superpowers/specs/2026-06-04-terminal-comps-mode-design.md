# Terminal Comps Mode (Sold + Leased) — Design

**Date:** 2026-06-04
**Status:** Design — pending user review
**Supersedes/extends:** `2026-06-03-terminal-sold-mode-and-status-badges-design.md` (Sold-mode v1, shipped PR #6)

## Goal

Evolve the shipped Sold-mode into a HouseSigma-style **combined comps view**: a
multi-select `For Sale · Sold · Leased · For Rent` control where active inventory and
closed comps render together on the map and in the list, filters apply across layers,
comps render **legibly** instead of collapsing into one map blob, sale-vs-lease is decided
by **real values** (never price), and the VOW notice appears **once** instead of under every card.

## Why (current pain points)

From live feedback on Sold-mode v1:

1. The §6.3 VOW disclaimer repeats under **every** comp card — excessive.
2. Comps collapse into a single map **"blob"** (e.g. one "67" bubble) instead of spreading.
3. No way to see **Sold + For Sale together** (or Leased + For Rent) like HouseSigma.
4. Filters are **hidden** in Sold mode (v1 deferral).
5. **Leased** comps aren't surfaced at all.

## Verified facts (drive the design)

- **No feed coordinates, but geocoding is correct (empirically verified).** Neither TRREB
  IDX nor VOW carries lat/lng; every property is geocoded by **postal code** via
  `resolveLocation → getCoordinates` (Ontario LDU exact → Canada-wide → FSA centroid). A
  live-index probe (2026-06-04) of a 100-row Mississauga sold sample found **72 distinct
  coordinates** and **95/100 matching the current geocoder exactly** — the index is **not**
  stale and the comps are precisely placed. The map **"blob" is a presentation artifact**,
  not a coordinate problem: (a) Supercluster's **64px radius** merges the denser comp layer
  into one mega-bubble at the zoomed-out auto-fit, and (b) genuine same-building stacks
  (e.g. 12 sold units at one condo postal = one true coordinate).
- **Active sale/rent already uses real values.** `fundamentals.ts` `buildTransactionClause`
  emits `TransactionType:=`For Sale`` / `` `For Lease` `` — the old $50k price proxy is gone.
- **Leased data already exists.** Closed leases arrive in the same VOW "closed" feed
  (`StandardStatus`="Closed", `MlsStatus`="Leased"), are stored in `raw_vow_sold`, and are
  **already indexed** into the `sold_listings` collection. Today they are distinguished from
  sales **only** by the route's `$50k` price floor (`ClosePrice` = monthly rent). The sold
  collection has **no deal-type field**.
- **Comp filters already exist server-side.** `/api/market/activity/sold` accepts
  `types/minBeds/minBaths/minGarage/basement/minFrontage`; the UI just never wired them.
- **Comps are VOW-gated.** `getConsumer` → anon receives count-only `{locked:true}`, 0 rows.
  The same gate covers leased — no new compliance surface.

## Design

### 1. Layer taxonomy (the control)

Replace the exclusive 3-way strip with **four independent toggle chips**:

```
[ For Sale ]  [ Sold ]  [ Leased ]  [ For Rent ]
```

|          | Active (IDX feed)              | Closed (VOW feed)        |
| -------- | ------------------------------ | ------------------------ |
| **Buy**  | For Sale — `TransactionType:=For Sale` | Sold — `DealType:=sold`   |
| **Rent** | For Rent — `TransactionType:=For Lease` | Leased — `DealType:=leased` |

- Any combination allowed; **default = For Sale only** (preserves today's default).
- Natural pairings (For Sale + Sold, For Rent + Leased) are the common combos but not enforced.
- `For Sale + For Rent` together is permitted but unusual (different price scales) — the list
  status chips disambiguate.

### 2. Data foundation (Phase 0 — prerequisite for clean comps)

**2a. Deal-type flag — replace the price heuristic with real values.**
- Add `DealType: 'sold' | 'leased'` (string, facet) to `soldListingsSchema`.
- Derive in `toSoldDocument` from **real values**: `MlsStatus` ("Leased" → leased, "Sold"/"Closed
  Sale" → sold), falling back to `TransactionType` ("For Lease" → leased, else sold). **Never price.**
- Reindex the 180-day window: incremental path (ingester Query B — raw JSON in memory, free) and
  backfill (add `mls_status:raw_payload->>MlsStatus, txn_type:raw_payload->>TransactionType` to the select).
- Route: replace the `PRICE_FLOOR` gate with `DealType:=sold` / `DealType:=leased`. Keep a small
  floor only as a sanity backstop on the sold view.

**2b. Blob fix — it's clustering, not geocoding (verified).** The live-index probe (see Verified
Facts) proved coordinates are correct and current, so the fix lives entirely in the **frontend map
presentation** — no pipeline re-geocode:
- Tune Supercluster (`CLUSTER_OPTIONS.radius` = 64 is aggressive): reduce and/or make it
  density/zoom-aware so the comp layer separates into several clusters instead of one mega-bubble.
- Don't auto-fit so far out that everything re-merges (floor the comp framing zoom a little tighter).
- Genuine same-building stacks (condos) are *correct* to coincide; the existing click→popup already
  lists them. Spiderfy is optional polish.
- This is a shared map tweak (also benefits the active layer); the plan decides shared-radius-reduction
  vs. a tighter comp-specific cluster so the active experience isn't regressed.

### 3. Combined rendering

- **Fetch (`performSearch`)** branches on the active layer set:
  - Active layers (For Sale / For Rent) → existing Typesense client, one query (OR the
    `TransactionType` clause if both are on).
  - Comp layers (Sold / Leased) → gated sold route (`DealType` filter, viewport polygon, window).
  - Up to **two parallel fetches**, each capped at **100** (compliance), merged into one
    `ListingDocument[]` tagged with its layer.
- **Map (`AlphaMap`):** active layers keep the existing **metric color ramp** (preserve the
  Color-By feature); comp layers render **fixed hues** (Sold = red, Leased = violet), dimmer/smaller
  so live inventory stays the hero. Coincident comps still cluster → popup.
- **List (`LedgerPanel`):** **interleaved**, sorted by recency; each row carries a colored status
  chip (`FOR SALE` / `SOLD` / `LEASED` / `FOR RENT`). Sold/leased rows use the comp card (close
  price, over/under-ask, closed date); leased shows `/mo` and "Leased" framing.
- **Adapter:** extend `soldToListingDocument` for leased (rent semantics; leased date label); add a
  `compKind` discriminator to `ListingDocument` so the card + chip branch correctly.

### 4. Filters across layers

- **Universal/basic filters** (price, beds, baths, type) apply to **all** active layers **and** comp
  layers (wire universal values → sold route params; price maps to `ClosePrice` range, semantics per kind).
- **Persona / investor chips** (forward yield, etc.) apply to **active layers only** — comps have no
  forward-looking metrics. They're hidden when only comp layers are on.

### 5. Disclaimer (single notice)

- Remove the per-card §6.3 line from the `ListingCardBody` comp branch.
- Show the VOW notice **once**: a one-line footer beneath the ledger whenever any comp layer is on,
  plus a small map caption. **Brokerage stays per-row** (§6.3(c) mandatory display).

### 6. Compliance (unchanged guarantees)

Sold + Leased both VOW-gated via `getConsumer` / `VowGateOverlay`; anon → count-only, 0 rows.
≤100 rows per comp query. Deterministic filtering only (§4). Brokerage on every comp row.
§6.3 notice shown once.

## Components touched

- **Store** — `commandCenterStore`: `activeLayers` set + actions (replaces `listingMode` enum;
  keep `soldWindowDays`/`soldLocked`).
- **Control** — multi-select chip variant; `FilterBar` wiring.
- **Data** — `soldListingsSchema` (+`DealType`), `soldIndexer` (derive `DealType`, backfill select),
  sold `route` (`DealType` filter + params), `soldMapper` (+`dealType`, leased date),
  `adapter` (leased), `fetchSoldComps` (sold + leased).
- **Map** — `AlphaMap` (layer coloring), `mapLogic`.
- **List/card** — `LedgerPanel` (interleave + chips), `ListingCardBody` (leased branch; remove
  per-card notice), single VOW-notice element.
- **Page** — `properties/page.tsx` `performSearch` (multi-source fetch + merge).

## Testing (Vitest is node-env — pure logic only; UI via typecheck/lint/build/manual)

- `DealType` derivation: `MlsStatus`/`TransactionType` → `'sold'|'leased'`; assert price is never consulted.
- Route/`buildSoldQuery` includes the `DealType` clause.
- Merge + sort + layer-tagging pure helper.
- Adapter leased mapping (rent, leased date, chip).
- `soldVsAsk` reused for leased delta.
- Clustering helper (radius / zoom-aware) if extracted to a pure function in `mapLogic`.

## Phasing

- **Phase 0 — data foundation:** add `DealType` flag + re-backfill the 180-day window (also
  refreshes the few rows with dropped coords). **No geocoding fix needed — verified correct.**
  Independently verifiable by querying the index.
- **Phase 1 — store + multi-select control:** no behavior change for single-layer.
- **Phase 2 — multi-source fetch + merge + combined map/list; tune clustering so the comp layer
  separates instead of blobbing.**
- **Phase 3 — leased card + filters across layers + single disclaimer.**

## Deferred / out of scope

- Multi-year window (still 180d — engineering cap + BoR sign-off).
- Region-spelling quirk (`City:=Toronto` → 0 because rows are stored "Toronto C01") — separate follow-up.
- `For Sale + For Rent` simultaneous is allowed but not optimized.
