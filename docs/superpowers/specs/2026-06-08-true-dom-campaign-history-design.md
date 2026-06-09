# True DOM Campaign-History Rebuild — Design Spec

- **Date:** 2026-06-08
- **Status:** Approved (brainstorming) → ready for implementation plan
- **Owner:** blackj2493
- **Branch:** dedicated `feat/true-dom-campaign-history`, cut from `main` (isolate risky work)

---

## 1. Problem & root cause

True DOM is meant to defeat the realtor cancel-and-relist tactic and show a property's real cumulative days on market. In production it does the opposite: it collapses to ~1 for relisted properties — exactly the case it exists to catch.

**Reproduced on `N13410488` / 363 Maria Antonia Rd, Vaughan** (True DOM shows 1; the property has been listed 7 times since Aug 2025). Three compounding causes, biggest first:

1. **Coverage gap (dominant).** We only retain a listing if we captured it *while Active* via the delta sync (`ingester.ts:452-454`, `StandardStatus eq 'Active'`). Of 363's 7 campaigns, only the 2 most-recent sale listings are in `listings`; the older sale + all lease campaigns are absent. We cannot stitch history we never stored.
2. **No terminal-event capture (the freeze).** Once a listing flips Terminated/Expired it leaves the Active feed, so it's never re-fetched. Priors freeze with `CancellationDate = null` and a stale `ModificationTimestamp` (we even missed N13135326's 5/27 price change and 6/6 termination).
3. **Engine end-date logic (the 0-day collapse).** With a frozen prior, `getListingEndDate()` (`TemporalDistressEngine.ts:386-402`) falls back to `ModificationTimestamp ≈ entry`, so `historicalDays = end − start ≈ 0` and the stitched prior adds nothing. Deterministically reproduced: the real `calculateTrueDOM` on the real pair returns **1, not ~24**. The unit tests pass only because their fixtures set a realistic `CancellationDate` weeks after entry.

**Scope (whole-table, 2026-06-08):** 8,687 listing rows across 4,228 physical properties already have >1 listing (a lower bound — the coverage gap hides the rest); ~44% of sampled recent relist pairs undercount; 28% (37,853 / 136,232) of `listings` rows have an empty `property_hash` column (un-stitchable). This is *not* the address-hash/`Road`-vs-`Rd` issue and *not* the unwired Phase-2 fuzzy matcher — the exact hash matched.

**Feasibility validated (live VOW probe, 2026-06-08):** all 7 campaigns are retrievable from the VOW feed by `ListingKey` *and* by address filter (`StreetNumber eq '363' and StreetName eq 'Maria Antonia'`). The terminal-date fields we lacked are populated (`TerminatedDate`, `ExpirationDate`, `OriginalListPrice`, `PriceChangeTimestamp`, `PriorMlsStatus`). **Gotcha:** off-market listings are `StandardStatus = 'Cancelled' | 'Expired'` (with `MlsStatus = Terminated | Expired`); `StandardStatus eq 'Terminated' | 'Suspended'` return **0** rows — a naive "Terminated" query fetches nothing. `TransactionType` distinguishes Sale vs Lease.

## 2. Goals / non-goals

**Goals**
- True DOM and cumulative price drop computed over each property's *full* campaign history, correct for relists.
- A HouseSigma-parity **event-history timeline** on the listing page, with the **price-change graph as the hero visual** and a detailed table as the drill-down.
- Reuse the existing VOW gating so no new compliance surface is introduced.

**Non-goals (YAGNI)**
- The 340k-row bulk off-market mirror (rejected Approach 2).
- Backfilling the 28% empty `property_hash` columns (the new read path recomputes the hash from address, so this is optional cleanup, not a blocker).
- Public / non-gated display (deferred to Broker-of-Record sign-off; design leaves a per-field flag seam).
- Reconstructing intra-campaign price ticks beyond the feed's single last-change timestamp (feed limitation).
- Format/fuzzy relist matching beyond exact address + unit (the address query suffices).

## 3. Key decisions

- **Deliverable = B2:** corrected numbers *and* the visible event-history UI, both fed by one ledger.
- **Acquisition = Approach 3 (hybrid):** reconstruct each property's history on-demand by **address query** against the VOW feed, cached in a new ledger table; refreshed nightly for active listings. No bulk mirror.
- **Audience = gated:** authenticated users see the full timeline/graph and the True DOM number; anonymous users see a blurred teaser + the surviving `campaign_count` ("Listed 7× since Jun 2025") + sign-in CTA. Reuses `gateSaleHistory` / `gateVowDerived` / `SaleHistorySection` patterns.

