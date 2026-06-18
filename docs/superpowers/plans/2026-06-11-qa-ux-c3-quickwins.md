# QA Plan C3 — UX Quick Wins + Viewing Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dead "Schedule Viewing" CTA a real lead-capture flow (M-17 — user decision: ACTIVE, not removed), fix the bento-grid dead space (M-16), and land the small UX/correctness lows: LOW-12, 13, 14, 16, 17, 18, 19, 21, 22, 24.

**Architecture for M-17 (the only feature here):** a viewing request is a LEAD for the owner (licensed realtor). Flow: button opens an inline form (name, email, phone, preferred time, note) → POST `/api/viewing-requests` (validated + rate-limited via the existing `@/lib/rateLimit`) → insert into a new `viewing_requests` table (service-role; no auth required — anonymous visitors are exactly the leads we want) → fire-and-forget email notification through the same Resend setup `scripts/worker/alerts.ts` uses (`RESEND_API_KEY`, `ALERTS_FROM_EMAIL`) to `VIEWING_REQUESTS_EMAIL` (env; default the alerts sender's inbox). Email failure must NOT fail the request — the row is the source of truth.

**Deferred from C3 (rationale in PR):** LOW-23 (verifier: negligible at ≤100 listings), LOW-26 (subtle race, low payoff), LOW-8/9 (fragile-but-working; comments only if touched), M-19 (perf project — tracked separately).

**Branch:** `feat/qa-ux-quickwins` cut from `origin/main`. Windows: `npm.cmd`/`npx.cmd`. Vitest is node-env: API/lib logic gets TDD; JSX changes verified by typecheck/build. Never stage audit/, docs/, .claude/, scripts/admin/_*.ts, _migration031.sql, .env.

---

### Task 0: Branch + baseline

- [ ] Clean tracked state → `git checkout -b feat/qa-ux-quickwins origin/main` → clear `.next` if needed → typecheck + vitest baseline recorded.

### Task 1: M-17 — viewing requests (migration + API + form)

**Files:** Create `supabase/migrations/036_viewing_requests.sql`, `src/app/api/viewing-requests/route.ts`, `src/app/api/viewing-requests/route.test.ts`, `src/components/Property/ScheduleViewingForm.tsx` · Modify `src/app/(app)/properties/[id]/ListingActions.tsx`

- [ ] **Step 1: Migration — create `supabase/migrations/036_viewing_requests.sql`:**

```sql
-- Migration 036: viewing_requests — lead capture from the listing page's
-- "Schedule Viewing" CTA (was a dead button; audit MEDIUM-17). Written ONLY via
-- the service-role API route (validated + rate-limited); no anon RLS access.
CREATE TABLE IF NOT EXISTS public.viewing_requests (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  listing_key     TEXT NOT NULL,
  address         TEXT,
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT,
  preferred_time  TEXT,
  message         TEXT,
  status          TEXT NOT NULL DEFAULT 'new',  -- new | contacted | done
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.viewing_requests ENABLE ROW LEVEL SECURITY;
-- No policies: anon/authenticated get nothing; the service role bypasses RLS.

COMMENT ON TABLE public.viewing_requests IS
  'Listing-page viewing/lead requests. Inserted by /api/viewing-requests (service role). Instant DDL — safe for the Supabase SQL editor.';
```

- [ ] **Step 2 (TDD): create `src/app/api/viewing-requests/route.test.ts`.** Mock `@/lib/supabase/client` (`getServiceRoleClient` → `{ from: vi.fn(() => ({ insert: insertSpy })) }` with `insertSpy = vi.fn().mockResolvedValue({ error: null })`) and mock `resend` (`vi.mock('resend', () => ({ Resend: vi.fn(() => ({ emails: { send: vi.fn().mockResolvedValue({}) } })) }))`). Tests: (1) valid body (listingKey `W12632618`, name, valid email) → 200 `{ success: true }` and insertSpy called once with a row containing `listing_key`, `name`, `email`; (2) listingKey failing `/^[A-Z]\d{6,9}$/` → 400, no insert; (3) missing/invalid email (use the STRICT regex below) → 400, no insert; (4) message over 2000 chars → 400; (5) Resend throwing → STILL 200 (email is best-effort; row is the lead). Run — all fail (route doesn't exist).
- [ ] **Step 3: create `src/app/api/viewing-requests/route.ts`:**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Lead capture from the listing page (audit MEDIUM-17). Anonymous on purpose —
// visitors requesting viewings ARE the product's leads. Abuse contained by
// validation + per-IP rate cap; rows land in viewing_requests (RLS: service-only).
const limiter = makeRateLimiter({ windowMs: 60_000, max: 3 });
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;
// Pragmatic strict-enough email shape: one @, a dot in the domain, ≥2-char TLD.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX = { name: 120, email: 254, phone: 40, preferredTime: 200, message: 2000, address: 300 };

function bad(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json();
    const listingKey = typeof body?.listingKey === "string" ? body.listingKey : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const preferredTime = typeof body?.preferredTime === "string" ? body.preferredTime.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const address = typeof body?.address === "string" ? body.address.trim() : "";

    if (!LISTING_KEY_RE.test(listingKey)) return bad("Invalid listing key");
    if (!name || name.length > MAX.name) return bad("Name is required");
    if (!EMAIL_RE.test(email) || email.length > MAX.email) return bad("Valid email is required");
    if (phone.length > MAX.phone || preferredTime.length > MAX.preferredTime) return bad("Field too long");
    if (message.length > MAX.message || address.length > MAX.address) return bad("Field too long");

    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("viewing_requests").insert({
      listing_key: listingKey,
      address: address || null,
      name,
      email,
      phone: phone || null,
      preferred_time: preferredTime || null,
      message: message || null,
    });
    if (error) {
      console.error("[viewing-requests] insert failed:", error.message);
      return NextResponse.json({ success: false, error: "Could not save request" }, { status: 500 });
    }

    // Best-effort owner notification — the DB row is the lead; email failure must not 500.
    try {
      if (process.env.RESEND_API_KEY) {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        const to = process.env.VIEWING_REQUESTS_EMAIL || process.env.ALERTS_FROM_EMAIL || "support@pureproperty.ca";
        const from = process.env.ALERTS_FROM_EMAIL || "support@pureproperty.ca";
        await resend.emails.send({
          from,
          to,
          subject: `Viewing request — ${address || listingKey}`,
          text: [
            `Listing: ${listingKey}${address ? ` — ${address}` : ""}`,
            `Name: ${name}`,
            `Email: ${email}`,
            phone && `Phone: ${phone}`,
            preferredTime && `Preferred time: ${preferredTime}`,
            message && `Message: ${message}`,
          ].filter(Boolean).join("\n"),
        });
      }
    } catch (mailErr) {
      console.error("[viewing-requests] notification email failed (lead saved):", mailErr);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[viewing-requests]", e);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
```

(If the test's `resend` mock fights the dynamic `import("resend")`, switch the route to a top-level `import { Resend } from "resend"` — alerts.ts already proves it's import-safe — and keep the env guard.)

- [ ] **Step 4: create `src/components/Property/ScheduleViewingForm.tsx`** — a client component: collapsed state renders the existing emerald button (same classes/icon as today's dead button); clicking expands an inline card with inputs (name*, email*, phone, preferred time, message) styled like the surrounding right-rail (slate-800 borders, text-sm, rounded-md); submit → `fetch("/api/viewing-requests", { method: "POST", ... })` with `{ listingKey, address, ...fields }`; pending/disabled state; on success swap the form for a confirmation line ("Request sent — you'll hear back shortly."); on failure show the API's error text inline. Client-side required-check on name/email (same EMAIL_RE inlined) before posting.
- [ ] **Step 5: wire it.** In `ListingActions.tsx`, replace the dead button (lines 40-46) with `<ScheduleViewingForm listingKey={id} address={address} />` (import it). Props already available.
- [ ] **Step 6 (LOW-18 rides along):** `src/app/apply/page.tsx:179` — replace the permissive `/\S+@\S+\.\S+/` with the same strict shape `/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/` (import EMAIL_RE from the new route module if clean, else duplicate with a comment pointing at it).
- [ ] **Step 7: apply migration 036 to prod** (instant DDL): paste into the Supabase SQL editor OR `npx.cmd tsx`-driven pooler script per CLAUDE.md §12 — coordinator/user applies; the implementer just reports it pending.
- [ ] **Step 8:** route tests green (5/5), full suite, typecheck, build. Commit: `feat(leads): Schedule Viewing is live — viewing_requests table + validated/rate-limited API + inline form + Resend notify` (audit MEDIUM-17, LOW-18 + Co-Authored-By).

### Task 2: M-16 — bento grid fills its left column

**Files:** `src/components/Property/ImageBentoGrid.tsx`

Hero is `row-span-2` inside `grid-rows-4`, so left-column rows 3-4 are permanently empty (~210px dead space); the confused comment block (104-121) documents the bug instead of fixing it.

- [ ] **Step 1:** Read the file. Change the container to `grid-rows-2` and keep hero `row-span-2` (left column = full height) with thumbnails flowing 2-up in the right column (2 rows × 1 col of pairs — i.e. 4 thumbs + "+N more" overlay on the 4th, matching current overlay behavior). Preserve: Next/Image usage, the `sizes` attributes (Task 3 adjusts the hero's), the lightbox/overlay handlers, TRREB-safe alt text. Delete the obsolete confusion comment; replace with one line describing the 2-row layout.
- [ ] **Step 2:** typecheck + build; manual viewport check in the dev server (coordinator does final visual check) — implementer confirms via build + JSX reasoning, flags DONE_WITH_CONCERNS if the thumb count logic changes.
- [ ] **Step 3:** Commit: `fix(listing): bento grid 2-row layout — hero fills the left column, no dead space` (audit MEDIUM-16 + Co-Authored-By).

### Task 3: Small fixes batch — LOW-12, 13, 14, 16, 17, 19, 21, 22, 24

**Files:** as listed per item. ONE commit.

- [ ] **LOW-12** `src/components/CommandCenter/MapTimeline.tsx:31`: the auto-player wraps `domCenter` to 0 (an empty unfiltered frame) — wrap to the first valid window start instead (read the component for the min constant; if none, define `const MIN_DOM = 10` consistent with the +10 step).
- [ ] **LOW-13** `src/components/Map/AlphaMap.tsx` (~651): add `role="application"` and a descriptive `aria-label` ("Interactive listings map…") to the outer map container div.
- [ ] **LOW-14** `src/components/CommandCenter/FilterChip.tsx` (~38-46): the X clear button gets `aria-label={\`Clear ${label} filter\`}` (use the chip's existing label prop name).
- [ ] **LOW-16** `src/components/CommandCenter/ListingTerminal.tsx` (~63-86): `highlightNLPFlags` is a stub that returns its input and is never rendered — DELETE it (grep callers first; zero expected).
- [ ] **LOW-17** `src/lib/watchlist/useWatchlist.ts:121`: the SIGNED_OUT branch sets `{ items: toMap(readLocal()), signedIn: false }` — add `loaded: true` for state-machine completeness (matches the other branches).
- [ ] **LOW-19** `src/app/(app)/dashboard/DashboardClient.tsx` (~50,82): instead of `return null` before hydration, return a minimal skeleton (`<div className="min-h-screen bg-slate-950" aria-busy="true" />`) so authenticated visits don't flash pure blank.
- [ ] **LOW-21** `src/components/CommandCenter/Cards/HoldingBurnCard.tsx:47`: add `maxHoldingCost` to the useMemo dependency array (it's read at :34).
- [ ] **LOW-22** render-storm pair: `ListingTerminal.tsx:116` and `MapView.tsx:202` — read each effect; where the setState is derivable from props/state, lift it out of the effect (compute during render or `useMemo`); where it genuinely syncs an external system, leave it and add the eslint-disable with justification. Implementer judgment; report what was done for each. If a safe lift isn't evident, leave + comment rather than risk behavior change (DONE_WITH_CONCERNS).
- [ ] **LOW-24** `src/components/Property/ImageBentoGrid.tsx:61` (post-Task-2 line may shift): hero `sizes` `(max-width: 768px) 50vw, 25vw` → `(max-width: 768px) 100vw, 35vw` (hero is full-width on mobile in the 2-row layout — verify against the Task 2 layout and set accordingly).
- [ ] **Verify:** typecheck + full suite + lint (the LOW-21/22 items should REDUCE warnings — confirm count drops) + build.
- [ ] **Commit:** `fix(ux): quick wins — a11y labels, timeline wrap, watchlist sign-out state, dashboard skeleton, hook hygiene, image sizes` (audit LOW-12/13/14/16/17/19/21/22/24 + Co-Authored-By).

### Task 4: Final gate + PR

- [ ] typecheck · lint (0 errors; warnings ≤ baseline−2) · full suite · build. Runtime smoke: listing page → Schedule Viewing expands, submits against local API (200, row visible via a quick service-role select — skip if Supabase unhealthy), 4th rapid submit → 429.
- [ ] Push `feat/qa-ux-quickwins`, PR titled `feat: Schedule Viewing lead capture + QA-audit UX quick wins`; body: finding→fix table, migration 036 status (applied/pending — MUST be applied before merge), env note (`VIEWING_REQUESTS_EMAIL` optional, defaults to the alerts inbox), deferred list (LOW-23/26/8/9, M-19) with rationale. Standard attribution.
