# Unified Search Bar — Design

**Date:** 2026-05-29
**Status:** Approved (pending spec review)

## Problem

The app has two different search bars:

- **The good one — `LocationSearch`** (`src/components/CommandCenter/LocationSearch.tsx`): a debounced Typesense typeahead with MLS#/address/city-neighbourhood suggestions, icons, keyboard nav, and live active-listing counts. It lives only on the `/properties` terminal, mounted via `TopCommandBar`.
- **The weak one — the plain `<input>` in `AppHeader`** (`src/components/layout/AppHeader.tsx`): no autocomplete, no results. It routes to `/properties?q=<term>`, but `/properties` reads only `?city=`/`?search=` (page.tsx:114) and ignores `?q=`, so header searches are silently lost. This header renders on every `(app)`-group page: dashboard, listings, analytics, avm, `/properties/[id]`, `/properties/compare`.

User-reported symptom: the dashboard search "isn't working like the properties page — no autocomplete and no result."

Goal: the same search bar and autocomplete behavior everywhere.

## Why it isn't a drop-in

`LocationSearch` mutates `commandCenterStore` directly: a city pick calls `setLocation` (the terminal's map/list react live); an address/MLS pick calls `setSelectedProperty` (opens the in-page listing terminal). That only *does* anything on `/properties`, which renders the map/ledger/terminal that read the store. On the dashboard or AVM page nothing listens, so off-terminal a selection must **navigate** instead of mutating in-place state.

## Design: one component, two modes

Add an optional `mode` prop to `LocationSearch`. The autocomplete UI — debounced `suggestSearch`, dropdown, icons, keyboard nav, live counts — is **identical in both modes**. Only the commit actions branch.

### `mode="inplace"` (default)
Exactly today's behavior. Used by `TopCommandBar` on `/properties`. No functional change.
- city/neighbourhood → `setLocation(label)`
- address/MLS (with `listing`) → `setSelectedProperty(listing)`
- free-typed Enter → `setLocation(text)`

### `mode="navigate"`
Used by `AppHeader` everywhere else. Selecting a result pushes a route via `next/navigation`'s `useRouter`:
- city/neighbourhood → `router.push('/properties?city=' + encodeURIComponent(label))`
- address/MLS (with `listing`) → `router.push('/properties/' + listing.id)` (the `(app)/properties/[id]` detail page; `listing.id` is the ListingKey)
- free-typed Enter (no suggestion) → `router.push('/properties?city=' + encodeURIComponent(text))`

After a navigate-mode commit, clear the input and close the dropdown (no store writes that matter).

### Store safety
In `navigate` mode the component still *reads* `commandCenterStore` selectors (`location`, `totalCount`) — harmless: it's a self-standing Zustand singleton safe to read on any page with no provider (same pattern `WatchlistAlertsBell` already uses in `AppHeader`). `setSelectedProperty`/`setLocation` are simply not called in navigate mode.

`totalCount` reads its initial value (0) off-terminal, so the placeholder falls back to the existing `"Search city, neighbourhood, address, or MLS#…"` branch. Acceptable — no live-total fetch in the header (YAGNI).

## Changes

1. **`LocationSearch.tsx`** — add `mode?: "inplace" | "navigate"` (default `"inplace"`). Add `useRouter`. Branch `commitLocation`, `select`, and the free-typed `onSubmit` path on `mode`. The `inplace` branch is byte-for-byte today's behavior.
2. **`AppHeader.tsx`** — replace the plain `<form>/<input>` block (lines ~52–62) with `<LocationSearch mode="navigate" className="max-w-xl flex-1" />`. Drop the local `q` state, `submit` handler, and the now-unused `Search`/`useRouter`/`useState` imports if nothing else needs them. Keep the `search` prop gate and the `!search` spacer.
3. **`/properties` param handling** — already seeds from `?city=`/`?search=` (page.tsx:114). Confirm it still works; the dead `?q=` path simply disappears (no reader to remove). No change expected, verify only.
4. **Delete `src/components/SearchDropdown.tsx`** — 680-line orphan, imported nowhere (only self-reference + a doc-comment mention in `LocationSearch`). Remove the stale "(orphaned SearchDropdown)" note from the `LocationSearch` doc comment.

## Out of scope (YAGNI)

- Live total-count fetch in the header.
- Recently-viewed / saved-homes sections (the dead `SearchDropdown` had these; not requested).
- Restyling beyond making the bar fit the header width. It's already dark-terminal styled, matching `AppHeader`.
- Any change to the marketing/landing header variant beyond what the shared component already gives.

## Testing / verification

- Dashboard, AVM, analytics, listings, `/properties/[id]`, compare: typing ≥2 chars shows the Typesense dropdown with counts; arrow keys + Enter work.
- Navigate mode: city pick → lands on `/properties` with that location applied (map/ledger filtered); address/MLS pick → lands on `/properties/<ListingKey>`.
- `/properties` terminal: `TopCommandBar` search unchanged — city pick filters in place, address/MLS opens the in-page listing terminal (no navigation).
- `npm run build` / `lint` clean; no dangling imports after the `SearchDropdown` delete.
