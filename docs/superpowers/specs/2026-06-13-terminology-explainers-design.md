# Platform-Wide Terminology & Explainers — Design Spec

- **Date:** 2026-06-13
- **Status:** Approved — O-1 resolved as (a); ready for implementation plan
- **Author:** Claude (brainstorming session)
- **Surfaces touched:** Terminal (`/properties`), listing page (`/properties/[id]`), Compare, Dashboard, Analytics, + new `/glossary`

---

## 1. Context & Problem

PureProperty.ca renders ~25 proprietary/branded metric names across its surfaces (True DOM, Capital Burn, Deal Score, Expected Sale Price, etc.). A codebase sweep found three problems:

1. **Misnomers.** The Smart Homebuyer filter chip is labelled **"Yield"** / "Target Gross Yield" but filters `cap_rate_est` — the code itself comments that this is a "legacy misnomer."
2. **Inconsistent wording for one concept.** The same filter/metric wears different names on different surfaces:
   - The duplex toggle (`duplexCandidate`, identical filter string) shows as **"Duplex"** (Smart) and **"Suite / Duplex"** (Cashflow).
   - The density toggle (`zoningPotential` → `is_density_ready`) shows as **"Zoning Potential"** (Smart) and **"Density Ready"** (Builders).
   - The monthly cost-to-own concept appears as **"Carry Cost"** (Terminal) and **"Monthly Carry"** (Compare).
3. **No explainer system.** Help is ad-hoc: a bespoke hover-tooltip on the Map Control Rail, hand-written footnotes on a few cards ("our metric — not an MLS/TRREB figure"), and nothing on dense surfaces. There is no shared "what is this?" affordance and no glossary. The same term can be (and is) explained differently on different pages.

**Constraint from the user:** screen space is tight, so permanent inline subtitles do not fit on dense surfaces. Explanations must be **on-demand** there.

**Goal:** one source of truth for every term's canonical name + plain-language definition; fix the broken names; deliver explanations on-demand (info-tip) plus inline where room exists; ship a public glossary (SEO upside).

---

## 2. Goals / Non-Goals

**Goals**
- A single **Term Registry** that is the source of truth for each concept's canonical display name, short subtitle, and full definition.
- Surfaces read their labels from the registry so a name can never drift between pages.
- A shared **`<TermTip>`** info-tip component (hover on desktop, tap on mobile) used everywhere a branded term appears on a dense surface.
- Inline plain-language **subtitles** where space already exists (listing-page right-rail cards).
- A **`/glossary`** page rendering the registry, grouped, with anchors the info-tips can deep-link to.
- Fix the four confirmed naming defects (below) — **display labels only, zero state/key changes, zero migration**.

**Non-Goals (explicitly out of scope)**
- Renaming any **state key, persona id, filter key, color-metric id, or compare-metric key** (all are persisted in localStorage Lenses + Supabase Market Bubbles; renaming would be a breaking migration for no user benefit — labels carry all the meaning). See the Rename Safety Matrix in §6.
- Reworking the **Capital Burn vs. Carry Cost data model** (two engines compute ~the same concept). The naming registry accommodates either decision; the consolidation itself is a separate data-model change. See §8 Open Question O-1.
- Persona-lens / per-user term reordering (future; the registry is the natural home for it later).
- Adding new metrics or changing any metric's math.

---

## 3. Architecture (Approved: "Approach A" — registry as single source of truth)

### 3.1 Term Registry — `src/lib/glossary/terms.ts`

One entry per concept. Pure data + types, no React, unit-testable in the node vitest env (consistent with `datasheet.ts`).

