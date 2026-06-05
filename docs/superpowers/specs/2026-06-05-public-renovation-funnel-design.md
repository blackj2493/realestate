# Public Renovation-Upside Funnel — Design Spec

**Date:** 2026-06-05
**Status:** Approved (brainstorm), pending implementation plan
**Working route:** `/whats-my-home-hiding`

---

## Context

PureProperty.ca already ships a renovation-ROI engine (the "Value-Add Engine") and a
signed-in tool that runs it on a *user-described* home (`/hidden-equity` →
`HiddenEquityForm` → `/api/avm/hidden-equity` → `fetchValueAddReport`). The engine and
its structured-input collection are production-ready.

The idea: expose this as a **public, potentially viral** tool so anyone can estimate
what renovations would pay back in their own home — turning reach into signed-in
accounts.

The blocker is **not** data collection (already solved by the structured form). It is
**compliance.** Every renovation dollar figure is `P0 · (exp(Σ β·Δz) − 1)`, where the
`β` coefficients are fitted on `raw_vow_sold` (the TRREB VOW *sold* feed) and `P0` is
the VOW-derived AVM estimate. Per `requireConsumer.ts` and the PROPTX VOW Datafeed
Agreement, VOW data **and everything derived from it (AVM, Value-Add)** may only be
served to a registered Consumer with bona-fide interest. A fully public, anonymous
renovation calculator would serve VOW-derived output to the world — risking **API
revocation**. That is precisely why the existing tool is sign-in gated.

This design threads that needle: a public funnel whose **hook is public** but whose
**VOW-derived answer stays gated**, using the platform's existing locked-teaser pattern.

## Decisions (locked during brainstorm)

| Axis | Choice | Rationale |
| --- | --- | --- |
| Compliance posture | **B — public hook, gated answer** | Stays inside current VOW posture; mostly re-wires existing code. |
| Viral loop | **A — curiosity-gap invite** via branded share cards | A true loop needs an *invitation* that spreads, not a shared number (sharing the number re-opens compliance). |
| Reveal screen | **C — hybrid** | Generic non-VOW move catalog + one **blurred hero number** for the curiosity gap; ranking + per-move dollars stay locked. |
| Share card | **B-challenge + A-neighbourhood** | User-minted, post-reveal "I found mine — what's hiding in *your* Churchill Meadows home?" Strongest peer-to-peer propagation, zero VOW content. |

## Goals

- A public, SEO-indexed, shareable entry point that runs the renovation analysis on a
  user-described home with **no login required to start**.
- Convert anonymous visitors to signed-in consumers at the moment they want the real
  numbers (the "reveal").
- A self-propagating share loop driven by post-reveal neighbourhood challenge cards.
- **Zero** new compliance surface: anonymous users never receive VOW-derived output.

## Non-goals (v1 / YAGNI)

- Street-address collection or geocode prefill — the engine needs only
  City→Community→Type + attributes; address adds friction. Future.
- Persisting the user's home (`manual_properties` table / Portfolio) — v1 is stateless:
  compute, show, optionally persist later. Portfolio is a separate future section.
- Sharing the actual dollar result — forbidden by compliance.
- Heavy referral analytics — at most a passive `ref` query param.

## The compliance boundary (the spine)

Everything else serves this. Three hard rules:

1. **Anonymous path never runs the AVM and never receives a VOW-derived number.**
   The server returns only the applicable **move catalog + GTA cost ranges**
   (construction benchmarks from `MOVE_CATALOG` — *not* VOW) and a **non-numeric
   blurred-hero placeholder** (`$▓▓▓,▓▓▓`). The real figure does not exist in the anon
   DOM — same rule `VowGateOverlay` already enforces (server strips, never blurs-real).

2. **Authenticated consumer path** runs `calculateAVM` + `fetchValueAddReport` and
   returns the full report. It flows through the existing `requireConsumer` /
   `getConsumer` gate, so when `VOW_ENFORCE_TERMS=true` the unlock automatically also
   requires the bona-fide terms attestation. No new gate is invented.

3. **Share card / OG image carries zero VOW-derived content** — neighbourhood name +
   challenge copy only. The deep link carries only the community slug, never a number.
   Cost-stat copy (if any) must stay industry-generic, not "our data says X".