## 4. Architecture overview

One per-property **campaign-history ledger** is the single source of truth for both the corrected True DOM and the timeline/graph UI. We stop relying on frozen `listings` rows and reconstruct from the VOW feed by address, then cache.

```
VOW feed (by address) ──► campaignHistory.fetch ──► campaignHistory.normalize ──► CampaignEvent[]
                                                                                      │
                                              ┌───────────────────────────────────────┤
                                              ▼                                        ▼
                              property_campaign_history (Postgres)        computeTrueDomFromCampaigns()
                               (events[] + summary, keyed property_hash)    (true_dom, drop, count)
                                              │                                        │
              ┌───────────────────────────────┼────────────────────────────────────────┤
              ▼                                ▼                                         ▼
   getListingDetail (read path)     nightly sync (write path)                  Typesense TrueDom
   → timeline graph + table         → refresh actives, recompute,              (terminal/map sort)
     (gated)                           reindex                                   
```

This adds **one table + one fetch/normalize module**; everything else rewires existing paths. It also sidesteps the empty-`property_hash` problem: the hash is recomputed from the address at write time, never trusted from the stale column.

## 5. Data model — `property_campaign_history`

New migration; sits alongside the sold-only `property_sale_history` (which stays for AVM/comps — different consumer).

```sql
CREATE TABLE IF NOT EXISTS property_campaign_history (
  property_hash      VARCHAR(64) PRIMARY KEY,     -- generatePropertyHash(address)
  events             JSONB DEFAULT '[]'::jsonb,    -- newest-first; see CampaignEvent below
  true_dom           INTEGER,                       -- current continuous SALE campaign (35-day stitch)
  total_price_drop   NUMERIC,                       -- over that current stitched campaign (>=0)
  campaign_count     INTEGER DEFAULT 0,             -- # distinct campaigns ("listed N times")
  first_seen_date    DATE,
  is_stale           BOOLEAN DEFAULT FALSE,         -- true_dom > 60
  fetched_at         TIMESTAMPTZ,                   -- TTL / freshness anchor (24h)
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
```

`events[]` element (`CampaignEvent`):

```ts
interface CampaignEvent {
  listing_key: string;
  transaction_type: 'Sale' | 'Lease';
  status: 'Active' | 'Terminated' | 'Expired' | 'Suspended' | 'Sold';
  entry_date: string | null;        // OriginalEntryTimestamp
  end_date: string | null;          // resolved terminal date (see normalize)
  end_reason: 'Terminated' | 'Expired' | 'Suspended' | 'Sold' | null;
  list_price: number | null;        // current/last list price for that campaign
  original_list_price: number | null;
  close_price: number | null;       // Sold only
  brokerage: string | null;         // ListOfficeName (per-row §4 display)
  price_change_date: string | null; // PriceChangeTimestamp (one net change per campaign)
  address: string | null;           // UnparsedAddress (display)
}
```

Reads are a single PK point-lookup (IO-frugal). Summary columns power the badge/flipper signal without parsing the array; `events[]` powers the graph + table.

## 6. Fetch + normalize module — `src/lib/campaignHistory/`

`fetch.ts`, `normalize.ts`, `types.ts` — shared by the worker and `getListingDetail`, unit-testable in isolation. Deterministic only (CLAUDE.md §4 — no LLM).

**Fetch** (`fetchCampaignsByAddress(address)`), VOW token:
```
/Property?$filter=StreetNumber eq '<n>' and StreetName eq '<name>' and City eq '<city>'
         &$select=ListingKey,StandardStatus,MlsStatus,TransactionType,OriginalEntryTimestamp,
                  ListPrice,OriginalListPrice,ClosePrice,PurchaseContractDate,CloseDate,
                  TerminatedDate,ExpirationDate,SuspendedDate,UnavailableDate,
                  PriorMlsStatus,PriceChangeTimestamp,MajorChangeTimestamp,ListOfficeName,
                  StreetNumber,StreetName,City,UnitNumber,UnparsedAddress
         &$top=100&$count=true
```
- A building query returns all units, so events are then filtered to the subject's unit using the **existing, already-tested Phase-2 guards** (`unitsMatchForMerge` / `normalizeAddressComponent`): condos require exact unit; freehold with no unit passes. No new fuzzy logic.
- Best-effort: `fetchWithRetry` + timeout; follows `@odata.nextLink` (capped) for rare >100-campaign buildings.

