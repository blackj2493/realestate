# Terminal: Listing-Status Badges + Gated "Sold" Mode — Design

- **Date:** 2026-06-03
- **Status:** Approved (design) — pending spec review, then implementation plan
- **Surface:** `/properties` terminal (Command Center)
- **Branch plan:** cut fresh from `main` (do not pile onto `feat/force-appreciation-card-copy`; its in-flight `FilterBar`/`TopCommandBar`/`AppHeader` edits stay undisturbed)

---

## 1. Problem & context

The terminal shows listings that are not actually for sale. Empirically (live facet of the public `properties` Typesense collection, 93,949 docs on 2026-06-03):

| `Status` value | Count | Meaning |
| --- | --- | --- |
| New / Price Change / Extension / Active | ~91,195 | genuinely available |
| **Sold Conditional** (+ Escape) | **~2,424** | offer accepted, conditions pending |
| Leased Conditional (+ Escape) | ~223 | rental spoken-for |
| Deal Fell Through | 107 | back on market |

Two root causes:
1. **Ingest:** sync Query A fetches `StandardStatus eq 'Active'` (`scripts/worker/ingester.ts:453`). A "Sold Conditional" listing is *still* `StandardStatus=Active` (deal not firm), so it is legitimately pulled into the active collection.
2. **Query:** `searchListings()` (`src/lib/typesense/client.ts`) applies **no status filter** — the terminal renders whatever is in the collection.

Crucially, what the user sees as "sold" is **IDX "Sold Conditional"** data — there is **no VOW close price** in the `properties` collection. Firmly-closed sales (`StandardStatus=Closed`) go down a separate path (Query B → `raw_vow_sold` → the `sold_listings` collection).

The request therefore splits into **two features** with very different compliance postures:

- **Phase 1 — Status badges (free, IDX-only):** keep conditional/dead listings visible but clearly marked. No new data, no gate, no reindex.
- **Phase 2 — Gated "Sold" mode (VOW):** the real HouseSigma-style sold-comps view with a time window. Firm closed sales, legally restricted to authenticated consumers.

`Status` is already populated on every doc: `transformer.ts:980` sets `Status = raw.Status || raw.MlsStatus || raw.StandardStatus`, and the field is indexed/faceted in `typesenseSchema.ts:251`.

---

## 2. Compliance findings (read 2026-06-03)

Source: `.claude/docs/legal/vow-agreement.pdf`, `.claude/docs/legal/idx-agreement.pdf` (extracted via `pdftotext`).

- **No time-window limit exists in the agreement.** Neither agreement contains any day/month/year display cap for sold data. The only duration anywhere is a boilerplate "10 days to cure a breach" (vow line 775). **The `sold_listings` 180-day window is an engineering/RAM choice, not a legal one** (`soldListingsSchema.ts` docstring).
- **Operational rules are deferred to a document we don't have.** The agreement repeatedly subordinates itself to the **"VOW Policy and Rules"** (= "that part of the MLS® Rules and Policies", vow line 168), which "may include terms and limitations" and "will govern" on any inconsistency (vow lines 16–22). Any real duration cap, if one exists, lives there. **→ The licensed window is a Broker-of-Record / PROPTX question; do not display multi-year on assumption.**
- **What the agreement firmly requires for sold display:** a **registered Consumer** — "a consumer with whom the Member has first established a lawful broker-consumer relationship" (vow lines 88–89) — with a **bona fide interest** in a purchase/sale/lease (vow lines 121, 130–136). This maps exactly onto the existing gate (`getConsumer()` = signed-in + terms-accepted + `bona_fide_attested`).
- **No AI processing** of listing data (vow line 339; CLAUDE.md §4). All filtering deterministic.

**Decision:** display window is a single configurable cap `SOLD_DISPLAY_MAX_DAYS`, default **180**. Multi-year is a deferred phase, unblocked by a one-line cap change once (a) the licensed duration is confirmed and (b) the older-comp data path is chosen (§6).

---

## 3. Architecture: two data paths

The defining constraint:

| Mode | Collection | Key | Where it runs | Gate |
| --- | --- | --- | --- | --- |
| **Active** (`sale`/`rent`) | `properties` | public search key | **client-side** (`searchListings`) | none (IDX, public) |
| **Sold** | `sold_listings` | admin key | **server-only** route | `getConsumer()` |

Active search runs in the browser: `properties/page.tsx:180` calls `searchListings({ rawFilterBy, filters: { boundingBox: mapBounds } })`, where `rawFilterBy` is built by `buildTerminalCoreClauses` (`terminalQuery.ts`) + school/band/draw lenses. The public browser key **cannot** read `sold_listings` by design (`soldListingsSchema.ts` docstring). Therefore **Sold mode is not a filter flag on the existing query — it is a second data source** reached through a server route. This is already how the dashboard's Sold column works (`/api/market/activity/sold`).

