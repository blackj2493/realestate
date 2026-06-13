# PureProperty.ca — Mobile Terminal Spec (Decision + Build Contract)

**Date:** 2026-06-13 · **Companion to:** `UX_AUDIT_2026-06-13.md`
**Status:** In build. Interaction model decided; foundation + persona cards + responsive detail shipped.

> **Implementation note (reconciliation).** Mobile list/card-first was implemented via **responsive `md:` breakpoints + a `ResizeObserver` `compact` mode** (parallel branch `fix/defake-c4-mobile-terminal`, commit `95687f0`), **not** the `useIsMobile` component fork in §3. The fork plan is superseded; `useIsMobile.ts` is kept for the upcoming map toggle. So "fork the face" became "responsive the face" — same outcome (list-first mobile), less duplication.

### Build status (2026-06-13)
- ✅ **Foundation** — `useIsMobile` hook; viewport `100dvh`/safe-area/`viewport-fit=cover`/dark `theme-color` (`layout.tsx`, `globals.css`); terminal uses `h-app` not `h-screen`.
- ✅ **List/card-first terminal** — map hidden `<md`, ledger full-width, price no longer truncates (parallel `95687f0`).
- ✅ **Persona metric strip** — mobile cards now show the persona's shadow-data as labeled chips (CAP / DOM / DROP / …) instead of dropping all columns; the moat is visible on mobile for all 4 personas (`LedgerRow.tsx`, shared `ColumnValue`).
- ✅ **Responsive listing detail** — `ListingTerminal` 70/30 stacks to one column `<lg` (no more ~112px calculator).
- ✅ **Map toggle** — mobile-only list/map segmented control (`page.tsx`); map is list-first-hidden `<md`, one tap to reveal it (resize-nudged on show). Desktop unchanged (both panes).
- ✅ **Mobile filter access** — `FilterBar` is a horizontally-scrollable chip strip (`overflow-x-auto no-scrollbar`), a standard, functional mobile pattern. A dedicated bottom sheet is deferred as polish, not a fix.
- ✅ **Lead path** — **reused the existing `viewing_requests` system** (migration `036`, `/api/viewing-requests`) — no new table/route. `ScheduleViewingForm` now renders **inline inside `ListingTerminal`** (was a link to the full page), so the funnel closes in the terminal on mobile; route sets `replyTo` so the agent can reply straight to the lead; leads email to `VIEWING_REQUESTS_EMAIL` = `blackj8591@gmail.com`.
  - **Prod ops required:** set `VIEWING_REQUESTS_EMAIL=blackj8591@gmail.com` in the runtime env (Railway/Vercel); confirm migration `036_viewing_requests.sql` is applied; confirm `alerts@pureproperty.ca` is a Resend-verified sender.

---

## 0. Why this exists

Mobile is **the primary product surface and the lead funnel** — it gets the most traffic and it must work great for **all four personas**, not just degrade. Today it doesn't reflow, it clips: the Terminal (`src/app/properties/page.tsx`) is a fixed desktop split (side-by-side map + ledger, fixed-px ledger), and the entire 44-file CommandCenter has ~4 responsive usages. On a phone the map vanishes, prices truncate (`$8…`), and the logo overlaps the persona (`UX_AUDIT` C4).

This spec defines the mobile experience we build instead. It is **not** a port of the desktop terminal — it is a mobile-first surface that reuses the desktop's data/state layer.

---

## 1. North star & principles

1. **Mobile-first, all four personas.** The job-to-be-done is *"is this a deal — yes/no — on my phone,"* then *"contact you."* Lead capture is the revenue lever; design backward from it.
2. **The moat is shadow-data-per-row** (Cap Rate, True DOM, Price Drop, Suite, Density). That data **only renders in a card** — a map pin can encode one metric at most. So the card is the hero surface.
3. **Reuse the brain, fork the face.** All state (`commandCenterStore`) and data logic (`performSearch`/`runActiveSearch` in `page.tsx`) already live outside the layout. Mobile reuses 100% of it. Only presentation forks.
4. **Compliance is non-negotiable** and survives the rebuild (see §7).

---

## 2. The decision (settled)

**List/card-first default · hybrid with a one-tap map · persona-adaptive.**

- **Default surface = list of deal cards** for all four personas (the moat lives in the card; comparative triage is the mobile job).
- **Map is always one tap away** (toggle / segmented control), never the thing that buries the data.
- **Map prominence is persona-adaptive** (§4), reusing the existing `defaultMapMode` in `personaConfig.ts`.

Rationale (full version in chat history): NN/G usability research favors list-default for information density; industry (Zillow/Redfin/Rightmove) favors a map+list **hybrid**. The tie breaks to list-first for *us* because (a) our money personas do comparative triage, not spatial discovery, and (b) our differentiator can't render on a pin. HouseSigma can be map-first because its value (sold price) fits on a pin label; ours does not. We'll validate with our **own funnel analytics**, which beats any external study.

