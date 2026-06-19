# QA Plan C2 — Security & Ops Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the surviving security/compliance/ops mediums+lows: M-2 (brokerage de-emphasis, TRREB §6.3(c)), M-22/LOW-28 (/api/health recon leak), LOW-29 (underwriting user_id), LOW-30 (apply rate limit), LOW-31 (share rate limit), M-4/LOW-4 (legacy deltaSync + RESO token), M-5 + INFO-1/2 (.env hygiene), LOW-1 (perPage clamp), LOW-5/27 (401 body shape), LOW-25 (alerts pagination).

**Explicitly deferred (rationale in PR body):** M-21 (getListingDetail service-role swap needs an RLS audit of 4+ tables first — wrong to YOLO on the revenue page), LOW-3 (share page projects ~10 safe fields server-side; posture only), LOW-32 (Supabase URL fallback is browser-public anyway; anon-key fallback is already `''`).

**Branch:** `fix/qa-mediums-security` cut from `origin/main`. Windows: `npm.cmd`/`npx.cmd`. Never stage audit/, docs/, .claude/, scripts/admin/_*.ts, _migration031.sql, **.env** (Task 6 edits .env but it is gitignored — verify with `git check-ignore .env` before and never commit it).

---

### Task 0: Branch + baseline

- [ ] `git status --short` clean of tracked modifications · `git fetch origin` · `git checkout -b fix/qa-mediums-security origin/main` · clear `.next` if typecheck complains · typecheck + full vitest baseline recorded.

### Task 1: M-2 — brokerage at visual parity in PlaylistRow + ActivityRow

**Files:** `src/components/dashboard/PlaylistRow.tsx` (~35-39), `src/components/dashboard/ActivityRow.tsx` (~70-72)

Both render brokerage at `text-[10px] text-slate-500` while the address sits at `text-xs text-slate-200` — exactly the visual de-emphasis TRREB §6.3(c) prohibits. Both files carry comments FALSELY claiming compliance.

- [ ] **Step 1:** In each file, change the brokerage span's classes from `text-[10px]`→`text-xs` and `text-slate-500`→`text-slate-400` (parity with the spec-chip row). Rewrite the lying comment to state the actual classes used and why (same size as sibling listing details per §6.3(c)).
- [ ] **Step 2:** Typecheck + suite; eyeball the two diffs (class + comment only).
- [ ] **Step 3:** Commit: `fix(compliance): brokerage rendered at parity with listing details in dashboard rows (TRREB 6.3c)` (audit MEDIUM-2 + Co-Authored-By).

### Task 2: M-22 / LOW-28 — /api/health stops leaking recon data

**Files:** `src/app/api/health/route.ts`

Currently returns the Supabase project URL, AMPRE URL, and presence booleans for SUPABASE_SERVICE_ROLE_KEY / TYPESENSE_ADMIN_API_KEY / RESO_BEARER_TOKEN to any caller. A health check needs none of that.

- [ ] **Step 1:** Replace the whole handler body with:

```ts
import { NextResponse } from "next/server";

// Minimal liveness probe. Env/infra details were removed 2026-06-11 — they gave
// unauthenticated callers a free recon map (audit MEDIUM-22/LOW-28). If an ops
// dashboard ever needs config introspection, gate it behind a shared secret.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2:** Grep src/ + scripts/ + .github/ for `api/health` consumers that read the removed fields (expect none — report any hit and adapt it). Typecheck + suite.
- [ ] **Step 3:** Commit: `fix(security): /api/health is a bare liveness probe — env recon fields removed` (audit MEDIUM-22/LOW-28 + Co-Authored-By).

### Task 3: LOW-29 + LOW-30 + LOW-31 — route hardening (user_id filter + rate limits)

**Files:** `src/app/api/underwriting/route.ts`, `src/app/api/onboarding/apply/route.ts`, `src/app/api/share/route.ts`

- [ ] **Step 1 (LOW-29):** underwriting GET (~:31-37): add `.eq('user_id', user.id)` to the select chain (the DELETE handler already filters — make GET symmetric; RLS covers it today, this is defense-in-depth). If a colocated test exists, extend; else skip test (1-line, RLS-redundant).
- [ ] **Step 2 (LOW-30):** apply route: module-level `const limiter = makeRateLimiter({ windowMs: 60_000, max: 5 });` from `@/lib/rateLimit` + the standard 429 gate as the first statement in POST's try (copy the exact pattern from `src/app/api/geocode/route.ts`, including `Retry-After`). 5/min is generous for a human filling a form, hostile to table-flooding.
- [ ] **Step 3 (LOW-31):** share route: same gate at `{ windowMs: 60_000, max: 10 }`. Do NOT add an auth requirement — anonymous share links are product-intended (anonymous-first). Add a comment saying exactly that so the next auditor doesn't re-flag it.
- [ ] **Step 4:** Suite + typecheck. Commit: `fix(security): user_id filter on underwriting GET; per-IP rate caps on apply (5/min) and share (10/min)` (audit LOW-29/30/31 + Co-Authored-By).

### Task 4: LOW-1 + LOW-5/27 — searchListings clamp + honest 401 bodies

**Files:** `src/lib/typesense/client.ts` (~:310), `src/app/api/watchlist/route.ts` (~:30), `src/app/api/bubbles/route.ts` (~:97), `src/app/api/underwriting/route.ts` (~:27)

- [ ] **Step 1 (LOW-1):** in `searchListings`, clamp the effective perPage inside the function: `const perPage = Math.min(100, Math.max(1, filters.perPage ?? 20));` (or equivalent at the existing default site) with comment `// TRREB §4: never let any caller exceed the 100-listing display cap (audit LOW-1).` Check call sites still typecheck.
- [ ] **Step 2 (LOW-5/27):** each 401 response keeps its empty-collection field (client stores destructure it after `res.ok` checks — keep back-compat) but gains an explicit error: e.g. `{ items: [], error: "unauthenticated" }`, `{ scenarios: [], error: "unauthenticated" }`. Grep each route's CLIENT consumers (`useWatchlist.ts`, bubble store, sandbox) to confirm none treat the presence of `error` as fatal on the happy path (they shouldn't — they check `res.ok` first; report findings).
- [ ] **Step 3:** Suite + typecheck. Commit: `fix(api): clamp searchListings perPage to TRREB cap; 401 bodies carry an explicit error field` (audit LOW-1/LOW-5/LOW-27 + Co-Authored-By).

