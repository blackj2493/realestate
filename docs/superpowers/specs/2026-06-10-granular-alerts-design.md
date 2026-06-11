# Granular Listing Alerts — Design

**Date:** 2026-06-10 · **Branch:** `feat/granular-alerts` (cut from main) · **Approved by user:** yes (both phases, sold-price tease, default-ON bubbles with anti-irritation model, compare-at-read architecture)

## Goal

Close the alerts gap vs HouseSigma: today the nightly worker (`scripts/worker/alerts.ts`) emails only
watchlist **price drops**. Add:

- **Phase A — status-change alerts** on watchlisted properties: Sold (tease — no price in email),
  Sold Conditional, Terminated/Expired/Suspended ("off market"), Back On Market (relist).
- **Phase B — new-listing alerts** for saved bubbles: "N new listings appeared inside your saved
  area since yesterday", matching the bubble's polygon **and** its stored filters.

Architecture: **compare-at-read** (Option A). Baselines live on the `watchlist`/`bubbles` rows;
each nightly run compares baseline vs the current Typesense index, emails the delta in ONE digest
per user, then advances the baseline. No ingester changes, no event ledger.

## Anti-irritation model (default ON for bubbles)

1. **One email per user per day, ever** — single combined digest (price drops + status changes +
   new listings). No-news days send nothing.
2. **Watermark from enablement** — `bubbles.notify_since` is NULL until the worker first sees the
   bubble; that run sets it to the run timestamp and emails nothing. No backlog dumps.
3. **Volume cap** — max 6 listing rows per bubble in the email (newest first) + "+N more" link.
   A bubble matching >20 new listings in one day collapses to a one-line count (area drawn too big).
4. **De-dup** — a listing inside two of a user's bubbles appears once (first bubble wins).
5. **Trivial mute** — per-bubble bell toggle (default ON) on the dashboard bubble card; "Manage
   alerts" link in every email footer.

## Data model

- **Phase A: no migration.** `watchlist.last_known_status` (015) is the baseline; the worker
  already refreshes it nightly — it just never compared it.
- **Phase B: migration 034** (next free slot; 030–033 are taken):
  ```sql
  ALTER TABLE public.bubbles
    ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS notify_since   TIMESTAMPTZ;  -- NULL = not yet baselined
  ```
  Instant DDL — safe for the Supabase SQL editor or a pooler script (memory:
  supabase-migration-connectivity).

## Detection logic (all deterministic, §4)

### Phase A — per watchlist row

Current state comes from the active `properties` Typesense collection (`Status` field — populated
as `raw.Status || raw.MlsStatus || raw.StandardStatus`; terminal spellings per
`staleSearchDocs.ts`: sold/closed/leased/terminated/expired/suspended).

1. **Doc present, status differs** from `last_known_status` → classify via a hardcoded transition
   map. Alertable in-index transitions: → Sold Conditional; terminal-baseline → active-status
   (Back On Market). Non-alertable churn (New → Price Change, Extension…) only refreshes the baseline.
