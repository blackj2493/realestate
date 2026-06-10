# De-listed Mode — Design Spec

**Date:** 2026-06-09
**Status:** Approved by owner (brainstorming session)
**Branch:** feat/delisted-mode

## 1. Problem & Goal

Terminated / Expired / Suspended listings vanish silently: Query A (IDX) only
fetches `StandardStatus eq 'Active'`, and nothing else captures the terminal
event. The listing-page campaign ledger already surfaces per-property
terminated history (live VOW address query), but there is no map/search
surface. HouseSigma ships a "De-listed" button next to Sold; we don't.

**Goal:** a "De-listed" layer chip on the /properties Terminal, peer to
Sold/Leased, showing recently-died listings as deal-hunting inventory
(a terminated/expired listing = a seller who wanted to sell and failed —
prime off-market outreach for the Flipper persona and licensed-agent
prospecting).

**§10 edge over HouseSigma:** their D-markers show a bare price. Ours show
*the price the market rejected* (last ask), *how long the listing survived*
(DaysOnMarket), and the specific reason (Terminated vs Expired vs Suspended),
with deeper failed-attempt context one click away in the property ledger.

## 2. Verified feed facts (probes run 2026-06-09)

- The VOW feed serves off-market listings: 383,079 Terminated / 170,158
  Expired / 5,232 Suspended (all-time, all Ontario). No orphan inference
  needed.
- `ModificationTimestamp` IS filterable on these statuses (unlike Query B's
  date fields) → a properly cursored delta sync is possible.
- `$orderby=TerminatedDate desc` works → bounded backfill is possible.
- 12-month volume (ModificationTimestamp proxy): ~216k Terminated + ~106k
  Expired + ~5k Suspended ≈ **328k records**; last 90 days ≈ 80k.
- Live Typesense (post stale-sold purge): `properties` 105,658 docs,
  `sold_listings` 43,652 docs, plus an **orphaned legacy `listings`
  collection (95,237 docs)** whose only consumer is the dead
  `src/services/metrics/ETLPipeline.js` stack.

## 3. Locked decisions (owner-approved)

1. **Depth:** 12-month slim archive in Supabase; 90-day rolling window in
   Typesense for the map. Depth is not a one-way door — the feed retains
   everything, so deeper backfill is always possible later.
2. **Cost target ≈ $0/month:** slim rows (no raw JSONB payload) keep Supabase
   under ~300MB; the 90-day index (~80k lean docs) is paid for by deleting
   the orphaned legacy `listings` collection (95k docs) — bundled cleanup.
3. **Gating mirrors Sold mode exactly** (VOW data): server strips rows for
   anonymous users (`{count, listings: [], locked: true}`), `VowGateOverlay`
   teaser, sign-in unlocks.
4. **Extend, don't duplicate:** no new Typesense collection, no new API
   route. De-listed = new `DealType` values in `sold_listings` + a `dealType`
   extension on `/api/market/activity/sold`.

## 4. Architecture

```
VOW feed ──Query C (delta, cursored)──► raw_vow_delisted (Supabase, 12mo slim archive)
                                   └──► sold_listings (Typesense, DealType ∈
                                        {terminated, expired, suspended},
                                        90-day rolling window, pruned nightly)
Terminal "De-listed" chip ──► /api/market/activity/sold?dealType=delisted
                              (auth gate inherited) ──► amber map markers + cards
```

## 5. Components

### 5.1 ETL — Query C (`scripts/worker/ingester.ts`)

- New fetch beside Query B:
  `$filter=(MlsStatus eq 'Terminated' or MlsStatus eq 'Expired' or MlsStatus eq 'Suspended') and ModificationTimestamp gt {cursor}`
  on the **VOW token**, paged `$top=100`.
- **Own cursor key** in `sync_state` (e.g. `delisted_last_sync`) so a Query C
  failure never moves the sold cursor (and vice versa). Apply the syncCursor
  lessons: never advance the cursor on a failed run.