## Architecture

### Routes & surfaces

- `app/whats-my-home-hiding/page.tsx` — public SSR landing. SEO metadata + the form.
  Reads optional `?community=<slug>` to prefill the community dropdown.
- `app/api/avm/hidden-equity/route.ts` (**restructured**) — branch on `getConsumer()`:
  - anonymous → `{ locked: true, catalog, costRanges }` (no AVM/value-add run).
  - consumer → `{ locked: false, report: ValueAddReport }` (existing behaviour).
  - **Behaviour change:** anonymous currently returns `401`; it must now return the
    locked catalog payload instead.
- `app/whats-my-home-hiding/opengraph-image.tsx` (or a `next/og` `ImageResponse` route)
  — dynamic share-card image rendered from the community slug. Confirm whether the
  existing listing OG setup uses `next/og` and reuse it; else add an `ImageResponse`
  route.

### Reused assets (almost no net-new logic)

- `src/components/hiddenEquity/HiddenEquityForm.tsx` — the public form, inputs unchanged
  (City→Community→Type, beds/baths/parking, interior/exterior/basement tiers, optional
  sqft).
- `src/lib/avm/valueAdd/moveCatalog.ts` (`MOVE_CATALOG`) — source of the anon catalog +
  cost ranges (already non-VOW).
- `src/lib/avm/calculator.ts` (`calculateAVM`) + `src/lib/avm/valueAdd/engine.ts`
  (`fetchValueAddReport`) — **authenticated path only**, untouched.
- `src/lib/auth/requireConsumer.ts` (`getConsumer`) — the gate; anon returns locked,
  not 401.
- `src/components/Property/ForceAppreciationCard.tsx` (`locked` prop) +
  `src/components/auth/VowGateOverlay.tsx` — the reveal-C locked-teaser UI.
- `MagicLinkForm` + `?next=` — one-tap unlock that returns to the reveal.

### Data flow

1. Visitor lands (often from a share link `?community=churchill-meadows`) → form
   prefilled.
2. Submit → `POST /api/avm/hidden-equity`:
   - anon → locked catalog payload (no AVM run).
   - consumer → full `ValueAddReport`.
3. **Reveal C** renders: catalog + costs always; hero number + ranking are real if
   unlocked, blurred placeholder + "Unlock my ranking →" if locked.
4. Anon clicks Unlock → magic-link sign-in. Form inputs are stashed in `sessionStorage`
   before redirect and rehydrated on return (inputs **never** go in the shareable link),
   so the reveal re-computes post-auth with no re-entry.
5. Post-reveal → "What's hiding in your neighbour's home?" → mints
   `/whats-my-home-hiding?community=<slug>` + dynamic OG card → spreads → back to step 1.

### New, small logic to write

- **`buildAnonCatalog(input)`** — given the user's home attributes, return the
  applicable subset of `MOVE_CATALOG` with cost ranges and a `locked` hero placeholder.
  Pure, deterministic, **no VOW reads**. Applicability uses only the home's own
  attributes (e.g. don't offer "finish basement" if already finished).
- **community slug helpers** — `slugifyCommunity` / `parseCommunitySlug` for the
  `?community=` round-trip and OG card.
- **sessionStorage stash/rehydrate** for form inputs across the sign-in redirect.

## Testing

- **Compliance guard test (the important one):** assert the anonymous API response
  contains no hero value, no per-move dollars, and no ranking — only catalog + cost
  ranges. This is the regression guard against accidentally leaking VOW-derived output.
- Unit (vitest, node-env): `buildAnonCatalog` applicability logic; anon-payload builder;
  community slug parse/format round-trip.
- typecheck / lint / build green.
- Manual end-to-end: form → locked reveal → sign in → unlocked reveal → OG card render.
  (Per stack: UI verified via build + manual, not jsdom render tests — vitest is
  node-env.)

## Open questions for the plan

- Exact public slug (`/whats-my-home-hiding` is the working default).
- Whether `/hidden-equity` redirects to the new public route or stays as the in-terminal
  authed entry.
- Whether the existing OG infrastructure is `next/og`-based (reuse) or needs a new
  `ImageResponse` route.
