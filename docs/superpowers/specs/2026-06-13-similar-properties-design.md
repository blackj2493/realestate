# Similar Properties (For Sale + Recently Sold) — Listing Page

**Date:** 2026-06-13
**Status:** Design approved, pending spec review
**Surface:** Individual listing page (`src/app/(app)/properties/[id]/page.tsx`)

## 1. Objective

Add a HouseSigma-style "comparable properties" band to the bottom of the listing
page showing two scoped, ranked lists for the subject's area:

1. **For Sale** — currently-active listings the buyer could buy instead.
2. **Recently Sold** — what comparable homes actually sold for (VOW-gated).

Our edge over HouseSigma: every card carries a transparent **"why it matched"**
label and each list carries a **match-quality badge** — appraiser-grade relevance,
visibly justified, instead of an undifferentiated "nearby" dump.

## 2. Core principle — the two lists relax in opposite orders

The lists answer different questions, so they prioritise differently:

- **For Sale = a buyer's question** ("what else could I buy?"). Buyers are sticky on
  **location** and **home form**, and flex on **price** and **exact bed count**.
- **Sold = an appraiser's question** ("what is this worth?"). Appraisers keep
  **physical similarity** (type/size/beds) tight and relax **time** then **distance**
  first — and never treat price as a filter, because revealing it is the point.

### Hard floors (never relaxed, enforced as query filters)

- Exclude the subject listing itself.
- For Sale stays For Sale; Sold stays Sold (separate collections/queries).
- Never cross Residential ↔ Commercial.
- **Never auto-cross the form-family wall** (ground-related ↔ apartment ↔ land).
  When the same-family pool is thin, **stop honestly** — show what exists plus a
  "limited comparable activity" note, never pad with off-family product.
- Geographic fallback ends at the **whole City** (no radius/adjacency in v1).

## 3. Form families

Map each `PropertySubType` to a family by reusing `PROPERTY_TYPE_OPTIONS`
(`src/lib/dashboard/propertyTypes.ts`) — the exact, trailing-space-aware TRREB
spellings. Do NOT invent a new taxonomy.

| Family | Option keys | Notes |
| :-- | :-- | :-- |
| `ground` | detached, semi, town, link, multiplex | ground-related homes |
| `apartment` | condo | condo/co-op/common-element apartments |
| `land` | vacant | matched only within itself |
| `other` | (unmapped sub-types) | match only same raw sub-type |

