# Status-Aware Listing Page + True Value Rebrand — Design

**Date:** 2026-06-11
**Branch:** `feat/status-aware-listing` (cut from `origin/main` — depends on Expected Sale Price, PR #25)
**Status:** Approved by user

## Problem

The listing detail page (`src/app/(app)/properties/[id]/page.tsx`) renders every row in the
`listings` table through the active-listing template. Sold listings (Query B upserts them with
`StandardStatus='Closed'` / `MlsStatus='Sold'` and `ClosePrice` in `full_payload`) still show
"Listed X days ago", Deal Score vs ask, Expected Sale Price, and Schedule Viewing — all
meaningless once the outcome is known. Terminated/Expired/Suspended listings are worse: their
`listings` row stays frozen looking Active (Query C only writes `raw_vow_delisted`), so the page
presents a dead listing as live.

Separately: once a property sells, we know exactly how accurate our estimate was. Showing that
("we called it within 0.3%") is a credibility-building attention-grabber HouseSigma also uses —
ours can show the receipt.

## Decisions made during brainstorming

- **Accuracy card shows ONLY the closest model** (AVM vs Expected Sale Price — in practice almost
  always ESP at ~2.1% median error). Showing the list-blind AVM delta alongside (~11% median
  error) would hurt credibility. The card labels which model made the call.
- **AVM rebrand is in scope:** "PureProperty Estimate" → **"True Value"** (label-only; pairs with
  True DOM as the house metric family). Narrative: True Value = what the asset is worth;
  Expected Sale Price = what the market will pay today.
- **De-listed treatment = Option A (keep the valuation stack):** the off-market state is lead-gen
  for flipper/deal-hunter personas; True Value is *most* interesting when the seller failed to get
  their ask.
- Leased terminal status gets the sold treatment, labeled "LEASED".

## 1. Status resolution (data layer)

`getListingDetail` gains a `status` field:

```ts
type ListingStatus =
  | { kind: "active" }
  | { kind: "sold"; label: "SOLD" | "LEASED"; closePrice: number | null; closeDate: string | null }
  | { kind: "delisted"; mlsStatus: string; delistedDate: string | null;
      daysOnMarket: number | null; lastListPrice: number | null };
```

- **sold** — `full_payload.StandardStatus === 'Closed'` or `MlsStatus in ('Sold','Leased')`.
  `closePrice` from `ClosePrice`, falling back to `saleHistory.lastClosePrice` (covers
  `DoNotDiscloseUntilClosingYN` non-disclosure); may be null.
- **delisted** — not sold AND a PK point-lookup on `raw_vow_delisted` by `listing_key` hits.
  Carries `mls_status` (Terminated/Expired/Suspended), `delisted_date`, `days_on_market`,
  `list_price`. One indexed lookup, best-effort with timeout like the page's other lookups.
- **active** — everything else. Page renders exactly as today (zero behavior change).

Plus server-computed **`soldAccuracy`** (sold only):

```ts
interface SoldAccuracy {
  modelLabel: "Expected Sale Price" | "True Value";
  estimateValue: number;
  closePrice: number;
  diffPct: number; // signed: (estimate − close) / close
}
```

Compare `closePrice` against both `estimate.estimatedValue` and `expectedSale.expectedPrice`;
keep only the closest by |diff|. ESP for a sold row = final list × current cohort ratio — i.e.
what we'd have published the day before it sold. Null when no close price or both models null.

### VOW gating

The status **kind is public** (anon sees the SOLD/OFF MARKET badge — HouseSigma model). The
numbers are not: `gateVowDerived` strips `closePrice`, `closeDate`, `soldAccuracy`, and
de-listed specifics (`delistedDate`, `daysOnMarket`, `lastListPrice`, `mlsStatus` detail) for
anonymous users. Anon renders locked teasers: *"Sold — sign in to see the sold price and how
close our estimate was."* Conversion hook + compliance in one.

## 2. Sold view (page branches on `status.kind === "sold"`)

**Header:**
- Rose "SOLD <date>" (or "LEASED") badge.
- Sold price becomes the hero number; final ask struck through beside it with a "% of ask" chip.
- "Listed X days ago" → "Sold after N days on market".
- Anon: list price stays hero; sold price renders as a locked chip.

**Right rail:**
- **NEW top card — "Our Call vs. The Sale"** (`SoldOutcomeCard`): *"We expected $872,000 — it
  sold for $875,000. Within 0.3%."* Labeled with the model that made the call. Confidence-aware
  copy: |diff| < 3% gets the bragging tone; larger misses get neutral framing ("sold above our
  expected range") so a miss never reads as a hidden flex. Anon: locked teaser.
- **Hidden:** Deal Score card + header badge, Expected Sale Price card, Schedule Viewing.
- **Kept:** True Value card (ask-delta line hidden — ask is moot), Renovation Upside,
  Underwriting Sandbox **seeded with the sold price**, Watchlist/Compare, Condo Fee Stability,
  full history band.

**Meta/SEO:** title suffixed "— SOLD"; JSON-LD offer availability → `SoldOut`; non-Active pages
already noindex (no change).

## 3. De-listed view (`status.kind === "delisted"`)

**Header:** amber "OFF MARKET" badge + banner line *"Terminated Mar 14 after 71 days at
$949,900"*. Anon sees only "Off market" (specifics gated, consistent with the Terminal's
de-listed layer).

**Right rail:**
- **Kept:** True Value + Renovation Upside (Option A), Underwriting Sandbox (seeded with last
  list price, current behavior), Condo Fee Stability.
- **Hidden:** Deal Score, Expected Sale Price.
- **CTA:** Schedule Viewing → **Add to Watchlist as primary** ("get alerted if it relists" —
  status-change alerts already fire on relist).

## 4. True Value rebrand

Label-only rename of "PureProperty Estimate" → **"True Value"**, subtitle "what the asset
itself is worth — independent of asking price". Surfaces: `ListingEstimateCard`, dashboard,
compare view, AVM page, and any other user-facing label occurrences. Internal identifiers
(`estimate`, `AVMResult`, function names, DB fields) untouched.

## 5. Components & files

| File | Change |
| --- | --- |
| `src/lib/property/getListingDetail.ts` | status resolution, `raw_vow_delisted` lookup, `soldAccuracy`, gating additions |
| `src/app/(app)/properties/[id]/page.tsx` | branch header + rail by `status.kind`; meta/JSON-LD tweaks |
| `src/components/Property/SoldOutcomeCard.tsx` | NEW — accuracy card with locked-teaser state |
| `src/components/Property/ListingEstimateCard.tsx` | True Value rename; hide ask-delta when sold |
| `src/app/(app)/properties/[id]/ListingActions.tsx` | hide Schedule Viewing for non-active; Watchlist primary for delisted |
| `src/components/Property/UnderwritingSandbox.tsx` | accept sold-price seed (prop only) |
| other label files | True Value rename sweep |

## 6. Testing

Pure-logic vitest (node env — no jsdom, per repo convention):
- status resolution from payload/delisted-row fixtures (sold, leased, closed, delisted, active,
  frozen-Active-with-delisted-row);
- accuracy picker: closest-model selection, non-disclosure fallback to `saleHistory`, null cases;
- `gateVowDerived` strips sold/delisted numbers but keeps `kind`.

UI verified via typecheck/lint/build + manual screenshots of all three states.

## Edge cases

- Sold, no disclosed price anywhere → sold banner without price, no accuracy card.
- Both models null → no accuracy card.
- Sold AND present in `raw_vow_delisted` (terminated then sold on relist) → sold wins.
- Accuracy miss > 3% → still shown, neutral copy (honesty over flex).