### Task 5: LOW-25 — alerts.ts pages its watchlist read

**Files:** `scripts/worker/alerts.ts` (~:135-137)

The nightly digest reads ALL watchlist rows in one unbounded select — silently capped at 1,000 by PostgREST; rows past that never get alerts.

- [ ] **Step 1:** Replace the single select with the standard PAGE=1000 `.range()` loop (stable `.order("id")` — check the table's PK column name in migration 015 and use it), accumulating all rows. Same pattern as loadCohortTree.
- [ ] **Step 2:** If alerts has a test file, extend with a paging test (stub pattern); if not (it's a worker script), verify by typecheck + careful diff and note it.
- [ ] **Step 3:** Commit: `fix(alerts): page the watchlist read — users past PostgREST's 1k cap were silently skipped` (audit LOW-25 + Co-Authored-By).

### Task 6: M-4 / LOW-4 / M-5 / INFO-1+2 — legacy sync + .env hygiene

**Files:** `scripts/worker/sync.ts` (legacy deltaSync + main CLI), `.env` (NOT committed)

- [ ] **Step 1 (code):** In sync.ts, locate the legacy `deltaSync` function (~:473-486, hard-requires `RESO_BEARER_TOKEN`) and the `main()` CLI entry (~:764) that is its only caller. Grep both names across the repo (src/, scripts/, .github/, package.json scripts) — with zero external callers, DELETE `deltaSync` and the `main()` branch that invokes it (if `main` dispatches other subcommands that ARE used — check package.json and .github workflows for `sync.ts delta` vs other args — delete only the dead branch; report what main still does). The processBatch/getAdminClient exports MUST be untouched (live ETL path).
- [ ] **Step 2 (.env — direct edits, never committed; `git check-ignore .env` must print `.env` first):**
  - Delete the `RESO_BEARER_TOKEN=` line (legacy, documented outage-causer; its boolean was the last code reference and died with /api/health Task 2 + deltaSync Step 1).
  - Delete .env line 40, the malformed duplicate `DIRECT_DB_URL=:"postgresql://…"` (the colon-before-quote typo that overwrites line 39; audit MEDIUM-5). Leave line 39 and DATABASE_URL alone.
  - Delete the `GEMINI_API_KEY=` line (zero code references; CLAUDE.md §4 forbids LLM processing of feed data, so a dormant LLM key is a standing liability — audit INFO-1/2). NOTE for the report: the user should also revoke this key in Google AI Studio since it appeared in an audit transcript.
- [ ] **Step 3:** Typecheck + full suite + `npx.cmd tsx scripts/worker/sync.ts --help 2>&1 | Select-Object -First 5` style sanity if main() survives (do not run an actual sync). Confirm `Select-String -Path .env -Pattern "RESO_BEARER_TOKEN|GEMINI_API_KEY" -Quiet` → False, and exactly ONE `DIRECT_DB_URL` line remains.
- [ ] **Step 4:** Commit (code only — sync.ts): `chore(etl): delete legacy deltaSync CLI path (RESO_BEARER_TOKEN ghost)` (audit MEDIUM-4/LOW-4 + Co-Authored-By). The .env edits are uncommitted by nature; list them in the report + PR body.

### Task 7: Final gate + PR

- [ ] typecheck · lint · full suite · build. Smoke: `/api/health` returns exactly `{"status":"ok"}`; POST 6 rapid `/api/onboarding/apply` requests → 6th is 429.
- [ ] Push `fix/qa-mediums-security`, PR titled `fix: QA-audit security & ops mediums/lows (health leak, rate caps, legacy sync ghost, env hygiene)`; body: finding→fix table, the deferred list (M-21/LOW-3/LOW-32) WITH rationale, the .env edits performed (uncommitted), and the user action: revoke the old GEMINI key in Google AI Studio. Standard attribution.