**Normalize** (`normalizeCampaign(raw) → CampaignEvent`):
- `transaction_type`: `TransactionType` → `Sale | Lease`.
- `status`: fixed lookup over `(StandardStatus, MlsStatus)`, grounded in the probe:
  - `Cancelled` + `Terminated` → `Terminated`
  - `Expired` (either field) → `Expired`
  - `Closed` / `Sold` → `Sold`
  - `Active` → `Active`
  - `Suspended` → `Suspended`
  - (Never keyed on `StandardStatus = 'Terminated'`, which is always empty.)
- `end_date` + `end_reason`: pick the terminal date matching the status — `TerminatedDate` / `ExpirationDate` / `CloseDate|PurchaseContractDate` / `SuspendedDate` / `UnavailableDate`. (363's N13135326 → Terminated 2026-06-04 — a real end date, which is the core fix.)
- `price_change_date`: `PriceChangeTimestamp` when `ListPrice ≠ OriginalListPrice` (drives a "Price Changed" timeline event).
- Messy-data fallbacks throughout (§6): missing dates/prices degrade gracefully; a malformed campaign is skipped, never thrown.

## 7. True DOM engine v2 — `TemporalDistressEngine.ts`

New `computeTrueDomFromCampaigns(events, { now, windowDays = 35, staleThresholdDays = 60 })`. It consumes normalized `CampaignEvent[]` (real end dates) and **stops using `ModificationTimestamp` as an end-proxy** — the source of the 0-day bug. `generatePropertyHash` / `parseTimestamp` / `daysBetween` and the Phase-2 unit guards are kept (the latter now used by `fetch.ts`). The old `fetchHistoricalListings` / `fetchSoldCampaigns` / `calculateTrueDOM` stitch path in `sync.ts` is retired.

**Algorithm**
1. Keep **Sale** campaigns only (True DOM is a sale metric; lease stays in the timeline, excluded from the number).
2. Sort by `entry_date`; walk back from the newest campaign, **stitching** a prior campaign when `gap(prior.end_date → next.entry_date) ≤ windowDays`.
3. **True DOM = days from earliest-stitched-start → (now if newest is Active, else its end_date).** Measuring start→now over the continuous run (not summing per-campaign spans) is robust to overlaps and needs no end-proxy.
4. `total_price_drop` = earliest-stitched `original_list_price` − current list price, floored at 0.
5. `campaign_count` = all distinct campaigns (any type) → the "listed N times" flipper signal.
6. `is_stale = true_dom > staleThresholdDays`.

**Worked example — 363 (sale campaigns):** `N12409326` (listed 2025-09-17, Terminated 2025-10-15), `N13135326` (listed 2026-05-15, Terminated 2026-06-04), `N13410488` (listed 2026-06-06, Active). Walk back from `N13410488`: gap to `N13135326`.end = 2 days ≤ 35 → stitch; gap back to `N12409326`.end ≈ 212 days > 35 → stop. Earliest stitched start = 2026-05-15 → **True DOM ≈ 24** (vs broken `1`). The 2025 effort is a separate campaign — excluded from True DOM, shown in the timeline. Price: earliest original $1,699,900 vs current $1,729,000 → raise → drop `0`. `campaign_count = 7`.

**Edge cases:** newest campaign off-market → measure to its end; no prior in window → just the current span (fresh listing ≈ its age); lease-only history + current sale → True DOM = current sale only; relisted-before-terminated (negative gap / overlap) → start→now avoids double counting; exact 35-day boundary → inclusive (≤).

## 8. Read / write paths

**Nightly (write path), replaces the broken stitch in `sync.ts`:** after the active delta, for each active listing — fetch its address chain, normalize, upsert the ledger, recompute True DOM, and push to Typesense `TrueDom` + `full_payload.true_dom`. Satisfies the §4 24-hour freshness rule and fixes terminal/map sorting. **A fetch failure must NOT overwrite a good `true_dom` with 0** — keep the prior value and log (this is the explicit fix for the current silent-rollforward flaw).

**On-demand (read path), `getListingDetail`:** read `property_campaign_history` by hash; if missing or `fetched_at` older than the 24h TTL, do a best-effort live address-fetch + upsert (timeout-bounded; degrade to `property_sale_history`/current behavior on failure — never break the page). Returns a new `campaignHistory` field (events + `true_dom` + `campaign_count`); `priceTimeline.trueDom` now reads the corrected value.

**Subject always present:** both paths guarantee the subject listing is in the event set — it is merged from its own `full_payload` if the address fetch hasn't surfaced it yet (feed lag for a brand-new active). This prevents an empty fetch from ever producing a silent `true_dom = 0`.

## 9. UI — price graph (hero) + event table (drill-down)

**Price & Listing Timeline (hero)** — a 3rd mode on the existing `DOMTimelineChart.tsx` (Recharts `ComposedChart`):
- Sale-price trajectory stepped across *every* sale campaign: Listed → Price-Changed → Terminated/Expired marker → **visible gap** → next Listed → … → current asking.
- Event markers with distinct glyphs: Listed (emerald ●), Price Changed (amber ◆ +Δ%), Terminated/Expired (red ✕ / gray ○), Sold (gold ★, authed).
- **Off-market gaps drawn as dashed/blank segments** (not connected) so the churn is unmistakable — the Flipper distress signal.
- **Shade the current stitched window** distinctly from earlier separate efforts (visually explains True DOM = 24, not 360) via `ReferenceArea`.
- **Lease campaigns** are *not* plotted on the sale-price Y axis (≈$5k/mo vs ≈$1.7M); they render as a thin labeled marker lane/band on the time axis.

**Event table (drill-down)** — generalize `SaleHistorySection.tsx` → `CampaignHistorySection.tsx`: `Date | Event | Price | Δ% | MLS#/Address | Status | Brokerage`, newest-first, mirroring the HouseSigma layout. Brokerage per row from `ListOfficeName` (§4 mandatory-brokerage display).

**Placement:** listing page left column (70/30), where `SaleHistorySection` lives today. The True DOM badge + "Listed N times" is the headline Flipper differentiator (§2 Temporal Distress Engine, §10).

## 10. Gating (reuses shipped VOW pattern)

- New `gateCampaignHistory(history, isAuthed)` mirrors `gateSaleHistory`: authed → full `events`; anon → `campaign_count` kept (conversion hook survives) + blurred teaser + sign-in CTA.
- `gateVowDerived` extended to strip `campaignHistory.events` (it already strips `true_dom`).
- The graph receives campaign events only for authed users (gating upstream, like the current `saleMarkers`); anon sees a blurred placeholder.

## 11. Error handling / resilience

- Live address-fetch: timeout-bounded + retry; on failure serve cached ledger, else fall back to `property_sale_history`/current behavior. Never breaks the page.
- Nightly: fetch failure keeps the prior `true_dom` (never silently 0); logs.
- Normalize never throws; malformed/missing fields → §6 fallbacks; bad campaign skipped. Unit-guard prevents merging the wrong unit; pagination capped.

## 12. Testing (Vitest, node-env / pure-logic — no React render tests)

- **Engine v2 golden fixture** = the real 363 chain (committed VOW response): assert `true_dom ≈ 24`, `campaign_count = 7`, chain breaks at the ~212-day gap, the 2-day gap stitches, lease excluded, price-drop 0. Plus synthetic edges: no prior, lease-only history, off-market current, negative-gap overlap, exact 35-day boundary.
- **Normalize**: the `(StandardStatus, MlsStatus)` → status table, Sale/Lease split, Listed/Price-Changed emission, missing-field fallbacks.
- **Gating**: `gateCampaignHistory` authed vs anon (events stripped, `campaign_count` kept).
- Chart + table verified via typecheck/lint/build + manual.

## 13. Rollout — 3 commits/phases (clean separation), dedicated branch off `main`

1. **Data + logic:** migration `property_campaign_history` + `campaignHistory` fetch/normalize module + engine v2 + tests. No behavior change.
2. **Wiring:** replace the broken stitch in `sync.ts`; `getListingDetail` read path; one-time **warm pass** over active inventory (address-fetch each, populate ledger, recompute, reindex Typesense `TrueDom`) — paced for IO/feed limits; no bulk backfill.
3. **UI:** enriched price graph (hero) + campaign table (drill-down), both gated.

## 14. Compliance (CLAUDE.md §4, VOW agreement)

Deterministic only (no LLM through IDX/VOW data); VOW-gated (authed full / anon teaser); 24h freshness via nightly refresh; brokerage shown per row; stays within the VOW surface already cleared by the compliance-gate work. Public exposure remains deferred to BoR sign-off.

## 15. Risks / open items

- **Feed rate limits** for per-address fetches during the nightly warm pass — pace + cap; reuse `fetchWithRetry`.
- **Disk IO budget** — reads are PK point-lookups; the warm pass is paced (cf. the migration-010 / IO-budget incidents).
- **Price-change granularity** — only the net last change per campaign is in the feed (documented limitation; the cross-campaign trajectory is complete).
- **Empty `property_hash` (28%)** — not blocking (read path recomputes from address), tracked as optional follow-up cleanup.