---

## 4. Phase 1 — Listing-status badges

**Goal:** every non-plain-active listing in the active browse is visibly marked with its exact status. Visible, not hidden (per user).

**Where:** `src/components/CommandCenter/ListingCardBody.tsx` — the single shared card body used by both the list (`LedgerRow`) and the map popup (`ListingMapPopup`). One change covers both surfaces.

**Logic:**
- Add a pure helper `statusBadge(status: string | undefined): { label, tone } | null`.
  - Plain-active (`New`, `Price Change`, `Extension`, `Active`, empty) → `null` (no badge; today's For Sale/For Lease chip is enough).
  - `Sold Conditional`, `Sold Conditional Escape` → label "Sold Cond.", warning tone (amber).
  - `Leased Conditional`, `Leased Conditional Escape` → label "Leased Cond.", warning tone.
  - `Deal Fell Through` → label "Back on Market", info tone.
  - Any other non-active value → show the raw status, neutral tone (forward-compatible).
- Render the badge in the existing chip row (`ListingCardBody.tsx:60-75`), beside the `TransactionType` chip.
- `Status` must be added to the `ListingDocument` consumption — it is already in the Typesense schema and returned by `searchListings`; confirm it is carried through to the card (add to the field set the page maps if needed).

**No** query change, **no** reindex, **no** gate. Independently shippable.

**Optional (note, not in scope):** a future "hide spoken-for" toggle in Active mode. Deferred.

---

## 5. Phase 2 — Gated "Sold" mode

### 5.1 Control & state — extend the transaction strip

Introduce a single terminal mode enum `listingMode: 'sale' | 'sold' | 'rent'` (store: `commandCenterStore.ts`). The existing transaction `FundamentalToggle` (`For Sale / For Rent`) becomes the three-state strip **`For Sale · Sold · For Rent`** (`FundamentalToggle.tsx` is already generic over options).

- `sale` / `rent` → today's behavior unchanged; derive the existing `TransactionMode` for `fundamentals.ts` builders (`sold` → treat as `sale` for price-slider config, since a sold price is a sale price).
- `sold` → reveals the **time-window dropdown**, switches the data source (§5.2), and (anon) drops into the teaser (§5.3).
- `Residential / Commercial` class axis still applies in Sold mode (collection carries `PropertySubType`/`City`; commercial sold coverage is thin — acceptable, no special-case).
- Investor/persona layer stays off in Sold mode (`isInvestorLayerActive` already returns false unless `sale`+`residential`); sold cards carry their own analytics (§5.5).

### 5.2 Data path — reuse and extend `/api/market/activity/sold`

The existing route (`src/app/api/market/activity/sold/route.ts`) already provides almost everything:
- **Area = polygon** (`buildAreaClause`, `parsePolygonParam`) → pass the **map viewport's 4 corners** as the `polygon` param. (Same geo mechanism the active path uses via `boundingBox`.)
- `windowDays` (clamped to `MAX_WINDOW_DAYS`), `types`, `minBeds`, `minBaths`, `minGarage`, `basement`, `minFrontage`, `limit` (clamped to `MAX_LIST = 100`, CLAUDE.md §4).
- `getConsumer()` gate + `{ count, listings: [], locked: true }` teaser response.
- `computeSold` returns `SoldListing` (closePrice, listPrice, soldDate, beds, baths, sqft, brokerage, city, primaryImageUrl), sorted `PurchaseContractDate:desc`.

**Branch point:** in `properties/page.tsx`'s fetch effect, when `listingMode === 'sold'`, call the route with the viewport polygon + `windowDays` instead of client-side `searchListings`; feed results into the same map/list renderers.

**Three small route extensions required:**
1. **Return coordinates** for map pins. `computeSold`'s mapping currently drops `location`; add `lat`/`lng` to `SoldListing` from the doc's `location` geopoint (present when postal resolved Tier-1; pins simply omit ungeocoded solds, same as active).
2. **Configurable cap.** Lift `MAX_WINDOW_DAYS = 180` (route line 35) to a shared `SOLD_DISPLAY_MAX_DAYS` constant (single source; default 180). Both the route clamp and the UI dropdown options read from it.
3. **Terminal-appropriate defaults are caller-supplied** (windowDays 180, limit 100) — no route change, just params. (Dashboard keeps its own defaults of 1 / 5.)

### 5.3 Gate & teaser (anon UX)

Reuse the shipped VOW pattern verbatim:
- Server returns `locked: true` + `count` + empty `listings` for non-consumers (close prices/addresses never reach an anon DOM — `route.ts:259-265`).
- Client renders `VowGateOverlay` (`src/components/auth/VowGateOverlay.tsx`) over **both** the list and the map: blurred placeholder rows/pins + "N homes sold here — sign in to view" → sign-in → terms (`?next=` returns to the same view).
- Gate is flag-aware (`VOW_ENFORCE_TERMS` via `src/lib/auth/terms.ts`); when enforcement is off, signed-in users pass.

### 5.4 Time window

Dropdown options `1 / 3 / 7 / 30 / 90 / 180d`, **default selection 180** (max comps visible by default; user-chosen). Options generated from `SOLD_DISPLAY_MAX_DAYS` (anything above the cap is omitted). Note: VOW reports sold deals with a lag, so 1–7d windows undercount and backfill over following weeks (documented in the route header).

### 5.5 Sold card + the §10 differentiator

Sold cards render from `SoldListing` (a different shape than `ListingDocument` — use a sibling sold-card variant / adapter, not a forced cast onto `ListingCardBody`). Each card shows:
- **Sold price** (`closePrice`).
- **Sold-vs-ask delta** — `closePrice − listPrice` and `% over/under ask`, computed client-side. **This is the measurably-better-than-HouseSigma axis (§10):** over/under-ask on every pin and row, not buried one click deep.
- Sold date, beds/baths/sqft, address.
- **Brokerage** at sibling weight (`ListOfficeName`, TRREB §6.3(c)) — already returned by the route.
- A **TRREB §6.3 sold-display notice** (mirror the hardcoded notice in `MarketActivityPanel.tsx`).

Map pins in Sold mode use the same coordinates; a sold-price heatmap lens is deferred (§6).

---

## 6. Deferred (explicitly out of scope)

- **Multi-year sold history** — needs (a) BoR/PROPTX-confirmed licensed window and (b) a data path for >180d, since the `sold_listings` collection is pruned to 180d (`pruneOldSold`). Options: expand the collection window (RAM cost — conflicts with the 2026-05-19 RAM policy) **or** an on-demand `raw_vow_sold` server read (no RAM hit, slower). Decision deferred.
- **Leased comps** — the `sold_listings` collection is sales-only (Query B = `StandardStatus=Closed`/`MlsStatus=Sold`). A "Leased" status would require indexing closed leases.
- **Sold-price heatmap** map lens.
- **"Hide spoken-for" toggle** in Active mode.

---

## 7. Compliance checklist (every box must hold)

- [ ] Sold reads server-side only, admin key — never the public browser key.
- [ ] `getConsumer()` gate on the sold route; anon gets count-only + `locked` (no rows).
- [ ] ≤100 listings per query (`MAX_LIST` / CLAUDE.md §4).
- [ ] Brokerage on every sold card at sibling weight (§6.3(c)).
- [ ] TRREB §6.3 sold-display notice present in Sold mode.
- [ ] No LLM/AI touches listing data; all filters deterministic (§4).
- [ ] `SOLD_DISPLAY_MAX_DAYS` conservative (180) pending BoR/PROPTX confirmation of the licensed window.
- [ ] Phase 1 badges are IDX display only (no VOW data, no gate).

---

## 8. Testing approach

Vitest is node-env only (no jsdom — pure logic, no React render tests). Cover:
- `statusBadge()` mapping (each live `Status` value → expected badge/null).
- `SOLD_DISPLAY_MAX_DAYS` clamping of `windowDays` (over-cap → cap; ≤0 → default).
- Sold filter/window cutoff math (`buildSoldFilter` already exists; add coverage for the terminal's polygon + window params).
- Sold-vs-ask delta computation (over/under/`listPrice` null).
- Gate response shape: non-consumer → `{ locked: true, listings: [] }`; consumer → rows.

UI verified via typecheck / lint / build / manual (per repo convention).

---

## 9. Files touched (anticipated)

**Phase 1:** `ListingCardBody.tsx` (+ status badge helper & test); confirm `Status` carried onto the card's doc shape.

**Phase 2:**
- `src/lib/stores/commandCenterStore.ts` — `listingMode` state.
- `FundamentalToggle` host (`FilterBar.tsx` / `TopCommandBar.tsx`) — three-state strip + window dropdown (progressive disclosure).
- `src/app/api/market/activity/sold/route.ts` — return coords; lift cap to `SOLD_DISPLAY_MAX_DAYS`.
- `src/app/properties/page.tsx` — branch the fetch effect on `listingMode`; map viewport → polygon param.
- New sold-card variant component + the §6.3 notice; `VowGateOverlay` wiring over map+list.
- Shared constants/util for the cap + sold-vs-ask delta (+ tests).

---

## 10. Open questions for review

1. Badge wording — "Sold Cond." / "Leased Cond." / "Back on Market" — acceptable, or prefer full words?
2. Anything in §6 (deferred) you want pulled into Phase 2 after all?
3. Sequencing — ship Phase 1 (badges) on its own first, then Phase 2? (My default: yes — Phase 1 is tiny and independent.)
