# True DOM Campaign-History — Phase 2c Implementation Plan (nightly rewire + warm-pass/reindex)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the corrected True DOM appear EVERYWHERE (terminal, map, lists — not just the listing page): rewire the nightly `sync.ts` to refresh the campaign ledger + Typesense `TrueDom` per active listing, and run a one-time, bounded, paced warm-pass that corrects the existing active inventory.

**Architecture:** `sync.ts processBatch` stops calling the broken `fetchHistoricalListings`/`fetchSoldCampaigns`/`calculateTrueDOM` stitch and instead calls the Phase-2b `refreshCampaignHistoryForListing` per active listing (best-effort, 24h-TTL cached, subject-always-merged, never-regress), writing `true_dom`/`total_price_drop` to `full_payload` + the Typesense `TrueDom` field. A standalone `warmCampaignHistory.ts` admin script corrects the *existing* actives — **bounded to likely-relists** (SQL: address has prior campaigns in our data), paced for the TRREB feed + Disk-IO budget, dry-run by default, resumable — and reindexes their Typesense `TrueDom`.

**Tech Stack:** TypeScript, the Phase-2b `campaignHistory` module, Supabase (`pg` session pooler for the warm-pass enumeration + JS client for ledger I/O), Typesense admin client (`getAdminClient`), the VOW feed via `fetchCampaignsByAddress`.

**Spec:** `…/2026-06-08-true-dom-campaign-history-design.md` §8 (nightly write path) + §13 (warm-pass/reindex). **Prior:** Phases 1/2a/2b/3 shipped the ledger, `refreshCampaignHistoryForListing`, the read path, and the UI on branch `feat/true-dom-campaign-history`.

**Conventions:** `npm run test` / `typecheck` / `lint`; commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `feat/true-dom-campaign-history`.

**CRITICAL compliance guardrails (CLAUDE.md §4 — "Failure to comply risks API revocation"):**
- The warm-pass MUST be paced (inter-call delay), bounded (likely-relists only, with a `--limit`), dry-run by default, and resumable (keyset cursor) — never an unthrottled 100k-call blast.
- Deterministic only (no LLM). VOW-derived `TrueDom` is already gated at read time (Phases 2b/3); the Typesense `TrueDom` field is a number, not raw VOW display.

---

## File structure (Phase 2c)

- Modify `scripts/worker/sync.ts` — replace the Phase-4 stitch block in `processBatch` with per-listing `refreshCampaignHistoryForListing`; retire `fetchHistoricalListings`/`fetchSoldCampaigns` (+ their now-unused imports). The Typesense doc still carries `TrueDom` (now from the ledger).
- Create `scripts/admin/warmCampaignHistory.ts` — bounded/paced/dry-run warm-pass + Typesense `TrueDom` reindex.

---

## Task 1: Rewire `sync.ts processBatch` to the ledger path

**Files:**
- Modify: `scripts/worker/sync.ts`

This is the highest-risk edit in the feature (live nightly sync, which has a silent-failure history — see memory). Safety: `refreshCampaignHistoryForListing` never throws, is 24h-TTL cached, subject-always-merged (so a fresh active never yields `true_dom = 0`), and never-regresses a richer prior. There are no unit tests for `processBatch` (it does live Supabase+feed+Typesense I/O); verified by typecheck + the existing test suite staying green + a careful diff review + a `--dry-run`/limited manual sync.

- [ ] **Step 1: Read the current `processBatch` Phase-4 block**

Read `scripts/worker/sync.ts` lines ~350-490 (the `processBatch` function: the hash generation, `fetchHistoricalListings`/`fetchSoldCampaigns` calls, the `calculateTrueDOM` loop writing `true_dom`/`total_price_drop` to `full_payload`, and the Typesense doc build with `TrueDom`). Note the exact variable names (`transformed`, `supabaseClient`, `t.supabasePayload.full_payload`, `temporalMetrics`, etc.).

- [ ] **Step 2: Add imports (top of `sync.ts`)**

```ts
import { refreshCampaignHistoryForListing } from './../../src/lib/campaignHistory/store';
import { normalizeCampaign, type RawVowCampaign } from './../../src/lib/campaignHistory/normalize';
```
(Use the import path style already used in `sync.ts` for `src/lib` imports — match the existing `generatePropertyHash` import path exactly; if `sync.ts` imports from `@/lib/...`, use `@/lib/campaignHistory/store` etc. instead. Report which style the file uses.)