---

## 3. Architecture — the fork

```
src/app/properties/page.tsx
  └─ useIsMobile()  ──true──▶  <MobileTerminal/>      (new)
                    ──false─▶  <DesktopTerminal/>     (today's CommandCenterContent, extracted)
```

- **New:** `useIsMobile()` hook (`matchMedia('(max-width: 767px)')`, SSR-safe). Precedent: `src/components/compare/CompareMobile.tsx` already proves device-specific components in this codebase.
- **Shared, untouched:** `commandCenterStore`, `performSearch`, `runActiveSearch`, `searchListings`, `PERSONA_CONFIG`, `useIsAuthed`, all Typesense/VOW/compliance logic.
- **Forked (new mobile components):** layout shell, header, card list, map mode, filter sheet, listing detail sheet. Reuse `ListingCardBody`, the `Cell` renderers from `LedgerRow`, `AlphaBadge`, `WatchHeart`, `VowGateOverlay`, `ListingThumbnail` wherever possible.

**New files (proposed):**
```
src/hooks/useIsMobile.ts
src/components/CommandCenter/mobile/MobileTerminal.tsx     // shell + surface switch
src/components/CommandCenter/mobile/MobileHeader.tsx
src/components/CommandCenter/mobile/DealCard.tsx           // the hero card
src/components/CommandCenter/mobile/MobileMap.tsx          // full-screen map + peek
src/components/CommandCenter/mobile/FilterSheet.tsx        // bottom sheet
src/components/CommandCenter/mobile/MobileListingSheet.tsx // stacked detail + calc sheet
```

---

## 4. Persona-adaptive defaults

All personas are **list/card-first**. Two dials adapt per persona, both already encoded in `personaConfig.ts`:

| Persona | Mobile default surface | Map prominence | Map render mode (`defaultMapMode`) | Card metric strip (= persona `columns`) |
|---|---|---|---|---|
| **Flippers & Deal Hunters** | List | Full-list + one-tap map | `listings` (pins) | True DOM · Price Drop · Carry Cost |
| **Cashflow Investor** | List | Full-list + one-tap map | `heatmap` (3D) | Cap Rate · Yield · Carry Cost |
| **Builders & Developers** | List | Full-list + one-tap map | `heatmap` (3D) | Lot dims · Zoning · Density |
| **Smart Homebuyer** | List | **Map peek elevated** (split: map strip on top, cards below) | `listings` (pins) | True DOM · Cap Rate · Carry Cost |

Smart Homebuyer is the one persona with genuine spatial intent (schools, commute), so it defaults to a Zillow-style split-peek rather than full-list. The metric strips are literally the persona's existing non-address/non-alphaFlag `columns`, re-laid-out as badges — so the card stays the single source of truth with the desktop ledger.

---

## 5. Screen-by-screen

### A. Mobile header (`MobileHeader`)
- Row: **logo (mark only)** · location search (tap → expands to full-width sheet) · **persona switcher** · **Filters** button (badge = active filter count).
- Replaces the 3-column desktop grid that overlaps at ≤360px. Persona switcher is prominent here (desktop hides it behind `sm:`) — all four personas must be one tap.
- Layer toggles (For Sale / Sold / Leased) move into a compact segmented control or the filter sheet.

### B. The deal card (`DealCard`) — hero surface
Anatomy (vertical card, full-width, ~tap-target generous):
- Thumbnail (16:9), `WatchHeart` top-right, `DealScoreGradePill` top-left (gated for anon).
- Address + price (price **never truncates** — full `$` value; fixes C4).
- **Persona metric strip**: 3 shadow-data badges from the persona's `columns` (table §4), rendered via the existing `Cell`/`AlphaBadge` logic. Gated metrics (True DOM, deal score) show the 🔒 state for anon (§6.2(f), reuse `isAuthed`).
- `AlphaFlag` badge (DISTRESSED / SUITE / PRICE DROP…).
- **Brokerage line** — mandatory, same weight as other details (§7 / CLAUDE.md §4).
- Tap → listing detail (§E).

### C. Map mode (`MobileMap`)
- Reached via the header/segmented map toggle (or default split for Smart Homebuyer).
- Full-screen `AlphaMap` in the persona's `defaultMapMode`; the desktop "instrument deck" (MapControlRail/Drawer/Dock — currently absolute-positioned, overlapping on mobile) collapses into **one FAB → bottom sheet** of map tools.
- Tap a pin/hex → **card peek** (a single `DealCard` slides up); swipe between peeks; tap → detail.
- Honors the 100-listing cap and VOW gate overlay.