```ts
export type TermId =
  | "trueDom" | "capRate" | "grossYield" | "capitalBurn" | "carryCost"
  | "monthlyCashflow" | "priceDrop" | "dealScore" | "trueValue"
  | "expectedSalePrice" | "ourCall" | "suitePotential" | "incomeSuite"
  | "multiUnit" | "surplusParking" | "densityReady" | "listingDensity"
  | "renovationUpside" | "condoFeeStability" | "alphaFlag" | "marketPulse"
  | "monthsOfSupply" | "soldToList" | "stale" | "fresh"
  | /* personas */ "personaSmart" | "personaCashflow" | "personaFlippers" | "personaBuilders";

export type GlossaryGroupId =
  | "valuation" | "cashflowCarry" | "timingDistress" | "suiteDensity"
  | "market" | "personas";

export interface TermDef {
  id: TermId;
  /** Canonical display name. THE source of truth — surfaces import this. */
  name: string;
  /** ≤ ~6 words. Shown inline only where space allows (cards). */
  subtitle: string;
  /** 1–2 sentences. The info-tip body and glossary entry. Generic concept
   *  explanation — never a specific listing's gated data (see §7 Compliance). */
  definition: string;
  /** Optional deeper methodology paragraph; glossary-only. */
  methodology?: string;
  /** When true, TermTip + glossary auto-append the standard
   *  "Our metric — not an MLS or TRREB figure" line. */
  notMls?: boolean;
  group: GlossaryGroupId;
  /** Optional: prior names, for the glossary "also known as" + searchability. */
  aka?: string[];
}

export const TERMS: Record<TermId, TermDef>;          // the registry
export const GLOSSARY_GROUPS: { id: GlossaryGroupId; title: string }[];
export function term(id: TermId): TermDef;             // typed accessor
```

**Consistency guarantee:** a unit test asserts that every term rendered on a wired surface resolves through `term()` (no hardcoded duplicate of a registry name), so names cannot silently diverge.

### 3.2 `<TermTip>` — `src/components/ui/TermTip.tsx`

```tsx
<TermTip id="trueDom" />                 // renders: "True DOM ⓘ"
<TermTip id="trueDom">{customLabel}</TermTip>  // override visible text, same tip
```

- Renders the term's `name` (or children) followed by a faint ⓘ trigger.
- **Hover** opens on desktop; **tap/focus** opens on touch + keyboard (non-negotiable — the listing page is mobile-real). Built on the existing `popover.tsx` primitive (already used for InvestorChip) so we reuse focus-trap / outside-click / positioning rather than re-implement.
- Tip body: `subtitle` (bold) + `definition`; if `notMls`, append the standard compliance line; a "Full definition →" link deep-links to `/glossary#<id>`.
- Accessible: trigger is a `<button>` with `aria-label={`What is ${name}?`}`, tip has `role="tooltip"`, ESC closes, ⓘ is not a tab-trap on dense tables (single tab stop per cell).
- Zero layout cost when closed (the ⓘ is inline text-sized; no reserved subtitle row).

### 3.3 Inline subtitle helper

For roomy surfaces (right-rail cards), a thin `<TermName id>` (or direct `term(id).subtitle`) renders the canonical name with the `subtitle` beneath, matching the existing card-header + footnote pattern. These cards keep showing the subtitle permanently; they also use `<TermTip>` for the deeper definition.

### 3.4 `/glossary` page — `src/app/(app)/glossary/page.tsx`

- Server component, statically renderable (registry is static) → fast + indexable.
- Renders `GLOSSARY_GROUPS` → each term as a `<section id={termId}>` with `name`, `subtitle`, `definition`, `methodology`, `aka`, and the compliance line where `notMls`.
- SEO: per-term anchors, sensible `<h2>`/`<h3>`, page `<title>`/meta. Internal links from info-tips ("Full definition →").
- Lives under the `(app)` route group for the unified AppHeader (per design-system note); the Terminal stays ungrouped, so glossary links from the Terminal are plain `<a href="/glossary#...">`.

---

## 4. Registry Contents (initial term set)