- **No media fetches** (markers/cards use no photo in v1 — `primaryImageUrl`
  stays empty; the sold-card component already tolerates missing images).
- Routes each record to: `raw_vow_delisted` upsert (slim extract) + a
  `toDelistedDocument()` upsert into `sold_listings` **only when the de-list
  event date is within 90 days**.
- Nightly prune: extend `pruneOldSold()` (scripts/worker/soldIndexer.ts) to
  prune per DealType — 180d for sold/leased (unchanged), 90d for
  terminated/expired/suspended.

### 5.2 Backfill CLI (`scripts/worker/delistedIndexer.ts backfill`)

- Pages the feed 12 months back (~328k records ≈ 3.3k calls, one-time),
  ordered by ModificationTimestamp, client-side pruned at the 12-month
  cutoff. Batched Supabase upserts (IO-budget aware: batches + sleep).
- Indexes only records whose de-list date is within 90 days into Typesense.
- Resumable (checkpoint on cursor), dry-run by default for the Typesense
  write portion, `--apply` to execute — mirroring repo conventions.

### 5.3 Storage — migration 034: `raw_vow_delisted`

Slim columns (NO `raw_payload` JSONB — full payload remains fetchable from
the feed forever):

- `listing_key` (PK), `mls_status`, `standard_status`
- `delisted_date` (date — TerminatedDate | SuspendedDate | ExpirationDate |
  ModificationTimestamp::date fallback, by status), `expiration_date`,
  `listing_contract_date`
- `list_price`, `original_list_price`, `days_on_market`
- `unparsed_address`, `city`, `city_region`, `postal_code` (parsed from the
  full address via `parsePostal.ts` — NOT the FSA-only field; see sold-blob
  lesson), `property_sub_type`
- `bedrooms_total`, `bathrooms_total_integer`
- `lat`, `lng` (geocoded at index time, same path as soldIndexer)
- `transaction_type` (For Sale vs For Lease — a terminated lease listing is
  not a sale lead; UI filters For Sale by default)
- `created_at`, `updated_at`
- Indexes: PK + `(delisted_date)` + `(city, delisted_date)`
- Apply via Session-pooler script per repo connectivity rules.

### 5.4 Typesense schema changes (`src/lib/typesense/soldListingsSchema.ts`)

- `DealType` gains values `terminated` | `expired` | `suspended`
  (existing facet — no schema change needed for values).
- **Three added fields:** `DaysOnMarket` (int32, optional, default 0);
  `TransactionType` (string facet, optional, default '' — needed to filter
  terminated lease listings out of the sale-lead view; legacy sold docs
  simply carry the default); `OriginalListPrice` (int32, optional — the
  original ask of the failed campaign, powering the §5.6 ask-cut delta;
  `ListPrice` carries the FINAL ask for de-listed rows).
- `PurchaseContractDate` (the window/sort field) holds the **de-list event
  date** for these DealTypes — rename its doc comment to "event date the row
  is windowed on". `ClosePrice: 0` for de-listed docs.
- `toDelistedDocument()` lives in `delistedIndexer.ts`, reusing
  `toSoldDocument()` internals where sensible (geocoding, schools,
  strict-schema fallbacks `?? 0` / `|| ''`).

### 5.5 API (`src/app/api/market/activity/sold/route.ts`)

- `dealType=delisted` expands to `DealType:=[terminated, expired, suspended]`.
- The `ClosePrice:>=1` floor applies only to sold/leased.
- Adds `TransactionType` filter defaulting to For Sale for delisted (needs
  `TransactionType` on de-listed docs — carried in the document; sold docs
  unaffected).
- Response rows carry `dealType` (specific reason) + `daysOnMarket`.
- **Auth gate untouched and inherited** (`getConsumer()` → locked teaser).
- 100-row cap (§6.3(b)) inherited.

### 5.6 UI