2. **Doc vanished** (PR #19 deletes sold/terminal docs from the active index) and baseline is not
   already terminal → resolve why, in order:
   a. `sold_listings` collection lookup by id (= listing_key), `DealType='sold'` → **SOLD** (tease).
   b. Supabase `listings` row status is terminal → **Off market (terminated/expired/suspended)**.
   c. Otherwise → **No longer active** (generic).
   The resolved status is written to `last_known_status` so it never re-fires; a later reappearance
   in the active index fires **Back On Market** via rule 1.

Price-drop behavior is unchanged.

### Phase B — per alert-enabled bubble

One Typesense `properties` search per bubble:
- Area: `location:(lat1, lng1, lat2, lng2, …)` for draw/commute polygons; school bubbles use
  `NearbySchools:=\`key\`` (same clauses as `src/lib/bubbles/stats.ts` `buildAreaClause` — reuse it).
- Freshness: `EntryTimestamp:>{notify_since ms}` (int64 unix ms, from OriginalEntryTimestamp).
- Bubble filters: map the stored `filters` JSONB (commandCenterStore slice: minPrice/maxPrice/
  minBedrooms/…) to Typesense clauses — reuse/extend the mapping already used by bubble stats.
- `per_page` ≤ 100 (§6.3b), sorted `EntryTimestamp:desc`.

Watermark semantics: read rows where `alerts_enabled`; if `notify_since IS NULL`, set it to run
start and skip matching. After a successful run (regardless of matches), advance `notify_since`
to the run start time. De-dup across bubbles per user before rendering.

## Email

`renderDigest` grows into a sectioned digest (pure, in `src/lib/alerts/digest.ts`):
- Subject summarizes: e.g. `1 sold · 2 price drops · 5 new listings`.
- Sections: Status changes / Price drops / New in your areas (per-bubble subsections, cap + overflow).
- **Sold rows are a tease**: status + address + "Sign in to see the closing price" link. No VOW
  price ever appears in email.
- **Compliance fix bundled:** every listing row (including existing price-drop rows) now shows the
  listing brokerage (`ListOfficeName`) in the same font size as other details (§4 mandatory
  brokerage display). New-listing rows show address, list price, beds/baths, brokerage.
- Footer: "Manage alerts" → `/dashboard`; existing PROPTX attribution + reliability line stays.

## Worker structure

Pure logic moves to `src/lib/alerts/` (vitest covers `src/**` and `scripts/**`, but src keeps it
consistent with the rest of the test suite):

- `transitions.ts` — `classifyStatusChange(prevStatus, current, soldHit, listingsStatus)` →
  `StatusAlert | null` (+ normalization of status spellings).
- `bubbleDigest.ts` — de-dup, per-bubble cap/collapse, overflow counts (pure given match arrays).
- `digest.ts` — the sectioned renderer (subject/html/text) for the combined payload.

`scripts/worker/alerts.ts` stays the thin I/O shell: read rows → fetch current states (one
Typesense lookup per distinct listing; one search per enabled bubble) → classify → render → send →
**advance baselines only for users whose email send succeeded** (today a Resend failure still
advances `last_alerted_price`, eating the alert — fixed). Per-row/per-bubble try/catch: a bad
bubble or listing never kills the run. The workflow step stays `continue-on-error` and no-ops
without `RESEND_API_KEY`.

## UI (Phase B only)

- Bell toggle on each bubble card in `BubbleMarketSection` (next to the existing
  rename/delete/open menu — `BubbleSectionMenu`), default ON, optimistic update.
- `PATCH /api/bubbles/[id]` accepts `alerts_enabled: boolean` (extend the existing PATCH; RLS
  already owner-scopes it). GET responses include the two new fields.

## Error handling

- Missing `RESEND_API_KEY` → warn + exit 0 (unchanged).
- Typesense/Supabase lookup failures per item → log, skip item, continue.
- Send failure → log; do NOT advance that user's baselines (watchlist rows and bubble watermarks
  for their bubbles) so the next run retries.
- Bubble watermark only advances when the bubble's matching query succeeded.

## Testing

Vitest (node-env, pure logic only — memory: vitest-node-env-no-jsdom):
- `transitions.test.ts` — every alertable transition, terminal-baseline no-refire, relist
  detection, unknown-status fallbacks, spelling normalization (trailing spaces, case).
- `bubbleDigest.test.ts` — cap at 6, collapse at >20, cross-bubble de-dup, watermark-null behavior
  contract (returns "baseline only" marker).
- `digest.test.ts` — subject composition, sold tease contains no price, brokerage line present,
  section omission when empty, overflow line.
- Existing behavior: price-drop tests (renderDigest is currently exported; keep API compatible or
  update call sites).

## Out of scope (explicitly)

- Realtime/intraday alerts (data is daily; no realtime claims — §4 freshness).
- In-app activity feed / event ledger (Option B — future).
- Per-user global alert preferences page (the per-bubble toggle + watch/unwatch is the v1 surface).
- Sold prices in email (compliance posture; tease only).