- [ ] **Step 3: Replace the stitch block**

REPLACE the Phase-4 section — the `fetchHistoricalListings(...)` + `fetchSoldCampaigns(...)` calls and the `calculateTrueDOM` per-listing loop that populates `temporalMetrics` — with a per-listing ledger refresh. Keep the SAME `temporalMetrics` map shape (`Map<listing_key, { true_dom, total_price_drop, property_hash, is_stale }>`) so the downstream Supabase-record + Typesense-doc builders are unchanged. Use this structure (adapt variable names to the real code):

```ts
  const supabaseClient = getServiceRoleClient();
  const vowToken = process.env.PROPTX_VOW_TOKEN;
  const nowMs = Date.now();
  const temporalMetrics = new Map<string, { true_dom: number; total_price_drop: number; property_hash: string; is_stale: boolean }>();

  // Per active listing: refresh the campaign-history ledger (best-effort, 24h-TTL
  // cached, subject-always-merged, never-regress) and read the corrected metrics.
  // Replaces the old fetchHistoricalListings/fetchSoldCampaigns/calculateTrueDOM stitch.
  for (const t of transformed) {
    const raw = t.supabasePayload.full_payload as Record<string, unknown>;
    const propertyHash = generatePropertyHash(raw);
    let true_dom = 0;
    let total_price_drop = 0;
    let is_stale = false;
    try {
      const row = await refreshCampaignHistoryForListing(supabaseClient, {
        propertyHash,
        addr: {
          StreetNumber: raw['StreetNumber'], StreetName: raw['StreetName'], City: raw['City'],
          UnitNumber: raw['UnitNumber'], PropertySubType: raw['PropertySubType'],
        },
        subjectEvent: normalizeCampaign(raw as RawVowCampaign),
        vowToken,
        nowMs,
      });
      if (row) { true_dom = row.true_dom; total_price_drop = row.total_price_drop; is_stale = row.is_stale; }
    } catch (e) {
      console.warn(`[sync] campaign-history refresh failed for ${t.supabasePayload.listing_key}:`, (e as Error)?.message);
    }
    (raw as Record<string, unknown>).property_hash = propertyHash;
    (raw as Record<string, unknown>).true_dom = true_dom;
    (raw as Record<string, unknown>).total_price_drop = total_price_drop;
    temporalMetrics.set(t.supabasePayload.listing_key, { true_dom, total_price_drop, property_hash: propertyHash, is_stale });
  }
```

IMPORTANT: match the REAL downstream consumers. After this block, the existing code reads `temporalMetrics.get(listing_key)` to build the Supabase record (`property_hash`, `is_stale`, etc.) and the Typesense doc (`TrueDom: metrics?.true_dom || 0`, `TotalPriceDrop`, `PropertyHash`). Preserve those consumers exactly — only the *production* of the metrics changed. If the real `temporalMetrics` value shape differs (e.g. it stored a full `TemporalMetrics`), adapt the map value to satisfy every downstream `.get()` read and report the adaptation.

- [ ] **Step 4: Retire the dead stitch functions**

Delete `fetchHistoricalListings` and `fetchSoldCampaigns` (now unreferenced) and any imports they solely used (`calculateTrueDOM`, `processTemporalBatch`, `groupHistoricalByHash`, `HistoricalListing`, `TemporalMetrics`, `CurrentListingInput`, `STITCH_WINDOW_DAYS` — delete ONLY those with zero remaining references; grep each before deleting). If any is still referenced elsewhere in `sync.ts`, keep it. Report exactly what you removed.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → PASS (report verbatim on failure).
Run: `npm run test` → whole suite green (no test imports the deleted functions; if one does, it was testing dead code — report it, do NOT delete the test without flagging).
Run: `npm run lint` → 0 new errors in `sync.ts`.

- [ ] **Step 6: Commit (stage ONLY `sync.ts`)**