`formFamily(subType)` returns one of the above. The family is a **query filter**
(OR of that family's sub-type variants), so a different-family doc is never even
scored.

## 4. Architecture — wide net + similarity score (one round-trip)

The "relaxation ladder" is the *explanation*; the *mechanism* is one wide query per
list plus a JS similarity score. This degrades gracefully (always returns the best
available, never empty unless the pool is genuinely empty) and self-labels.

### Data path

- **Lazy client island**, below the fold — does NOT block above-the-fold render.
  `getListingDetail` work is untouched.
- **One endpoint:** `GET /api/properties/[id]/similar`.
  - `id` (path) is used only to **exclude the subject** from results + logging.
  - Subject match attributes arrive as **query params** (the subject's own public
    fields, already rendered on the page) — status-agnostic, since a sold/delisted
    subject may be purged from the active `properties` collection.
  - Runs two wide-net Typesense searches: `properties` (For Sale) +
    `sold_listings` (Sold), scores both, applies the VOW gate to the Sold half,
    returns both lists + metadata in one response.

### Collections / fields (verified against schema)

- **For Sale:** `properties` collection (via `searchListings` patterns). Filter on
  `TransactionType:=\`For Sale\``, `City`, `CityRegion`, `PropertySubType`,
  `BedroomsTotal`, `BathroomsTotalInteger`, `ListPrice`. Read `BuildingAreaTotal`
  (stored cargo) + `ListOfficeName` + `primaryImageUrl`/`RawImages` per-doc for
  display/scoring.
- **Sold:** `sold_listings` collection + `SOLD_LISTINGS_COLLECTION`. Reuse the
  patterns in `src/app/api/market/activity/sold/` — `DealType:=sold`,
  `ClosePrice:>=1`, `PurchaseContractDate` window, `City`/`CityRegion`,
  `PropertySubType`, beds/baths. Reuse `mapSoldDoc` for the row shape.

### Query floors (the widest net we cast)

- For Sale: `TransactionType:=\`For Sale\`` && `City:=\`<city>\`` &&
  `(<family sub-type OR-clause>)` && `id:!=<subjectId>`. Fetch ~60–80 candidates.
- Sold: `DealType:=sold` && `ClosePrice:>=1` && `City:=\`<city>\`` &&
  `(<family sub-type OR-clause>)` && `PurchaseContractDate` within 180d (the
  collection's full retention). Fetch ~60–80 candidates.

`CityRegion` is **not** a query filter — it is the strongest *scoring* signal, so
"neighbourhood first, city fallback" falls out of ranking, in one query.

## 5. Scoring (pure, deterministic, unit-tested)

`score = Σ (weight × signal)`, signals in `[0,1]`. Weights differ per list.

| Signal | For Sale weight | Sold weight |
| :-- | --: | --: |
| `regionMatch` (same CityRegion=1 / same City only=0.4) | 30 | 20 |
| `subtypeMatch` (exact sub-type=1 / same family=0.5) | 20 | 20 |
| `bedScore` (asymmetric, below) | 20 | 15 |
| `priceScore` (closeness to subject list price) | 20 | **0** |
| `sizeScore` (BuildingAreaTotal closeness; missing→0.5 neutral) | 10 | 20 |
| `recencyScore` (sold: days since contract) | — | 25 |

- **`bedScore` (asymmetric — bigger preferred over smaller):**
  Δ = candBeds − subjectBeds → `0:1.0`, `+1:0.85`, `+2:0.6`, `−1:0.6`, `−2:0.3`,
  `|Δ|≥3:0.1`.
- **`priceScore`** (For Sale): `1 − min(1, (|Δ|/subjectPrice) / 0.5)` (→0 at ±50%).
- **`sizeScore`:** both areas > 0 → `1 − min(1, (|Δ|/subjectArea) / 0.5)`; else `0.5`
  (never penalise missing/bucketed size — feed has ~0% exact sqft).
- **`recencyScore`** (Sold): `≤30d:1`, `≤90d:0.8`, `≤180d:0.5`, else `0.3`.

Weights are starting values; **tests assert ordering invariants** (e.g. same-region
beats same-city; +1 bed beats −1 bed; missing size never zeroes a candidate), not
exact numbers — so tuning later doesn't churn tests.

Rank descending, take **top 8** per list.

## 6. Match quality, "why" labels, honest-stop

Per-list **match quality** tier (drives the header badge + honest-stop):

- `close` — ≥4 results and the top results are same-CityRegion + exact sub-type.
- `partial` — results exist but mostly city-level or same-family-different-subtype.
- `sparse` — `1–3` results → render them + note "Limited comparable activity in
  {neighbourhood}".
- `none` — `0` results → empty state + "Search {city}" CTA. No padding.

Per-card **"why" label**, derived from the winning signals:

- region: `Same neighbourhood` (regionMatch=1) else `Nearby in {City}`.
- form: `{beds}bd {subtypeLabel}` (label via `PROPERTY_TYPE_OPTIONS`).
- sold appends `· sold {n}d ago`.
- e.g. `Same neighbourhood · 3bd detached` / `Nearby in Brampton · 4bd detached · sold 22d ago`.

## 7. Compliance

- **For Sale = IDX, ungated.** Brokerage (`ListOfficeName`) shown on every card in
  the same font/size, no visual separation (TRREB §6.3(c)) — `PropertyCard` already
  complies. Display cap is moot at 8 (well under 100).
- **Sold = VOW, gated.** Anonymous users get the **count** badge but **zero rows** —
  the endpoint discards sold rows server-side for non-consumers, exactly like
  `/api/market/activity/sold` (`getConsumer()` gate). Signed-out Sold cards render a
  blurred locked teaser + sign-in CTA, consistent with the rest of the page.
- **Deterministic only** — no IDX/VOW payload passes through any LLM (§4).

## 8. Components

- `src/components/Property/SimilarProperties.tsx` — **client island**. Fetches on
  mount, renders skeletons, then two stacked rows. Props: subject id + match attrs.
- Two `SimilarRow`s (sale | sold): header (title + match badge + "See all in {area}"
  deep link), horizontally-scrolling card track (up to 8), skeleton/sparse/empty
  states.
- **For Sale cards:** reuse `PropertyCard` (`compact` variant).
- **Sold cards:** new small `SoldCompCard` (close price, sold date, % of ask). Renders
  the locked teaser when `soldLocked`.
- **Page wiring:** mount `<SimilarProperties …/>` after the Property History
  `<section>` in `page.tsx`, passing `id`, `p.CityRegion`, `p.City`,
  `p.PropertySubType`, `p.BedroomsTotal`, `p.BathroomsTotalInteger`, `price`,
  `p.BuildingAreaTotal`.

## 9. Pure module + API contract

`src/lib/property/similarListings.ts` (pure, node-env testable):
`formFamily()`, `familySubtypeVariants()`, `scoreForSale()`, `scoreSold()`,
`rankSimilar()`, `classifyMatchQuality()`, `buildWhyLabel()`,
`buildForSaleSimilarFilter()`.

```
GET /api/properties/[id]/similar
  ?cityRegion=&city=&subType=&beds=&baths=&listPrice=&area=
->
{
  forSale:  SimilarCard[],       // up to 8
  sold:     SimilarSoldCard[],   // up to 8; [] when anon
  soldLocked: boolean,           // true when signed-out
  soldCount: number,             // total sold in pool (teaser)
  matchQuality: { forSale: Tier, sold: Tier },  // close|partial|sparse|none
  area: { cityRegion: string|null, city: string|null }
}
```

## 10. Testing

- **Unit (vitest, node-env):** `similarListings.test.ts` — family mapping
  (trailing-space sub-types), family-wall never crossed, asymmetric beds ordering,
  missing-size neutrality, region>city ordering, match-quality tiers, "why" labels,
  filter-string shape.
- **UI:** typecheck + lint + build + manual (repo vitest is node-env, no jsdom).

## 11. Phases

1. Pure scorer module + tests.
2. API endpoint (both collections + VOW gate), endpoint test for the gate shape.
3. Components + page wiring (skeleton / sparse / locked / empty states).
4. Verify (typecheck/lint/build) + manual smoke on a dense (Brampton) and a thin area.

## 12. Non-goals / future

- Radius / adjacent-neighbourhood matching (needs PostGIS or an adjacency table).
- Tabbed UI (we ship stacked rows).
- Commercial comps; cross-family "last resort" padding.
- Saved/exported comp sets.
- Region-precise "See all" deep-link if the terminal doesn't yet parse a
  region param (falls back to city-level link).
```