### D. Filter sheet (`FilterSheet`)
- Bottom sheet opened from header **Filters**. Renders the persona's `controls` (sliders/ranges/toggles from `personaConfig`) — no always-on filter bar stealing vertical space.
- "Apply" / live-count ("328 deals"); "Reset". Active-count badge on the header button.

### E. Listing detail — ✅ v1 done (2026-06-13)
- **Implemented as a responsive refactor of `ListingTerminal.tsx`, not a separate clone** — the modal carries ~150 lines of on-open data hydration (media, rooms, deal score, AVM, sale history, schools); cloning would duplicate all of it. "Reuse the brain, fork the face" (§3) ⇒ make the one component responsive.
- The 70/30 split now stacks to a single scroll column below `lg`: asset details full-width, then the calculator rail full-width below (was a hard `w-[30%]` → ~112px). Specs grid `grid-cols-2 sm:grid-cols-4`; schools `grid-cols-1 sm:grid-cols-2`. Desktop 70/30 unchanged.
- **Remaining (pairs with Phase 1 lead path):** mobile sticky bottom CTA bar ("Run the numbers" jump-to-calculator + the **Contact** lead button). Deferred deliberately — the Contact button needs the `leads` table + Resend destination from §9.3, which Phase 1 builds.

### F. Lead-capture path (the money path)
- Persistent, reachable **"Contact / Ask about this"** CTA on the listing detail (and optionally on the card peek). This is the funnel's revenue step — instrument it first.

---

## 6. Viewport foundation (global, applies beyond the terminal)

| Fix | Where | Change |
|---|---|---|
| `100vh` cutoff under mobile chrome | `page.tsx:272` (`h-screen`), `layout.tsx:26` (`min-h-screen`) | → `h-[100dvh]` / `min-h-[100dvh]` (with a `--app-height` JS fallback if needed) |
| Notch / home-indicator collisions | `layout.tsx`, header/sheets | add `viewport-fit=cover` (viewport meta) + `env(safe-area-inset-*)` padding |
| Touch scroll/overscroll on sheets & list | new mobile components | `overscroll-contain`, momentum scroll, no `cursor-*`/hover-only affordances |

---

## 7. Compliance carryovers (must survive the rebuild)

- **≤100 listings per query** (`MAX_LISTINGS`) — map and list both.
- **Mandatory brokerage display** on every card and thumbnail, same font weight as other details (CLAUDE.md §4).
- **VOW shadow-data gating** for anon (True DOM, distress, deal score) — reuse `useIsAuthed` + lock states.
- **Typesense-exclusive** frontend queries; **no LLM** on listing data.
- VOW disclaimer line where sold/leased/de-listed comps appear (as in `LedgerPanel`).

---

## 8. Phasing

| Phase | Scope | Outcome |
|---|---|---|
| **0 — Foundation** | `useIsMobile`, `100dvh` + safe-area + viewport meta, `MobileHeader` collapse | Viewport stops jumping; logo/persona overlap (C4) fixed; fork seam in place |
| **1 — MobileTerminal v1 (funnel core)** | List of `DealCard`s + persona switcher + `FilterSheet` + Contact CTA | The lead-gen surface works end-to-end for all 4 personas |
| **2 — Map mode** | `MobileMap` toggle, FAB tool sheet, pin→card peek, Smart split-view | Hybrid one-tap map complete |
| **3 — Listing detail** | `MobileListingSheet` (stacked) + calculator bottom sheet | Kills the 112px-calculator bug; interactive underwrite on mobile |
| **4 — Polish + measure** | Per-persona QA on a **real device**; instrument `map_opened`, `card→contact` | Your own funnel data starts settling map-vs-list per persona |

Commit between phases (CLAUDE.md §8).

---

## 9. Open decisions (need your call before/inside the relevant phase)

1. **Breakpoint:** `767px` (phones + portrait small tablets) as the mobile cutoff — OK, or split phone/tablet?
2. ~~**Detail surface:** in-terminal `MobileListingSheet` vs routing to the existing `properties/[id]` page.~~ **DECIDED (2026-06-13): build `MobileListingSheet`** (keeps map/list context, reuses the 70/30 modal's sub-components stacked).
3. ~~**Contact CTA target:** where does a lead go?~~ **DECIDED (2026-06-13): dual-write — Supabase `leads` table (owned pipeline) + Resend instant notification to the agent.** No external CRM yet. Lead payload carries property (listing_key, address, price, brokerage) + active persona + key filters; pre-fill email for authed users. Truthful copy + one-line PIPEDA consent. Wired in Phase 1.
4. **Smart Homebuyer split-peek** vs full-list-like the others — keep the persona exception, or make all four identical for v1 and add the peek later?

---

## 10. Out of scope (already acceptable on mobile)

Landing (`/`), Apply, Login, and the standalone `properties/[id]` page already use `md:` breakpoints and reflow. This spec is the **Terminal** and its detail view only.