Definitions are **deterministic concept explanations** (what the metric means + how it's derived in principle), authored once here, not generated from listing data. Drafts below; final copy refined during implementation. `notMls: true` flagged where the metric is PureProperty-derived.

### Valuation
| id | name | subtitle | definition (draft) | notMls |
|----|------|----------|---------------------|--------|
| `trueValue` | True Value | What the asset is worth | Our estimate of the home's market value from comparable recent sales — independent of the asking price. | ✓ |
| `expectedSalePrice` | Expected Sale Price | Likely closing price | A list-aware estimate of what *this* listing will likely sell for, blending its asking price with how local homes are closing vs. ask. Shifts if the asking price changes. | ✓ |
| `ourCall` | Our Call vs. The Sale | Our pre-sale estimate vs. result | The value our model published *before* the sale price was known, shown next to the actual result for transparency. | ✓ |
| `dealScore` | Deal Score | 0–100 deal strength | A deterministic 0–100 score combining estimated value vs. ask, cashflow, and timing signals into one comparable deal-strength grade. | ✓ |
| `priceDrop` | Price Drop | Total cut from peak ask | The total dollar reduction from the listing's highest ask to its current price — a distress / motivation signal. | |

### Cashflow & Carry
| id | name | subtitle | definition (draft) | notMls |
|----|------|----------|---------------------|--------|
| `capRate` | Cap Rate | Net yield on price | Estimated annual net operating income as a percentage of price — the standard income-property yield measure. | ✓ |
| `grossYield` | Gross Yield | Gross rent ÷ price | Estimated annual gross rent as a percentage of price, before expenses. | ✓ |
| `carryCost` | Carry Cost | Monthly cost to own | Estimated monthly cost to hold the property — mortgage, property tax, and fees. | ✓ |
| `capitalBurn` | Capital Burn | Monthly carry, financed | Estimated monthly cash outflow to carry the property on a standard financed purchase (mortgage + tax + fees + insurance). *(See O-1: relationship to Carry Cost.)* | ✓ |
| `monthlyCashflow` | Monthly Cashflow | Rent minus carry | Estimated monthly rent minus carrying costs — positive means the property pays for itself. | ✓ |

### Timing & Distress
| id | name | subtitle | definition (draft) | notMls |
|----|------|----------|---------------------|--------|
| `trueDom` | True DOM | Real days on market | True days on market — stitched across relistings, so a property re-listed to reset its counter still shows the real elapsed time. | ✓ |
| `stale` | Stale | On market 90+ days | A listing that has been on the market 90+ days (relist-adjusted) — often negotiable. | ✓ |
| `fresh` | Fresh | Newly listed | A recently listed property (low True DOM). | ✓ |
| `alphaFlag` | Alpha Flag | Strongest signal on this listing | The single highest-priority investment signal we detect on a listing, surfaced in priority order: Distressed › Zoning upside › Income suite › Suite potential › Density-ready › Stale › New. | ✓ |

### Suite & Density
| id | name | subtitle | definition (draft) | notMls |
|----|------|----------|---------------------|--------|
| `suitePotential` | Suite Potential | Possible second unit | The property shows characteristics (e.g. separate entrance, layout) suggesting a legal secondary suite could be added. Not a guarantee — verify zoning. | ✓ |
| `incomeSuite` | Income Suite | Existing second unit | The listing already has a second self-contained living unit. | |
| `multiUnit` | Multi-Unit | Multiple dwelling units | The property contains (or can strongly support) multiple separate dwelling units. | ✓ |
| `surplusParking` | Surplus Parking | Spare parking spaces | Parking spaces beyond what the unit count requires — a value/rentability signal. | ✓ |
| `densityReady` | Density Ready | Zoning may allow more units | Zoning and lot characteristics suggest the site may support added density (e.g. missing-middle). Verify with the municipality. | ✓ |
| `listingDensity` | Listing Density | How many listings here | Heatmap intensity = the count of listings in an area. *(Distinct from Density Ready, which is about a single lot's zoning capacity.)* | |

### Market
| id | name | subtitle | definition (draft) | notMls |
|----|------|----------|---------------------|--------|
| `marketPulse` | Market Pulse | Region price trend | Regional price and price-per-sqft trend over time, with year-over-year movement. | ✓ |
| `monthsOfSupply` | Months of Supply | How fast inventory clears | How many months it would take to sell all current listings at the recent sales pace — low = seller's market, high = buyer's market. | |
| `soldToList` | Sold / List | Sale price vs ask | The ratio of sale price to asking price across recent sales — above 100% means homes are selling over ask. | |
| `renovationUpside` | Renovation Upside | Equity unlockable by renovating | An index of how much value a renovation could add relative to the home's current value, before cost. | ✓ |
| `condoFeeStability` | Condo Fee Stability | Fee-increase risk | A signal of how stable this building's condo fees have been, derived from sold condo data in the area. | ✓ |

### Personas
| id | name | subtitle | definition (draft) |
|----|------|----------|---------------------|
| `personaSmart` | Smart Homebuyer | Find hidden value, avoid bidding wars | Lens tuned for buyers hunting undervalued homes, suite potential, and fair carrying costs. |
| `personaCashflow` | Cashflow Investor | Maximize monthly yield | Lens tuned for rental income — cap rate, carry, and suite/parking upside. |
| `personaFlippers` | Flippers & Deal Hunters | Buy under market, force value | Lens tuned for distress and timing — True DOM, price drops, and carry. |
| `personaBuilders` | Builders & Developers | Land assembly & density | Lens tuned for lot size, frontage, and density-ready zoning. |

---

## 5. Naming Changes (display labels only)

Surgical — fix defects, do not churn working brands. All are **label/`short`/`header`/`legend` string edits**; no keys, ids, or filter strings change.

| # | File | Current | → New |
|---|------|---------|-------|
| 1 | `personaConfig.ts` Smart control | `short: "Yield"`, `label: "Target Gross Yield"` | `short: "Cap Rate"`, `label: "Min Cap Rate"` |
| 2 | `compareMetricsConfig.ts` `carry` row | `label: "Monthly Carry"` | `label: "Carry Cost"` |
| 3 | `personaConfig.ts` Smart `duplexCandidate` toggle (`"Duplex Candidate"`/`"Duplex"`) **and** Cashflow toggle (`"Suite / Duplex"`) | mixed | both → `label`/`short: "Suite Potential"` |
| 4 | `personaConfig.ts` Smart `zoningPotential` toggle | `label: "Zoning Potential"` (`short: "Density Ready"`) | `label: "Density Ready"` (short unchanged) |
| 5 *(optional, approved)* | `mapMetrics.ts` density metric | `label: "Density"` | `label: "Listing Density"` |

After these edits, the corresponding surfaces should read their name from `term(...)` (e.g. the Smart cap-rate control's `short` ← `term("capRate").name`) so the registry stays authoritative. Where a `short` must differ from the canonical `name` for space, the surface may keep a literal `short` but its `<TermTip id>` still points at the canonical term.

---

## 6. Rename Safety Matrix (why this is migration-free)

| Item | State key / id (UNCHANGED) | Display label (CHANGED) | Persisted in |
|------|----------------------------|-------------------------|--------------|
| Smart "Yield" filter | `minYield` (key), `cap_rate_est` (field) | "Yield" → "Cap Rate" | Lenses (localStorage `pp_lenses`), Bubbles (Supabase) |
| Duplex toggle | `duplexCandidate` | "Duplex"/"Suite / Duplex" → "Suite Potential" | Lenses, Bubbles |
| Zoning toggle | `zoningPotential` | "Zoning Potential" → "Density Ready" | Lenses, Bubbles |
| Compare carry | `carry` | "Monthly Carry" → "Carry Cost" | Compare row order (localStorage) |
| Density color metric | `id: "density"` | "Density" → "Listing Density" | Lenses (`colorMetricId`), Bubbles |

No URL query-string encoding of filter/persona/color state exists (`/properties` only reads `?city`/`?search`), so there is **no shared-link risk**. Persisted Lenses/Bubbles store **keys/ids, never labels** — so every change above is invisible to deserialization. **No migration required.**

---

## 7. Compliance (CLAUDE.md §4 / VOW)

- Registry `definition`/`methodology` text is **generic concept explanation**, authored by hand — it is never raw IDX/VOW listing data passed through an LLM, and never a specific listing's gated figure. Safe to render to anonymous users.
- `notMls: true` centralizes the existing "Our metric — not an MLS or TRREB figure" disclosure that today is hand-copied across `DealScoreCard`, `ListingEstimateCard`, `ExpectedSaleCard`, `SoldOutcomeCard`, `CondoFeeStabilityCard`. `<TermTip>`/glossary emit it from one place; the cards can drop their bespoke copies once wired (kept identical in wording).
- `<TermTip>` shows **only** static registry text — it does not fetch or reveal any VOW-gated per-listing value, so it cannot regress the anon gate. Existing value-gating on the cards themselves is untouched.

---

## 8. Open Questions

**O-1 (BLOCKING the Capital Burn / Carry Cost copy only — not the rest):** `capital_burn_rate_monthly` (via `calculateBurnRate`, doc-commented "monthly carry cost: mortgage + taxes + HOA + insurance") and `MonthlyCarryCost` (`trueCarryCost`: mortgage + tax + fees) are **two engines computing ~the same concept**. Options:
  - **(a) Keep both, differentiate by framing** — "Capital Burn" = standardized/financed burn estimate (flipper holding cost); "Carry Cost" = itemized true carry. Registry keeps two terms with tip copy that names the difference explicitly.
  - **(b) Consolidate to one** — pick "Carry Cost" as the public concept, retire "Capital Burn" from the UI (keep the field). Cleaner for users; a follow-up data/UX change beyond this naming pass.
  - **Recommendation:** ship (a) now (zero data-model risk, honest tips), log (b) as a follow-up. **Needs user's call at review.**
  - **DECISION (2026-06-13): (a).** Keep both terms; tips state the difference plainly (Capital Burn = standardized financed holding cost / flipper framing; Carry Cost = itemized true carry). Option (b) consolidation logged in §11 as a follow-up.

**O-2 (non-blocking):** Should the four persona names get the ⓘ treatment in the persona selector, or is the selector self-evident? Default: yes, add ⓘ (cheap, helps first-run users).

---

## 9. Testing

- `terms.test.ts` — registry integrity: every `TermId` present; non-empty `name`/`subtitle`/`definition`; `subtitle` ≤ ~40 chars; every term's `group` is a valid `GLOSSARY_GROUPS` id; no duplicate names within a group.
- **Consistency test** — wired surfaces (personaConfig controls/columns, compareMetricsConfig labels, mapMetrics labels) whose concept exists in the registry resolve their display name via `term()` (guards against drift).
- `TermTip` — node/logic test only (vitest is node-env, no jsdom per project note): assert the pure helper that assembles tip text (subtitle + definition + optional notMls line + glossary href) given a `TermId`. UI/interaction verified via typecheck + lint + build + manual.
- Glossary page — assert it renders one section per `TermId` with matching `id` anchors (logic-level: the term→section mapping function).

---

## 10. Phasing (for the implementation plan)

1. **Registry + tests** — `terms.ts` with full term set, definitions, groups; `terms.test.ts`. (No UI yet.)
2. **`<TermTip>` + tip-text helper** — component on `popover.tsx`, with tests for the pure text assembler.
3. **Naming fixes + wire dense surfaces** — apply §5 label edits; point Terminal controls/columns, Compare rows, map metrics at `term()`; add ⓘ on those surfaces. Resolve O-1 framing.
4. **Listing-page cards** — inline subtitle + `<TermTip>`; centralize the `notMls` line; remove duplicated footnote copy.
5. **`/glossary` page** — render registry, anchors, meta; link info-tips' "Full definition →".

Each phase is independently shippable and committed separately (per commit-hygiene preference).

---

## 11. Future / Out of Scope
- Capital Burn / Carry Cost data-model consolidation (O-1 option b).
- Persona-lens / per-user term ordering surfacing through the registry.
- Localization (registry is the natural seam if ever needed).