```bash
git add scripts/worker/sync.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): nightly sync writes ledger-based True DOM (retire broken stitch)

processBatch now refreshes the campaign-history ledger per active listing
(best-effort, 24h TTL, subject-merged, never-regress) and writes the corrected
true_dom/total_price_drop to full_payload + Typesense TrueDom, replacing the
fetchHistoricalListings/fetchSoldCampaigns/calculateTrueDOM stitch that collapsed
relists to ~1 day.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `warmCampaignHistory.ts` — bounded, paced warm-pass + reindex

**Files:**
- Create: `scripts/admin/warmCampaignHistory.ts`

Corrects the EXISTING active inventory. Bounded to likely-relists, paced, dry-run by default, resumable. Reindexes Typesense `TrueDom`.

- [ ] **Step 1: Create the script**

Create `scripts/admin/warmCampaignHistory.ts`:

```ts
/**
 * One-time warm-pass: correct True DOM for the EXISTING active inventory.
 *
 * BOUNDED to likely-relists — actives whose property_hash already shows prior
 * campaigns in our data (appears >1× in `listings`, or present in
 * `property_sale_history`). Non-relisted actives already have a correct True DOM
 * (= their own age), so we skip them to spare the TRREB feed (CLAUDE.md §4).
 *
 * PACED (inter-call delay), DRY-RUN by default, RESUMABLE (keyset cursor on
 * listing_key). For each target: refreshCampaignHistoryForListing (populates the
 * ledger via the VOW feed) → collect the corrected TrueDom → batch-update Typesense.
 *
 * Usage:
 *   npx tsx scripts/admin/warmCampaignHistory.ts                 # DRY-RUN: count + sample, no feed calls beyond the sample, no writes
 *   npx tsx scripts/admin/warmCampaignHistory.ts --sample 25     # fetch+compute 25 targets, print before/after TrueDom, no Typesense write
 *   npx tsx scripts/admin/warmCampaignHistory.ts --apply --limit 500   # apply, bounded
 *   npx tsx scripts/admin/warmCampaignHistory.ts --apply        # full bounded run (likely-relists only), paced
 */
import 'dotenv/config';
import { Client } from 'pg';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { getAdminClient } from '@/lib/typesense/admin'; // adjust to the real getAdminClient export used by sync.ts
import { refreshCampaignHistoryForListing } from '@/lib/campaignHistory/store';
import { normalizeCampaign, type RawVowCampaign } from '@/lib/campaignHistory/normalize';
import { generatePropertyHash } from '@/lib/typesense/TemporalDistressEngine';

