# Light / Dark Theme — Implementation Plan (2026-07-01)

## Context — why we're doing this
User feedback: **not everyone likes the dark theme.** The site is currently dark-only.
Goal: offer users a genuine **light option** (a choice), defaulting to their OS
preference so light-preferring users get light automatically, with a manual toggle
to override. The **CommandCenter "terminal" stays dark by design** — it's a
Bloomberg-style, data-dense pro surface where dark is a feature (and the single
biggest migration cost).

This is a big, risky change, so it lives on the `feat/light-dark-theme` branch and
ships in phases, none of which regress the current (dark) experience until the light
side is fully ready.

## Current state (from a codebase audit)
- **Infra is scaffolded but unused.** shadcn/ui pattern is in place: `tailwind.config.ts`
  has `darkMode: ["class"]` and full semantic tokens (`hsl(var(--background))`,
  `--card`, `--muted`, `--border`, `--primary`, …). BUT `globals.css` defines **only
  dark values** in `:root` (with `color-scheme: dark`), there is **no `.dark`/light
  block**, **no `next-themes`**, **no provider**, and `<html>` carries no theme class.
- **Adoption is ~0%.** Only ~12 spots use the semantic tokens; **~2,100 occurrences
  across ~160 files (~77% of the app) hardcode `slate-*`**. **11 chart/SVG files
  hardcode hex** (Tailwind `dark:` can't touch those).
- **Existing light leaks** (hardcoded light backgrounds that look wrong in dark today
  and must become theme-aware): `MapView` popups/badges/counter, `SpatialDistribution`
  cards/pills, `MediaGallery` placeholders, `PropertyCard` save button.

## Scope decision (confirmed)
**Consumer surfaces get light/dark; the terminal stays dark.**
- The terminal's hardcoded `slate-*` colors don't respond to theme (they're literal),
  so they **stay dark for free** — we simply don't migrate them.
- Pin the terminal layout subtree with an always-on `dark` class so any token-based
  bits inside it also stay dark regardless of the global theme.
- We migrate only: shared components, listing/detail pages, dashboard, public/marketing
  and auth pages, and the charts that appear on consumer pages.

## Architecture
- **`next-themes`**: `attribute="class"`, `defaultTheme="system"`, `enableSystem`,
  `disableTransitionOnChange`. (Alternative: ~40-line custom provider — but next-themes
  handles SSR, persistence, and no-flash correctly out of the box.)
- **`globals.css`** restructured to shadcn convention: **light values in `:root`,
  dark values under `.dark`**, with `color-scheme` set per theme.
- **Terminal**: its layout wrapper gets `className="dark"` to pin the subtree dark.
- **Charts**: a small `useThemeColors` module (reads CSS vars / resolved palette)
  replaces hardcoded hex in consumer charts.
- **Root layout**: add `suppressHydrationWarning` on `<html>` + an inline no-flash
  script (next-themes provides this).

## Phases
- **Phase 0 — Hygiene (this branch, low risk).** Convert genuine themed-surface
  light-leaks to **semantic tokens** (`bg-card`, `text-foreground`, `bg-muted`,
  `border-border`, …) so they're correct in dark now and automatically correct in
  light later. A closer look refined the audit list:
  - **Done:** `MediaGallery` placeholders (`bg-gray-100`/`text-gray-400` → `bg-muted`/`text-muted-foreground`).
  - **Not a leak (leave):** `PropertyCard` save-heart is overlaid on the property
    *photo*, not a themed surface — reads fine in both themes.
  - **Deferred to Phase 2 (light-first whole-card components, need conversion +
    quick design review):** `SpatialDistribution` (room-size card on the detail page)
    and the `MapView` popup (note: light map info-cards are a common convention, and
    it renders inside the always-dark terminal — confirm intent before darkening).
  - **NOTE:** a repo-wide ESLint ban on `bg-white`/`bg-gray-*`/raw hex would fail CI
    immediately (~2,100 existing usages + 11 chart files). It must be introduced
    **scoped to migrated dirs** or as a warning, at the END — see Guardrails.
- **Phase 1 — Plumbing (~1–2 days).** Add next-themes + provider, restructure
  `globals.css`, pin the terminal to `.dark`, add the header toggle + no-flash script.
  Ship dark-default; light only "lights up" migrated areas.
- **Phase 2 — Migrate consumer surfaces (the bulk), wave by wave:**
  1. Shared components (PropertyCard, MediaGallery, headers) — highest leverage
  2. Listing / property detail pages
  3. Dashboard
  4. Public / marketing / auth pages
  5. Consumer charts (CampaignHistoryChart, DOMTimelineChart, CompareValuePlot,
     RoomMap, metricViz, ListingCompare) via `useThemeColors`

## Sequencing rationale
Migrate to tokens **first** — it's behaviorally invisible (tokens resolve to dark in
`:root`), so it can merge continuously. Flip on the light values + the toggle **last**,
so a half-migrated light mode is never shipped.

## Codemod mapping (starting point — review each; context matters)
`bg-slate-950 → bg-background` · `bg-slate-900 → bg-card` ·
`bg-slate-800 → bg-muted`/`bg-secondary` · `border-slate-800/700 → border-border` ·
`text-slate-100/200 → text-foreground` · `text-slate-400 → text-muted-foreground` ·
`bg-white → bg-card`/`bg-background`/`bg-popover` · `bg-gray-100 → bg-muted` ·
`text-gray-* → text-muted-foreground` · `border-gray-* → border-border`.

## Guardrails
- ESLint rule: no hardcoded color utilities / raw hex in components (outside the
  token module + explicitly-allowed brand assets). **Introduce LAST or scoped to
  migrated directories** — a repo-wide ban breaks CI on the ~2,100 existing usages.
- Playwright screenshot tests of key consumer pages in **both** themes.
- Migrate-and-verify per wave; terminal must stay visually unchanged (pinned dark).

## Default-theme knob (confirm in Phase 1)
Recommended: `defaultTheme="system"` (directly serves the light-preferring users) +
manual toggle. Alternative: keep dark as the default with opt-in light.

## Effort
~**40–70 hrs** total (Phase 0 ≈ half day, Phase 1 ≈ 1–2 days, Phase 2 the rest).
Excluding the terminal is what keeps this out of the ~100–150 hr full-site range.

## Explicitly out of scope (for now)
- Terminal / CommandCenter theming (stays dark).
- Google sign-in button (`SocialAuthButtons`) — its white styling is brand-intentional;
  use Google's official dark button variant if a dark version is wanted.
- `ListingCompare` "other platforms" white card — intentional contrast vs. our dark card.
- `PropertyCard` save-heart — overlaid on the photo, not a themed surface; fine as-is.

## Status
- [x] Branch `feat/light-dark-theme`
- [x] Design doc (this file)
- [x] Phase 0 — `MediaGallery`, `SpatialDistribution`, `MapView` popup tokenized
- [x] Phase 1 — plumbing: `next-themes`, globals split (light `:root` / dark `.dark`),
      `ThemeProvider` (defaultTheme "dark" — UX unchanged), terminal pinned dark via
      `properties/layout.tsx`, interim toggle in `(app)/layout.tsx`
      - TODO when Phase 2 done: flip defaultTheme → "system"; move toggle into
        `AppHeader`; add toggle to marketing/home (root) pages; theme the `--pp-*`
        surface tokens for light (currently dark values shared on `:root`)
- [ ] Phase 2 — consumer migration waves
- [ ] Guardrails — scoped ESLint rule + Playwright dual-theme screenshots (LAST)