- `LayerChips.tsx`: add `delisted` LayerKey — label "De-listed", **amber**
  (`bg-amber-500/15 text-amber-300`), peer to Sold (rose) / Leased (violet).
- `src/lib/sold/layers.ts`: `applyLayerToggle` + `queryPlan` add the comp
  kind `"delisted"`; min-one-layer + forSale↔forRent exclusion unchanged.
- `fetchSoldComps.ts`: sends `dealType=delisted` for the new kind.
- `adapter.ts`: maps to `compKind: "delisted"`, `DelistedDate`,
  `DaysOnMarket`; `ListPrice` = last ask.
- `ListingCardBody.tsx`: comp path renders status badge with the specific
  reason ("Terminated" / "Expired" / "Suspended") + de-list date, last-ask
  price, "survived N days" line (omit when DaysOnMarket is 0/unknown), and
  an ask-cut delta when `OriginalListPrice > ListPrice`.
- `AlphaMap.tsx`: `compKind === "delisted"` → amber `[245, 158, 11, 230]`.
- `SoldWindowDropdown.tsx`: when De-listed is among active layers, cap
  selectable window at 90 days (the index window); sold/leased keep 180.
- `VowGateOverlay` + `page.tsx` lock logic: extend `compOnly`/locked checks
  to include the delisted layer (mechanical).

### 5.7 Bundled cleanup (Phase 3)

- Delete the orphaned `listings` Typesense collection (95,237 docs) via a
  guarded admin script (dry-run prints collection stats + code-reference
  scan; `--apply` deletes).
- Delete the dead `src/services/metrics/` legacy stack (ETLPipeline.js,
  test-flipper.js, test-edge-cases.js) — its only references are internal.
- Verify with grep + typecheck + build before deletion; this frees more RAM
  than the de-listed index consumes.

## 6. Error handling

- Query C failures: log + do NOT advance `delisted_last_sync`; never affect
  Query A/B results or cursors.
- Typesense de-listed writes are non-fatal (warn + continue), mirroring the
  sold-batch convention.
- Strict-schema enforcement: every declared field present with aggressive
  fallbacks (`?? 0`, `|| ''`, `false`) per CLAUDE.md §6.
- Records with unparseable/missing geocode are archived in Supabase but
  skipped for Typesense (no map point), counted in logs.

## 7. Testing (vitest, node-env, pure logic only)

- De-list event-date selection (status → date-field precedence + fallback).
- `deriveDealType` extension (terminated/expired/suspended from MlsStatus).
- `toDelistedDocument` field mapping + strict-schema fallbacks.
- API filter builder: `dealType=delisted` expansion, price-floor exemption,
  TransactionType default.
- Prune-window logic per DealType (180 vs 90).
- Window clamp logic for the dropdown.
- Adapter mapping (`compKind`, dates, last-ask).

## 8. Compliance notes

- De-listed data is VOW Listing Information → authenticated-only rows,
  server-stripped for anonymous (inherits Sold mode's implementation, which
  follows the HouseSigma locked-teaser model). No new compliance surface.
- All derivations deterministic (no LLM) per §4.
- Brokerage display: de-listed cards show `ListOfficeName` same as sold
  cards (field already in the collection/doc path).

## 9. Phasing

1. **Phase 1 — Data:** migration 034, Query C + cursor, `delistedIndexer.ts`
   (toDelistedDocument + backfill CLI + prune extension), tests. Run backfill.
2. **Phase 2 — Surface:** API dealType extension, layer chip, adapter/card/
   map/window/gate UI, tests.
3. **Phase 3 — Cleanup:** legacy `listings` collection + dead metrics stack
   deletion (guarded script).
4. **Deferred:** 12-month deep window on the map served from the Supabase
   archive; neighborhood failure-rate analytics (terminated:sold ratio).

## 10. Out of scope

- Photos on de-listed cards (no media fetches in v1).
- Outreach/CRM tooling on top of de-listed leads.
- Relist-chain stitching changes (True DOM work is separate; the archive
  table will help it later).