const APPLY = process.argv.includes('--apply');
const sampleArg = process.argv.find((a) => a.startsWith('--sample'));
const SAMPLE = sampleArg ? parseInt(process.argv[process.argv.indexOf(sampleArg) + 1], 10) : 0;
const limitArg = process.argv.find((a) => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(process.argv[process.argv.indexOf(limitArg) + 1], 10) : Infinity;

const DELAY_MS = 250;       // inter-listing pace (feed-friendly)
const REINDEX_CHUNK = 100;  // Typesense partial-update batch
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cs = (process.env.DATABASE_URL || '').trim();
  if (!cs) { console.error('❌ DATABASE_URL (session pooler) required'); process.exit(1); }
  const pg = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  await pg.connect();
  await pg.query("SET statement_timeout TO '0'");

  // Likely-relist ACTIVE listings: address has prior campaigns we can see in our data.
  const targets = await pg.query(`
    WITH active AS (
      SELECT listing_key, property_hash, full_payload
      FROM listings
      WHERE property_hash IS NOT NULL AND property_hash <> ''
        AND lower(coalesce(full_payload->>'StandardStatus','')) = 'active'
    ),
    multi AS (SELECT property_hash FROM active GROUP BY property_hash HAVING count(*) > 1)
    SELECT a.listing_key, a.full_payload
    FROM active a
    WHERE a.property_hash IN (SELECT property_hash FROM multi)
       OR a.property_hash IN (SELECT property_hash FROM property_sale_history)
    ORDER BY a.listing_key;`);
  console.log(`Likely-relist active targets: ${targets.rowCount}`);

  if (!APPLY && SAMPLE === 0) {
    console.log('(DRY-RUN — counts only; no feed calls, no writes. Use --sample N to validate, --apply to run.)');
    await pg.end();
    return;
  }

  const supabase = getServiceRoleClient();
  const vowToken = process.env.PROPTX_VOW_TOKEN;
  const nowMs = Date.now();
  const rows = targets.rows.slice(0, SAMPLE > 0 ? SAMPLE : Math.min(targets.rowCount, LIMIT));
  const updates: { id: string; TrueDom: number }[] = [];
  let processed = 0, corrected = 0;

  for (const r of rows) {
    const raw = r.full_payload as Record<string, unknown>;
    const propertyHash = generatePropertyHash(raw);
    try {
      const row = await refreshCampaignHistoryForListing(supabase, {
        propertyHash,
        addr: { StreetNumber: raw['StreetNumber'], StreetName: raw['StreetName'], City: raw['City'], UnitNumber: raw['UnitNumber'], PropertySubType: raw['PropertySubType'] },
        subjectEvent: normalizeCampaign(raw as RawVowCampaign),
        vowToken, nowMs,
      });
      const prevDom = typeof raw['true_dom'] === 'number' ? (raw['true_dom'] as number) : null;
      if (row) {
        if (SAMPLE > 0) console.log(`  ${r.listing_key}: true_dom ${prevDom ?? '—'} → ${row.true_dom} (campaigns ${row.campaign_count})`);
        updates.push({ id: r.listing_key, TrueDom: row.true_dom });
        if (prevDom !== row.true_dom) corrected++;
      }
    } catch (e) {
      console.warn(`  ⚠️ ${r.listing_key}: ${(e as Error)?.message}`);
    }
    processed++;
    if (processed % 100 === 0) console.log(`   …${processed}/${rows.length} (corrected ${corrected})`);
    await sleep(DELAY_MS);
  }

  console.log(`\nProcessed ${processed}; corrected ${corrected}; Typesense updates queued ${updates.length}`);

  if (!APPLY) { console.log('(--sample mode: no Typesense write. Re-run with --apply to reindex.)'); await pg.end(); return; }

  // Reindex Typesense TrueDom (partial update by id = listing_key), chunked.
  const admin = getAdminClient();
  let ok = 0, failed = 0;
  for (let i = 0; i < updates.length; i += REINDEX_CHUNK) {
    const chunk = updates.slice(i, i + REINDEX_CHUNK);
    try {
      const res = await admin.collections('properties').documents().import(chunk, { action: 'update' });
      const results = Array.isArray(res) ? res : JSON.parse(res as unknown as string);
      for (const x of results) (x.success ? ok++ : failed++);
    } catch (e) { failed += chunk.length; console.warn(`   reindex chunk @${i} failed: ${(e as Error)?.message}`); }
    await sleep(200);
  }
  console.log(`Typesense TrueDom reindex: ${ok} ok, ${failed} failed`);
  await pg.end();
}
main().then(() => process.exit(0)).catch((e) => { console.error('CRASH', e?.message || e); process.exit(1); });
```

NOTE on imports the implementer MUST verify against the real code: the Typesense admin client (`getAdminClient`) — find its real module path (used in `scripts/worker/sync.ts`) and import it the same way; the Typesense doc id field for the `properties` collection (confirm it is `listing_key` as `id`, the value `searchListings` filters with `id:=`); and the `@/` vs relative import style that admin scripts use (`scripts/admin/refresh-property-sale-history.ts` is the reference for the connection/import pattern, incl. the TLS-relaxed fetch agent if the Supabase JS client needs it here).

- [ ] **Step 2: Typecheck + DRY-RUN (no writes, no/minimal feed)**

Run: `npm run typecheck` → PASS.
Run: `npx tsx scripts/admin/warmCampaignHistory.ts` → prints the likely-relist target COUNT only (no feed calls, no writes). **Report the count** — this is the bounded scope the full run will cover.

- [ ] **Step 3: Commit the script (stage ONLY it). Do NOT run --apply yet.**

```bash
git add scripts/admin/warmCampaignHistory.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): warm-pass script — bounded/paced active-inventory True DOM reindex

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Controller-gated execution (NOT a subagent step)**

The `--sample 25` validation and the `--apply` full run are PROD/feed operations — the controller runs them directly (not a subagent), reviews the dry-run count + sample before scaling, and paces/​monitors for feed errors. Report the dry-run count up to the user with the measured full-run scope before `--apply`.

---

## Self-review notes (author)
- Spec coverage: §8 nightly write path → Task 1; §13 warm-pass + Typesense reindex → Task 2 (bounded to likely-relists per the §4 feed-volume guardrail).
- Risk: Task 1 edits the live nightly sync — mitigated by `refreshCampaignHistoryForListing`'s never-throw/never-regress/subject-merged guarantees + preserving the exact downstream `temporalMetrics` consumers. Task 2 is dry-run-default + bounded + paced; the full `--apply` is controller-gated, never an unthrottled blast.

## What's next (after Phase 2c)
Integrate the branch (PR). Then the deferred visual-iteration pass (Phase 3 notes) and the optional empty-`property_hash` backfill.
```
