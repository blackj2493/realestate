# Granular Listing Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the nightly alerts worker from price-drops-only to a combined digest covering watchlist status changes (sold tease / off-market / back-on-market) and new-listing alerts for saved market bubbles.

**Architecture:** Compare-at-read (spec: `docs/superpowers/specs/2026-06-10-granular-alerts-design.md`). Baselines live on `watchlist.last_known_status` and new `market_bubbles.notify_since`; the worker compares them against the live Typesense indexes each night and emails one digest per user. All decision logic is pure modules in `src/lib/alerts/` (TDD); `scripts/worker/alerts.ts` stays a thin I/O shell.

**Tech Stack:** TypeScript, Typesense JS client, Supabase service-role client, Resend, vitest (node env), Next.js App Router (one PATCH extension + one dashboard toggle).

**Branch:** `feat/granular-alerts` (already cut from origin/main; spec committed).

---

## Verified ground truth (do not re-derive)

- Active index: collection `properties`; status field `Status` (= `raw.Status || raw.MlsStatus || raw.StandardStatus`); brokerage `ListOfficeName`; thumb `primaryImageUrl`; entry time `EntryTimestamp` (int64 unix **ms**); geopoint `location`. Sold/terminal docs are **deleted** from this index (PR #19).
- Sold index: collection `sold_listings`; document id = listing_key; fields `DealType` ('sold'|'leased'), `ClosePrice`.
- Terminal status spellings (lowercased): `sold, closed, closed sale, leased, terminated, expired, suspended`.
- Supabase: table `market_bubbles` (NOT `bubbles`); `listings` has NO flat status column — read `full_payload->>'MlsStatus'`. `watchlist` already has `last_known_status`, `list_price`, `last_alerted_price`, `last_alerted_at`.
- Bubble area clause builder exists at `src/lib/bubbles/stats.ts:88` (`buildAreaClause`, currently module-private) — `location:(lat, lng, …)` for draw/commute, `NearbySchools:=\`key\`` for school. Sales floor used there: `ListPrice:>=100000`.
- Bubbles do NOT store universal price/beds filters → bubble matching = area + sales floor only (spec correction).
- Worker scripts import `@/lib/...` fine (alerts.ts already does). vitest includes `src/**/*.test.ts` and `scripts/**/*.test.ts`. Run tests with `npx.cmd vitest run <path>` on this Windows env.
- Next free migration number: **034**.

---

### Task 1: Migration 034 — bubble alert columns

**Files:**
- Create: `supabase/migrations/034_bubble_alerts.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 034_bubble_alerts.sql
-- Per-bubble new-listing alert state (spec: docs/superpowers/specs/2026-06-10-granular-alerts-design.md).
-- alerts_enabled: default ON (user decision 2026-06-10); per-bubble mute toggle in the dashboard.
-- notify_since:   watermark. NULL = not yet baselined; the worker's first sight of a bubble sets it
--                 to the run timestamp and emails nothing (no backlog dumps).
-- Instant DDL — safe for the Supabase SQL editor (no table rewrite: plain ADD COLUMN with
-- non-volatile defaults).

ALTER TABLE public.market_bubbles
  ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_since   TIMESTAMPTZ;

COMMENT ON COLUMN public.market_bubbles.alerts_enabled IS
  'Nightly new-listing digest opt-out for this bubble (default ON).';
COMMENT ON COLUMN public.market_bubbles.notify_since IS
  'New-listing alert watermark (EntryTimestamp cutoff). NULL = not yet baselined by the worker.';
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/034_bubble_alerts.sql
git commit -m "feat(alerts): migration 034 — market_bubbles alert columns (alerts_enabled, notify_since)"
```

(Applying to prod: paste into the Supabase SQL editor — instant DDL — or run via a pooler-connected
script. Application is an operational step at the end; code must tolerate the columns being
absent only until deploy, which it does because the worker treats a missing-column read error as
"skip bubbles phase" — see Task 5.)

---

### Task 2: `src/lib/alerts/transitions.ts` — status-change classifier (TDD)

**Files:**
- Create: `src/lib/alerts/transitions.ts`
- Test: `src/lib/alerts/transitions.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { classifyStatusChange, isTerminalStatus, resolvedBaseline } from "./transitions";

describe("isTerminalStatus", () => {
  it("matches the feed's terminal spellings case/space-insensitively", () => {
    for (const s of ["Sold", "CLOSED", "closed sale", "Leased", "Terminated ", " Expired", "Suspended"]) {
      expect(isTerminalStatus(s)).toBe(true);
    }
    expect(isTerminalStatus("Active")).toBe(false);
    expect(isTerminalStatus("New")).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });
});

describe("classifyStatusChange — doc still in the active index", () => {
  it("alerts when a listing goes Sold Conditional", () => {
    expect(
      classifyStatusChange({ prev: "New", current: "Sold Conditional", soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "sold-conditional" });
  });

  it("covers the Escape Clause variant", () => {
    expect(
      classifyStatusChange({
        prev: "New",
        current: "Sold Conditional Escape Clause",
        soldHit: false,
        fallbackStatus: null,
      })
    ).toEqual({ kind: "sold-conditional" });
  });

  it("does not re-fire when already Sold Conditional", () => {
    expect(
      classifyStatusChange({ prev: "Sold Conditional", current: "Sold Conditional", soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });

  it("alerts back-on-market when a terminal baseline reappears active", () => {
    expect(
      classifyStatusChange({ prev: "Terminated", current: "New", soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "back-on-market" });
  });

  it("stays silent on routine churn (New → Price Change)", () => {
    expect(
      classifyStatusChange({ prev: "New", current: "Price Change", soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });

  it("stays silent when there is no prior baseline", () => {
    expect(
      classifyStatusChange({ prev: null, current: "Sold Conditional", soldHit: false, fallbackStatus: null })
    ).toBeNull();
  });
});

describe("classifyStatusChange — doc vanished from the active index", () => {
  it("classifies SOLD via the sold_listings hit", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: true, fallbackStatus: null })
    ).toEqual({ kind: "sold" });
  });

  it("classifies off-market with the fallback reason", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: "Terminated" })
    ).toEqual({ kind: "off-market", detail: "Terminated" });
  });

  it("treats a sold-spelled fallback as sold", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: "Closed" })
    ).toEqual({ kind: "sold" });
  });

  it("falls back to gone when nothing explains the vanish", () => {
    expect(
      classifyStatusChange({ prev: "New", current: null, soldHit: false, fallbackStatus: null })
    ).toEqual({ kind: "gone" });
  });

  it("never re-fires once the baseline is already resolved", () => {
    expect(classifyStatusChange({ prev: "Sold", current: null, soldHit: true, fallbackStatus: null })).toBeNull();
    expect(classifyStatusChange({ prev: "Unavailable", current: null, soldHit: false, fallbackStatus: null })).toBeNull();
  });
});

describe("resolvedBaseline", () => {
  it("returns the status string to persist so an event never re-fires", () => {
    expect(resolvedBaseline({ kind: "sold" })).toBe("Sold");
    expect(resolvedBaseline({ kind: "off-market", detail: "Expired" })).toBe("Expired");
    expect(resolvedBaseline({ kind: "gone" })).toBe("Unavailable");
    // in-index events persist the live status, not a synthetic one
    expect(resolvedBaseline({ kind: "sold-conditional" })).toBeNull();
    expect(resolvedBaseline({ kind: "back-on-market" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx.cmd vitest run src/lib/alerts/transitions.test.ts`
Expected: FAIL — Cannot find module './transitions'.

- [ ] **Step 3: Implement**

```ts
/**
 * Watchlist status-transition classifier — pure, deterministic (§4: no LLM).
 *
 * Inputs are the nightly snapshot pair for one watched listing:
 *   prev           watchlist.last_known_status (the baseline)
 *   current        Status from the active `properties` index, or null when the
 *                  doc is gone (PR #19 deletes sold/terminal docs from that index)
 *   soldHit        the listing was found in `sold_listings` with DealType 'sold'
 *   fallbackStatus listings.full_payload->>'MlsStatus' (Supabase vault, vanished docs only)
 *
 * Returns the alertable event, or null for routine churn / already-resolved rows.
 */

export type StatusAlertKind = "sold" | "sold-conditional" | "off-market" | "back-on-market" | "gone";

export interface StatusEvent {
  kind: StatusAlertKind;
  /** Off-market reason as spelled by the feed (Terminated / Expired / Suspended). */
  detail?: string;
}

// Same spellings the sync's stale-doc sweep recognizes (staleSearchDocs NON_ACTIVE_STATUSES),
// duplicated here so this module stays importable from both src and scripts without
// reaching into worker internals.
const TERMINAL = new Set(["sold", "closed", "closed sale", "leased", "terminated", "expired", "suspended"]);
const SOLD_SPELLINGS = new Set(["sold", "closed", "closed sale"]);

/** Synthetic baseline written when a vanish has no explanation; treated as resolved. */
const UNAVAILABLE = "unavailable";

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().trim();

export function isTerminalStatus(s: string | null | undefined): boolean {
  return TERMINAL.has(norm(s));
}

/** Resolved = we already alerted (or decided not to) for this disappearance. */
function isResolvedBaseline(prev: string | null): boolean {
  const n = norm(prev);
  return TERMINAL.has(n) || n === UNAVAILABLE;
}

export interface ClassifyInput {
  prev: string | null;
  current: string | null; // null = vanished from the active index
  soldHit: boolean;
  fallbackStatus: string | null;
}

export function classifyStatusChange({ prev, current, soldHit, fallbackStatus }: ClassifyInput): StatusEvent | null {
  const p = norm(prev);

  if (current != null) {
    const c = norm(current);
    if (!p || c === p) return null; // no baseline yet, or no change
    if (isResolvedBaseline(prev) && !TERMINAL.has(c)) return { kind: "back-on-market" };
    if (c.includes("sold conditional") && !p.includes("sold conditional")) return { kind: "sold-conditional" };
    return null; // routine churn (New → Price Change, Extension, …) — baseline refresh only
  }

  // Vanished from the active index.
  if (!p || isResolvedBaseline(prev)) return null; // nothing to compare, or already handled
  if (soldHit || SOLD_SPELLINGS.has(norm(fallbackStatus))) return { kind: "sold" };
  if (isTerminalStatus(fallbackStatus)) return { kind: "off-market", detail: fallbackStatus!.trim() };
  return { kind: "gone" };
}

/**
 * Baseline string to persist on the watchlist row so this event never re-fires.
 * null ⇒ persist the live index status instead (in-index transitions).
 */
export function resolvedBaseline(event: StatusEvent): string | null {
  if (event.kind === "sold") return "Sold";
  if (event.kind === "off-market") return event.detail ?? "Terminated";
  if (event.kind === "gone") return "Unavailable";
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx.cmd vitest run src/lib/alerts/transitions.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/transitions.ts src/lib/alerts/transitions.test.ts
git commit -m "feat(alerts): status-transition classifier (sold tease / off-market / relist)"
```

---

### Task 3: `src/lib/alerts/bubbleDigest.ts` — bubble section shaping (TDD)

**Files:**
- Create: `src/lib/alerts/bubbleDigest.ts`
- Test: `src/lib/alerts/bubbleDigest.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildBubbleSections,
  BUBBLE_EMAIL_ROW_CAP,
  BUBBLE_COLLAPSE_THRESHOLD,
  type BubbleMatches,
  type NewListingAlert,
} from "./bubbleDigest";

function listing(key: string, entryMs = 0): NewListingAlert {
  return {
    listing_key: key,
    address: `${key} Test St`,
    city: "Brampton",
    price: 800_000,
    beds: 3,
    baths: 2,
    brokerage: "TEST BROKERAGE",
    entryMs,
  };
}

function bubble(id: string, name: string, matches: NewListingAlert[], total = matches.length): BubbleMatches {
  return { bubbleId: id, bubbleName: name, total, matches };
}

describe("buildBubbleSections", () => {
  it("passes small result sets through untouched, newest first", () => {
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [listing("W1", 1), listing("W2", 3), listing("W3", 2)]),
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].collapsed).toBe(false);
    expect(sections[0].listings.map((l) => l.listing_key)).toEqual(["W2", "W3", "W1"]);
    expect(sections[0].total).toBe(3);
  });

  it("caps rows at BUBBLE_EMAIL_ROW_CAP, keeping the true total", () => {
    const many = Array.from({ length: 10 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Pocket A", many)]);
    expect(s.listings).toHaveLength(BUBBLE_EMAIL_ROW_CAP);
    expect(s.total).toBe(10);
    expect(s.collapsed).toBe(false);
  });

  it("collapses chronically noisy bubbles to a count-only section", () => {
    const many = Array.from({ length: BUBBLE_COLLAPSE_THRESHOLD + 1 }, (_, i) => listing(`W${i}`, i));
    const [s] = buildBubbleSections([bubble("b1", "Half of Brampton", many, many.length)]);
    expect(s.collapsed).toBe(true);
    expect(s.listings).toHaveLength(0);
    expect(s.total).toBe(BUBBLE_COLLAPSE_THRESHOLD + 1);
  });

  it("de-dups a listing appearing in two bubbles — first bubble wins", () => {
    const shared = listing("W9", 5);
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [shared, listing("W1", 1)]),
      bubble("b2", "Pocket B", [shared, listing("W2", 2)]),
    ]);
    expect(sections[0].listings.map((l) => l.listing_key)).toContain("W9");
    expect(sections[1].listings.map((l) => l.listing_key)).not.toContain("W9");
    expect(sections[1].total).toBe(1); // de-dup adjusts the displayed total
  });

  it("drops bubbles that end up empty after de-dup", () => {
    const shared = listing("W9");
    const sections = buildBubbleSections([
      bubble("b1", "Pocket A", [shared]),
      bubble("b2", "Pocket B", [shared]),
    ]);
    expect(sections).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx.cmd vitest run src/lib/alerts/bubbleDigest.test.ts`
Expected: FAIL — Cannot find module './bubbleDigest'.

- [ ] **Step 3: Implement**

```ts
/**
 * Bubble new-listing digest shaping — pure (§4). Enforces the anti-irritation
 * model from the spec: ≤6 rows per bubble, noisy bubbles collapse to a count,
 * a listing matching several of a user's bubbles appears once (first wins).
 */

export interface NewListingAlert {
  listing_key: string;
  address: string;
  city: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  brokerage: string | null;
  /** EntryTimestamp (unix ms) — used only for newest-first ordering. */
  entryMs: number;
}

export interface BubbleMatches {
  bubbleId: string;
  bubbleName: string;
  /** True match count from Typesense `found` (may exceed matches.length). */
  total: number;
  matches: NewListingAlert[];
}

export interface BubbleSection {
  bubbleId: string;
  bubbleName: string;
  total: number;
  /** ≤ BUBBLE_EMAIL_ROW_CAP rows, newest first. Empty when collapsed. */
  listings: NewListingAlert[];
  /** Bubble too noisy for rows — render a one-line count instead. */
  collapsed: boolean;
}

export const BUBBLE_EMAIL_ROW_CAP = 6;
export const BUBBLE_COLLAPSE_THRESHOLD = 20;

export function buildBubbleSections(perBubble: BubbleMatches[]): BubbleSection[] {
  const seen = new Set<string>();
  const sections: BubbleSection[] = [];

  for (const b of perBubble) {
    const deduped = b.matches.filter((m) => !seen.has(m.listing_key));
    for (const m of deduped) seen.add(m.listing_key);
    // De-dup shrinks the displayed total by however many rows this bubble lost.
    const total = b.total - (b.matches.length - deduped.length);
    if (total <= 0) continue;

    if (total > BUBBLE_COLLAPSE_THRESHOLD) {
      sections.push({ bubbleId: b.bubbleId, bubbleName: b.bubbleName, total, listings: [], collapsed: true });
      continue;
    }

    const rows = [...deduped].sort((a, z) => z.entryMs - a.entryMs).slice(0, BUBBLE_EMAIL_ROW_CAP);
    if (rows.length === 0) continue;
    sections.push({ bubbleId: b.bubbleId, bubbleName: b.bubbleName, total, listings: rows, collapsed: false });
  }

  return sections;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx.cmd vitest run src/lib/alerts/bubbleDigest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/bubbleDigest.ts src/lib/alerts/bubbleDigest.test.ts
git commit -m "feat(alerts): bubble digest shaping — row cap, noisy-bubble collapse, cross-bubble de-dup"
```

---

### Task 4: `src/lib/alerts/digest.ts` — sectioned email renderer (TDD)

**Files:**
- Create: `src/lib/alerts/digest.ts`
- Test: `src/lib/alerts/digest.test.ts`

The renderer absorbs `renderDigest`/`DropAlert` from `scripts/worker/alerts.ts` (they move here;
Task 5 deletes the originals). `DropAlert` gains `brokerage` (§4 mandatory brokerage display —
also retrofits the existing price-drop rows).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { renderAlertsDigest, type DigestPayload } from "./digest";

const baseDrop = {
  listing_key: "W100",
  address: "100 Drop Ave",
  city: "Brampton",
  oldPrice: 900_000,
  newPrice: 850_000,
  thumb: null,
  brokerage: "DROP REALTY",
};

const baseStatus = {
  listing_key: "W200",
  address: "200 Sold Cres",
  city: "Mississauga",
  kind: "sold" as const,
  detail: undefined as string | undefined,
  brokerage: "SOLD REALTY",
};

const baseSection = {
  bubbleId: "b1",
  bubbleName: "Pocket A",
  total: 2,
  collapsed: false,
  listings: [
    {
      listing_key: "W300",
      address: "300 New St",
      city: "Brampton",
      price: 799_000,
      beds: 3,
      baths: 2,
      brokerage: "NEW REALTY",
      entryMs: 1,
    },
  ],
};

function payload(over: Partial<DigestPayload> = {}): DigestPayload {
  return { drops: [], statusChanges: [], bubbles: [], ...over };
}

describe("renderAlertsDigest", () => {
  it("composes the subject from non-empty sections", () => {
    const { subject } = renderAlertsDigest(
      payload({ drops: [baseDrop], statusChanges: [baseStatus], bubbles: [baseSection] })
    );
    expect(subject).toBe("1 sold · 1 price drop · 2 new listings");
  });

  it("subject for status-only digests names the event", () => {
    const { subject } = renderAlertsDigest(payload({ statusChanges: [baseStatus] }));
    expect(subject).toBe("1 sold");
    const offMarket = { ...baseStatus, kind: "off-market" as const, detail: "Terminated" };
    expect(renderAlertsDigest(payload({ statusChanges: [offMarket] })).subject).toBe("1 status change");
  });

  it("sold rows are a tease — no price, sign-in CTA, link to the listing", () => {
    const { html, text } = renderAlertsDigest(payload({ statusChanges: [baseStatus] }));
    expect(html).toContain("200 Sold Cres");
    expect(html).toContain("SOLD");
    expect(html.toLowerCase()).toContain("sign in to see the closing price");
    expect(html).toContain("/properties/W200");
    expect(html).not.toContain("$"); // no prices anywhere in a status-only digest
    expect(text.toLowerCase()).toContain("sign in to see the closing price");
  });

  it("every listing row carries its brokerage (§4)", () => {
    const { html } = renderAlertsDigest(
      payload({ drops: [baseDrop], statusChanges: [baseStatus], bubbles: [baseSection] })
    );
    expect(html).toContain("DROP REALTY");
    expect(html).toContain("SOLD REALTY");
    expect(html).toContain("NEW REALTY");
  });

  it("renders overflow and collapsed bubble lines", () => {
    const overflowing = { ...baseSection, total: 9 }; // 1 row shown of 9
    const collapsed = { ...baseSection, bubbleId: "b2", bubbleName: "Huge Area", total: 42, collapsed: true, listings: [] };
    const { html } = renderAlertsDigest(payload({ bubbles: [overflowing, collapsed] }));
    expect(html).toContain("+8 more");
    expect(html).toContain("42 new listings");
    expect(html).toContain("Huge Area");
  });

  it("omits empty sections entirely", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).not.toContain("New in your areas");
    expect(html).not.toContain("Status changes");
  });

  it("footer has the manage-alerts link and PROPTX attribution", () => {
    const { html } = renderAlertsDigest(payload({ drops: [baseDrop] }));
    expect(html).toContain("/dashboard");
    expect(html).toContain("PROPTX MLS®");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx.cmd vitest run src/lib/alerts/digest.test.ts`
Expected: FAIL — Cannot find module './digest'.

- [ ] **Step 3: Implement**

```ts
/**
 * Combined nightly alerts digest — ONE email per user per day with up to three
 * sections (status changes / price drops / new listings in saved areas).
 * Pure renderer: subject + html + text from a DigestPayload (§4 — deterministic).
 *
 * Compliance:
 *  - Sold rows are a TEASE: the closing price never appears in email (VOW data
 *    stays behind the authenticated session). CTA links to the gated listing page.
 *  - Every listing row displays the listing brokerage in the same font size as
 *    the other details (§4 mandatory brokerage display).
 */

import type { StatusAlertKind } from "./transitions";
import type { BubbleSection } from "./bubbleDigest";

export interface DropAlert {
  listing_key: string;
  address: string;
  city: string | null;
  oldPrice: number;
  newPrice: number;
  thumb: string | null;
  brokerage: string | null;
}

export interface StatusChangeAlert {
  listing_key: string;
  address: string;
  city: string | null;
  kind: StatusAlertKind;
  detail?: string;
  brokerage: string | null;
}

export interface DigestPayload {
  drops: DropAlert[];
  statusChanges: StatusChangeAlert[];
  bubbles: BubbleSection[];
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://pureproperty.ca").replace(/\/$/, "");

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;

const KIND_LABEL: Record<StatusAlertKind, string> = {
  sold: "SOLD",
  "sold-conditional": "SOLD CONDITIONAL",
  "off-market": "OFF MARKET",
  "back-on-market": "BACK ON MARKET",
  gone: "NO LONGER ACTIVE",
};

const KIND_COLOR: Record<StatusAlertKind, string> = {
  sold: "#dc2626",
  "sold-conditional": "#d97706",
  "off-market": "#64748b",
  "back-on-market": "#0f766e",
  gone: "#64748b",
};

function statusLine(s: StatusChangeAlert): string {
  if (s.kind === "sold") return "Sign in to see the closing price";
  if (s.kind === "off-market") return `Listing ${s.detail ? s.detail.toLowerCase() : "removed"} — a relist often signals a motivated seller`;
  if (s.kind === "back-on-market") return "Relisted — previous campaign ended without a sale";
  if (s.kind === "sold-conditional") return "Offer accepted with conditions — can still fall through";
  return "Removed from the active feed";
}

const brokerageLine = (b: string | null) =>
  b ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">${b}</div>` : "";

function subjectFor(p: DigestPayload): string {
  const parts: string[] = [];
  const sold = p.statusChanges.filter((s) => s.kind === "sold").length;
  const otherStatus = p.statusChanges.length - sold;
  if (sold) parts.push(`${sold} sold`);
  if (otherStatus) parts.push(`${otherStatus} status change${otherStatus === 1 ? "" : "s"}`);
  if (p.drops.length) parts.push(`${p.drops.length} price drop${p.drops.length === 1 ? "" : "s"}`);
  const newCount = p.bubbles.reduce((n, b) => n + b.total, 0);
  if (newCount) parts.push(`${newCount} new listing${newCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Your PureProperty alerts";
}

const sectionHeader = (title: string) =>
  `<h2 style="font-size:13px;color:#334155;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 4px;">${title}</h2>`;

function statusRowsHtml(items: StatusChangeAlert[]): string {
  return items
    .map(
      (s) => `
      <tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <span style="display:inline-block;background:${KIND_COLOR[s.kind]};color:#fff;font-size:10px;font-weight:700;
                     letter-spacing:.06em;padding:2px 6px;border-radius:3px;vertical-align:middle;">${KIND_LABEL[s.kind]}</span>
        <a href="${listingUrl(s.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;margin-left:8px;">
          ${s.address || "Saved property"}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${s.city || ""}</div>
        ${brokerageLine(s.brokerage)}
        <div style="margin-top:6px;font-size:13px;color:#475569;">
          ${s.kind === "sold" ? `<a href="${listingUrl(s.listing_key)}" style="color:#0891b2;font-weight:600;text-decoration:none;">${statusLine(s)} →</a>` : statusLine(s)}
        </div>
      </td></tr>`
    )
    .join("");
}

function dropRowsHtml(drops: DropAlert[]): string {
  return drops
    .map((d) => {
      const cut = d.oldPrice - d.newPrice;
      return `
      <tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(d.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;">
          ${d.address || "Saved property"}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${d.city || ""}</div>
        ${brokerageLine(d.brokerage)}
        <div style="margin-top:6px;font-size:14px;">
          <span style="color:#94a3b8;text-decoration:line-through;">${money(d.oldPrice)}</span>
          &nbsp;→&nbsp;
          <span style="color:#0f766e;font-weight:700;">${money(d.newPrice)}</span>
          <span style="color:#dc2626;font-weight:600;">&nbsp;(−${money(cut)})</span>
        </div>
      </td></tr>`;
    })
    .join("");
}

function bubbleSectionHtml(b: BubbleSection): string {
  const title = `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:14px;">${b.bubbleName}</div>`;
  if (b.collapsed) {
    return `${title}
      <div style="font-size:13px;color:#475569;margin-top:4px;">
        ${b.total} new listings appeared in this area —
        <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#0891b2;text-decoration:none;font-weight:600;">view them in the app</a>.
        Tip: smaller areas make sharper alerts.
      </div>`;
  }
  const rows = b.listings
    .map(
      (l) => `
      <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(l.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:14px;">
          ${l.address}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${l.city || ""}</div>
        ${brokerageLine(l.brokerage)}
        <div style="margin-top:4px;font-size:13px;color:#0f172a;">
          ${l.price != null ? `<strong>${money(l.price)}</strong>` : ""}
          ${l.beds != null ? ` · ${l.beds} bd` : ""}${l.baths != null ? ` · ${l.baths} ba` : ""}
        </div>
      </td></tr>`
    )
    .join("");
  const overflow =
    b.total > b.listings.length
      ? `<div style="font-size:12px;margin-top:6px;">
           <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#0891b2;text-decoration:none;font-weight:600;">+${b.total - b.listings.length} more in ${b.bubbleName} →</a>
         </div>`
      : "";
  return `${title}<table style="width:100%;border-collapse:collapse;">${rows}</table>${overflow}`;
}

export function renderAlertsDigest(p: DigestPayload): { subject: string; html: string; text: string } {
  const subject = subjectFor(p);

  const statusSection = p.statusChanges.length
    ? sectionHeader("Status changes") + `<table style="width:100%;border-collapse:collapse;">${statusRowsHtml(p.statusChanges)}</table>`
    : "";
  const dropsSection = p.drops.length
    ? sectionHeader("Price drops") + `<table style="width:100%;border-collapse:collapse;">${dropRowsHtml(p.drops)}</table>`
    : "";
  const bubblesSection = p.bubbles.length
    ? sectionHeader("New in your areas") + p.bubbles.map(bubbleSectionHtml).join("")
    : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Your watchlist &amp; market alerts</h1>
      <p style="color:#64748b;font-size:13px;margin:0;">${subject}</p>
      ${statusSection}
      ${dropsSection}
      ${bubblesSection}
      <a href="${SITE}/dashboard"
         style="display:inline-block;margin-top:20px;background:#0891b2;color:#fff;text-decoration:none;
                padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;">
        Open your dashboard
      </a>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;line-height:1.5;">
        You're receiving this because you saved these properties or areas on PureProperty.ca.
        <a href="${SITE}/dashboard" style="color:#94a3b8;">Manage alerts</a>.
        Data is deemed reliable but is not guaranteed accurate. Powered by PROPTX MLS®.
      </p>
    </div>
  </body></html>`;

  const textParts: string[] = [];
  if (p.statusChanges.length) {
    textParts.push(
      "Status changes:\n" +
        p.statusChanges
          .map((s) => {
            const tail = s.kind === "sold" ? "Sign in to see the closing price" : statusLine(s);
            return `• [${KIND_LABEL[s.kind]}] ${s.address}${s.brokerage ? ` — ${s.brokerage}` : ""}\n  ${tail}: ${listingUrl(s.listing_key)}`;
          })
          .join("\n")
    );
  }
  if (p.drops.length) {
    textParts.push(
      "Price drops:\n" +
        p.drops
          .map(
            (d) =>
              `• ${d.address}${d.brokerage ? ` — ${d.brokerage}` : ""} — ${money(d.oldPrice)} -> ${money(d.newPrice)} (-${money(d.oldPrice - d.newPrice)})\n  ${listingUrl(d.listing_key)}`
          )
          .join("\n")
    );
  }
  if (p.bubbles.length) {
    textParts.push(
      "New in your areas:\n" +
        p.bubbles
          .map((b) =>
            b.collapsed
              ? `• ${b.bubbleName}: ${b.total} new listings — view in the app`
              : `• ${b.bubbleName} (${b.total} new):\n` +
                b.listings
                  .map(
                    (l) =>
                      `   - ${l.address}${l.price != null ? ` — ${money(l.price)}` : ""}${l.brokerage ? ` — ${l.brokerage}` : ""}\n     ${listingUrl(l.listing_key)}`
                  )
                  .join("\n")
          )
          .join("\n")
    );
  }
  const text = textParts.join("\n\n") + `\n\nOpen your dashboard: ${SITE}/dashboard`;

  return { subject, html, text };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx.cmd vitest run src/lib/alerts/digest.test.ts`
Expected: PASS.

NOTE: the "no `$` in status-only digest" test will catch any accidental price leakage in the
sold tease. If it fails on the `$` in CSS/encoded chars, fix the markup, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/alerts/digest.ts src/lib/alerts/digest.test.ts
git commit -m "feat(alerts): sectioned digest renderer — status/drops/new-listings, sold tease, brokerage lines"
```

---

### Task 5: Rework `scripts/worker/alerts.ts` into the combined I/O shell

**Files:**
- Modify: `scripts/worker/alerts.ts` (full rewrite of main flow; keep CLI guard)
- Modify: `src/lib/bubbles/stats.ts:88` (export `buildAreaClause`)

- [ ] **Step 1: Export the area clause builder**

In `src/lib/bubbles/stats.ts`, change `function buildAreaClause(` to `export function buildAreaClause(`
and extend its parameter type so the worker can call it with a row that has only
`area_type/polygon/source` (it already only uses those three fields — type it as
`Pick<Bubble, "area_type" | "polygon" | "source">`):

```ts
export function buildAreaClause(
  bubble: Pick<Bubble, "area_type" | "polygon" | "source">
): string | null {
```

- [ ] **Step 2: Rewrite the worker**

Replace the body of `scripts/worker/alerts.ts` with (keeping the header comment style, env list
updated, and the `isMainModule` guard at the bottom):

```ts
/**
 * Nightly alerts digest — price drops + status changes (watchlist) + new
 * listings (saved market bubbles). ONE email per user per day.
 *
 * Architecture: compare-at-read (spec docs/superpowers/specs/2026-06-10-granular-alerts-design.md).
 * Baselines: watchlist.list_price / last_known_status, market_bubbles.notify_since.
 * Compliance: deterministic comparisons only (§4); sold prices NEVER appear in
 * email (tease links to the gated listing page); brokerage shown on every row.
 * Idempotent: baselines/watermarks advance only after a successful send, so a
 * Resend failure retries tomorrow instead of eating the alert.
 *
 * Invoke: npx tsx scripts/worker/alerts.ts
 * Env:    SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL,
 *         TYPESENSE_ADMIN_API_KEY, RESEND_API_KEY,
 *         (optional) ALERTS_FROM_EMAIL, NEXT_PUBLIC_SITE_URL
 */

import 'dotenv/config';
import { Resend } from 'resend';
import Typesense, { Client } from 'typesense';
import { getServiceRoleClient } from '@/lib/supabase/client';
import { buildAreaClause } from '@/lib/bubbles/stats';
import {
  classifyStatusChange,
  resolvedBaseline,
} from '@/lib/alerts/transitions';
import {
  buildBubbleSections,
  type BubbleMatches,
  type NewListingAlert,
} from '@/lib/alerts/bubbleDigest';
import {
  renderAlertsDigest,
  type DigestPayload,
  type DropAlert,
  type StatusChangeAlert,
} from '@/lib/alerts/digest';

const TYPESENSE_HOST = '9uyapwh6e5qmvl34p-1.a1.typesense.net';
const TYPESENSE_PORT = 443;
const FROM = process.env.ALERTS_FROM_EMAIL || 'PureProperty Alerts <support@pureproperty.ca>';
/** Same rental-noise floor as bubble stats (src/lib/bubbles/stats.ts). */
const SALES_FLOOR = 'ListPrice:>=100000';
/** §6.3b display cap — also bounds the per-bubble fetch. */
const MAX_BUBBLE_FETCH = 100;

interface WatchRow {
  id: string;
  user_id: string;
  listing_key: string;
  address: string | null;
  city: string | null;
  thumb: string | null;
  list_price: number | null;
  last_known_status: string | null;
  last_alerted_price: number | null;
}

interface BubbleRow {
  id: string;
  user_id: string;
  name: string;
  area_type: 'draw' | 'commute' | 'school';
  polygon: [number, number][];
  source: { kind: string; schoolKey?: string };
  notify_since: string | null;
}

interface Current {
  price: number | null;
  status: string | null;
  address?: string;
  city?: string;
  thumb?: string;
  brokerage?: string;
}

function getTypesense(): Client {
  const key = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!key) throw new Error('TYPESENSE_ADMIN_API_KEY is not set');
  return new Typesense.Client({
    nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: 'https' }],
    apiKey: key,
    connectionTimeoutSeconds: 10,
  });
}

/** Current state of a listing from the active `properties` index (null if gone). */
async function fetchCurrent(ts: Client, key: string): Promise<Current | null> {
  try {
    const doc = (await ts.collections('properties').documents(key).retrieve()) as Record<string, unknown>;
    const price = Number(doc.ListPrice);
    return {
      price: Number.isFinite(price) && price > 0 ? price : null,
      status: (doc.Status as string) ?? null,
      address: (doc.UnparsedAddress as string) || undefined,
      city: (doc.City as string) || undefined,
      thumb: (doc.thumbnailUrl as string) || (doc.primaryImageUrl as string) || undefined,
      brokerage: (doc.ListOfficeName as string) || undefined,
    };
  } catch {
    return null; // not in the active index (sold / off-market / removed)
  }
}

/** Was the vanished listing recorded as a SOLD deal? (sold_listings id = listing_key) */
async function fetchSoldHit(ts: Client, key: string): Promise<boolean> {
  try {
    const doc = (await ts.collections('sold_listings').documents(key).retrieve()) as Record<string, unknown>;
    return (doc.DealType as string) === 'sold';
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[alerts] RESEND_API_KEY not set — skipping alerts digest.');
    return;
  }

  const runStartIso = new Date().toISOString();
  const supabase = getServiceRoleClient();
  const ts = getTypesense();
  const resend = new Resend(process.env.RESEND_API_KEY);

  // ── Watchlist phase ────────────────────────────────────────────────────────
  const { data: rows, error } = await supabase
    .from('watchlist')
    .select('id, user_id, listing_key, address, city, thumb, list_price, last_known_status, last_alerted_price');
  if (error) throw new Error(`watchlist read failed: ${error.message}`);
  const watch = (rows ?? []) as WatchRow[];

  // One lookup per distinct listing.
  const currents = new Map<string, Current | null>();
  for (const key of new Set(watch.map((w) => w.listing_key))) {
    currents.set(key, await fetchCurrent(ts, key));
  }

  // Vanished docs get a sold_listings hit check + a vault status fallback —
  // also one per distinct listing, only where needed.
  const soldHits = new Map<string, boolean>();
  const fallbackStatuses = new Map<string, string | null>();
  for (const w of watch) {
    const key = w.listing_key;
    if (currents.get(key) !== null || soldHits.has(key)) continue;
    // Skip resolution work when every watcher's baseline is already terminal —
    // classifyStatusChange would return null anyway.
    soldHits.set(key, await fetchSoldHit(ts, key));
    if (!soldHits.get(key)) {
      try {
        const { data } = await supabase
          .from('listings')
          .select('status:full_payload->>MlsStatus')
          .eq('listing_key', key)
          .maybeSingle();
        fallbackStatuses.set(key, (data as { status?: string } | null)?.status ?? null);
      } catch {
        fallbackStatuses.set(key, null);
      }
    }
  }

  const dropsByUser = new Map<string, DropAlert[]>();
  const statusByUser = new Map<string, StatusChangeAlert[]>();
  // Row patches keyed by watchlist row id; applied per-user after send.
  interface RowPatch {
    id: string;
    user_id: string;
    alerted: boolean; // true ⇒ only apply after a successful send
    patch: Record<string, unknown>;
  }
  const rowPatches: RowPatch[] = [];

  for (const w of watch) {
    const cur = currents.get(w.listing_key) ?? null;

    // Status classification (works for present AND vanished docs).
    const event = classifyStatusChange({
      prev: w.last_known_status,
      current: cur?.status ?? null,
      soldHit: soldHits.get(w.listing_key) ?? false,
      fallbackStatus: fallbackStatuses.get(w.listing_key) ?? null,
    });

    if (event) {
      const list = statusByUser.get(w.user_id) ?? [];
      list.push({
        listing_key: w.listing_key,
        address: w.address || cur?.address || '',
        city: w.city || cur?.city || null,
        kind: event.kind,
        detail: event.detail,
        brokerage: cur?.brokerage ?? null,
      });
      statusByUser.set(w.user_id, list);
      rowPatches.push({
        id: w.id,
        user_id: w.user_id,
        alerted: true,
        patch: { last_known_status: resolvedBaseline(event) ?? cur?.status ?? null },
      });
    }

    // Price drops — unchanged semantics, only for docs still present with a price.
    if (cur && cur.price != null) {
      const baseline = w.list_price;
      const isNewDrop = baseline != null && cur.price < baseline && cur.price !== w.last_alerted_price;
      if (isNewDrop) {
        const list = dropsByUser.get(w.user_id) ?? [];
        list.push({
          listing_key: w.listing_key,
          address: w.address || cur.address || '',
          city: w.city || cur.city || null,
          oldPrice: baseline!,
          newPrice: cur.price,
          thumb: w.thumb || cur.thumb || null,
          brokerage: cur.brokerage ?? null,
        });
        dropsByUser.set(w.user_id, list);
        rowPatches.push({
          id: w.id,
          user_id: w.user_id,
          alerted: true,
          patch: {
            list_price: cur.price,
            last_known_status: cur.status,
            last_alerted_price: cur.price,
            last_alerted_at: runStartIso,
          },
        });
      } else if (!event && (baseline == null || cur.price !== baseline || cur.status !== w.last_known_status)) {
        // Silent baseline refresh — safe to apply regardless of email outcome.
        rowPatches.push({
          id: w.id,
          user_id: w.user_id,
          alerted: false,
          patch: { list_price: cur.price, last_known_status: cur.status },
        });
      }
    }
  }

  // ── Bubbles phase (new-listing alerts) ─────────────────────────────────────
  const bubbleMatchesByUser = new Map<string, BubbleMatches[]>();
  // Watermark advances: id → alerted (true ⇒ gate on send success).
  const bubbleAdvances: Array<{ id: string; user_id: string; alerted: boolean }> = [];

  const { data: bubbleRows, error: bubbleErr } = await supabase
    .from('market_bubbles')
    .select('id, user_id, name, area_type, polygon, source, notify_since')
    .eq('alerts_enabled', true);

  if (bubbleErr) {
    // Pre-migration-034 deploys land here (unknown column) — skip the phase, never the run.
    console.warn(`[alerts] bubbles phase skipped: ${bubbleErr.message}`);
  } else {
    for (const b of (bubbleRows ?? []) as BubbleRow[]) {
      try {
        if (!b.notify_since) {
          // First sight: baseline silently. Unconditional advance (nothing was emailed).
          await supabase.from('market_bubbles').update({ notify_since: runStartIso }).eq('id', b.id);
          continue;
        }
        const areaClause = buildAreaClause({
          area_type: b.area_type,
          polygon: b.polygon,
          source: b.source as Parameters<typeof buildAreaClause>[0]['source'],
        });
        if (!areaClause) continue;

        const sinceMs = new Date(b.notify_since).getTime();
        const res = await ts.collections('properties').documents().search({
          q: '*',
          query_by: 'City',
          filter_by: `${SALES_FLOOR} && ${areaClause} && EntryTimestamp:>${sinceMs}`,
          sort_by: 'EntryTimestamp:desc',
          per_page: MAX_BUBBLE_FETCH,
          include_fields:
            'id,UnparsedAddress,City,ListPrice,BedroomsTotal,BathroomsTotalInteger,ListOfficeName,EntryTimestamp',
        });

        const matches: NewListingAlert[] = (res.hits ?? []).map((h) => {
          const d = h.document as Record<string, unknown>;
          const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
          return {
            listing_key: String(d.id ?? ''),
            address: (d.UnparsedAddress as string) || 'New listing',
            city: (d.City as string) || null,
            price: num(d.ListPrice),
            beds: num(d.BedroomsTotal),
            baths: num(d.BathroomsTotalInteger),
            brokerage: (d.ListOfficeName as string) || null,
            entryMs: Number(d.EntryTimestamp) || 0,
          };
        });

        if (matches.length === 0) {
          bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: false });
          continue;
        }
        const list = bubbleMatchesByUser.get(b.user_id) ?? [];
        list.push({ bubbleId: b.id, bubbleName: b.name, total: res.found ?? matches.length, matches });
        bubbleMatchesByUser.set(b.user_id, list);
        bubbleAdvances.push({ id: b.id, user_id: b.user_id, alerted: true });
      } catch (e) {
        console.error('[alerts] bubble failed', b.id, e instanceof Error ? e.message : e);
        // No watermark advance — retried tomorrow.
      }
    }
  }

  // ── Compose + send one digest per affected user ────────────────────────────
  const userIds = new Set<string>([
    ...dropsByUser.keys(),
    ...statusByUser.keys(),
    ...bubbleMatchesByUser.keys(),
  ]);

  const sentUsers = new Set<string>();
  let emailed = 0;
  for (const userId of userIds) {
    const payload: DigestPayload = {
      drops: dropsByUser.get(userId) ?? [],
      statusChanges: statusByUser.get(userId) ?? [],
      bubbles: buildBubbleSections(bubbleMatchesByUser.get(userId) ?? []),
    };
    if (!payload.drops.length && !payload.statusChanges.length && !payload.bubbles.length) continue;

    const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single();
    const email = profile?.email as string | undefined;
    if (!email) continue;

    const { subject, html, text } = renderAlertsDigest(payload);
    try {
      await resend.emails.send({ from: FROM, to: email, subject, html, text });
      sentUsers.add(userId);
      emailed++;
    } catch (e) {
      console.error('[alerts] send failed for', userId, e instanceof Error ? e.message : e);
    }
  }

  // ── Persist baselines ──────────────────────────────────────────────────────
  // Silent refreshes always apply; alert-bearing patches only when that user's
  // email went out (or they had no email on file — then sending will never work,
  // so we advance anyway rather than loop forever).
  const emailableUsers = new Set<string>();
  for (const userId of userIds) {
    const { data: profile } = await supabase.from('profiles').select('email').eq('id', userId).single();
    if (profile?.email) emailableUsers.add(userId);
  }
  const shouldApply = (userId: string, alerted: boolean) =>
    !alerted || sentUsers.has(userId) || !emailableUsers.has(userId);

  for (const u of rowPatches) {
    if (!shouldApply(u.user_id, u.alerted)) continue;
    await supabase.from('watchlist').update(u.patch).eq('id', u.id);
  }
  for (const b of bubbleAdvances) {
    if (!shouldApply(b.user_id, b.alerted)) continue;
    await supabase.from('market_bubbles').update({ notify_since: runStartIso }).eq('id', b.id);
  }

  console.log(
    `[alerts] Done. ${watch.length} watched, ${userIds.size} users with events, ${emailed} emails sent.`
  );
}

// Only run the CLI when executed directly (matches sync.ts / transformer.ts).
// Importing this module (e.g. from tests) must not fire main() — that would
// call Supabase + Resend at import time and crash any consumer.
const isMainModule = typeof process !== 'undefined' && process.argv[1]?.includes('alerts.ts');
if (isMainModule) {
  main().catch((e) => {
    console.error('[alerts] Fatal:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
```

Implementation notes for the executor:
- Delete the old `renderDigest`, `DropAlert`, `money` from alerts.ts — they live in
  `src/lib/alerts/digest.ts` now. Grep for external importers first (`renderDigest`,
  `DropAlert` from `scripts/worker/alerts`); none are expected.
- The duplicated profile lookup (send loop + emailableUsers) is two cheap single-row
  reads per affected user; acceptable. If you want, cache the first lookup in a
  Map<string, string|null> and reuse — preferred.
- The active index's beds field name is `BedroomsTotal` — verify with one
  `Grep "BedroomsTotal" src/lib/typesense/typesenseSchema.ts` (or scripts/worker/typesenseSchema.ts)
  before relying on it; if the schema spells it differently (e.g. `Bedrooms`), use the schema's name.

- [ ] **Step 3: Typecheck + full test suite**

Run: `npm.cmd run typecheck` then `npx.cmd vitest run`
Expected: both clean (625 + new tests).

- [ ] **Step 4: Commit**

```bash
git add scripts/worker/alerts.ts src/lib/bubbles/stats.ts
git commit -m "feat(alerts): combined nightly digest worker — status changes + bubble new-listing alerts"
```

---

### Task 6: API — expose + update bubble alert fields

**Files:**
- Modify: `src/app/api/bubbles/[id]/route.ts` (GET select, PATCH body, PATCH select)
- Modify: `src/app/api/bubbles/route.ts` (GET list select, POST insert select)
- Modify: `src/lib/bubbles/serialize.ts:76` (Bubble type)

- [ ] **Step 1: Extend the Bubble type**

In `src/lib/bubbles/serialize.ts`:

```ts
/** As returned by GET /api/bubbles. */
export interface Bubble extends BubblePayload {
  id: string;
  created_at: string;
  updated_at: string;
  /** Nightly new-listing digest toggle (default ON; migration 034). Optional so
   *  pre-034 API payloads stay assignable. */
  alerts_enabled?: boolean;
  notify_since?: string | null;
}
```

- [ ] **Step 2: Update the selects + PATCH**

In BOTH `src/app/api/bubbles/route.ts` (GET list + POST insert `.select(...)`) and
`src/app/api/bubbles/[id]/route.ts` (GET + PATCH `.select(...)`), replace the column list

`"id, name, area_type, polygon, source, filters, created_at, updated_at"`

with

`"id, name, area_type, polygon, source, filters, alerts_enabled, notify_since, created_at, updated_at"`.

In `src/app/api/bubbles/[id]/route.ts` extend `PatchBody` and the patch builder:

```ts
interface PatchBody {
  name?: string;
  filters?: unknown;
  polygon?: [number, number][];
  source?: unknown;
  alerts_enabled?: boolean;
}
```

and after the `source` branch:

```ts
  if (body.alerts_enabled !== undefined) {
    if (typeof body.alerts_enabled !== "boolean")
      return NextResponse.json({ error: "alerts_enabled must be boolean" }, { status: 400 });
    patch.alerts_enabled = body.alerts_enabled;
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm.cmd run typecheck`
Expected: clean. (If the worker's BubbleRow conflicts, it doesn't — it defines its own row type.)

- [ ] **Step 4: Commit**

```bash
git add src/app/api/bubbles/route.ts "src/app/api/bubbles/[id]/route.ts" src/lib/bubbles/serialize.ts
git commit -m "feat(alerts): bubbles API exposes alerts_enabled/notify_since; PATCH toggles alerts"
```

---

### Task 7: UI — per-bubble alert bell toggle

**Files:**
- Modify: `src/lib/bubbles/useBubbles.ts` (add `setAlertsEnabled`)
- Modify: `src/components/dashboard/BubbleMarketSection.tsx` (bell button in the section header, next to `BubbleSectionMenu`)

- [ ] **Step 1: Store method** (mirror the optimistic `rename` pattern exactly)

In `useBubbles.ts`, add to `BubbleState`:

```ts
  setAlertsEnabled: (id: string, enabled: boolean) => Promise<void>;
```

and to the store implementation (after `rename`):

```ts
  setAlertsEnabled: async (id, enabled) => {
    const prev = get().items[id];
    if (!prev) return;
    set((s) => ({ items: { ...s.items, [id]: { ...prev, alerts_enabled: enabled } } }));
    try {
      const res = await fetch(`/api/bubbles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alerts_enabled: enabled }),
      });
      if (!res.ok) set((s) => ({ items: { ...s.items, [id]: prev } }));
    } catch {
      set((s) => ({ items: { ...s.items, [id]: prev } }));
    }
  },
```

- [ ] **Step 2: Bell toggle in the section header**

In `BubbleMarketSection.tsx`: import `Bell, BellOff` from lucide-react and the store selector,
then render this button immediately BEFORE `<BubbleSectionMenu bubble={bubble} />` in the header
(find the header cluster that renders the menu):

```tsx
function BubbleAlertToggle({ bubble }: { bubble: Bubble }) {
  const setAlertsEnabled = useBubblesStore((s) => s.setAlertsEnabled);
  const enabled = bubble.alerts_enabled !== false; // default ON (pre-034 rows lack the field)
  return (
    <button
      type="button"
      onClick={() => setAlertsEnabled(bubble.id, !enabled)}
      aria-pressed={enabled}
      title={enabled ? "New-listing alerts ON — click to mute" : "New-listing alerts muted — click to enable"}
      className={cn(
        "flex h-7 w-7 items-center justify-center border transition-colors",
        enabled
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
          : "border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-800/60"
      )}
    >
      {enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
    </button>
  );
}
```

(Defined beside `BubbleSectionMenu` in the same file; rendered as
`<BubbleAlertToggle bubble={bubble} />` next to the menu trigger.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm.cmd run typecheck` then `npx.cmd eslint src/components/dashboard/BubbleMarketSection.tsx src/lib/bubbles/useBubbles.ts`
Expected: clean, no new warnings.

- [ ] **Step 4: Commit**

```bash
git add src/lib/bubbles/useBubbles.ts src/components/dashboard/BubbleMarketSection.tsx
git commit -m "feat(alerts): per-bubble alert bell toggle (default ON, optimistic PATCH)"
```

---

### Task 8: Full verification + PR

- [ ] **Step 1: Full gates**

Run, in order; all must pass:
- `npm.cmd run typecheck`
- `npm.cmd run lint` (0 errors; no NEW warnings vs the 78 pre-existing)
- `npm.cmd run test` (625 pre-existing + ~25 new)
- `npm.cmd run build`

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/granular-alerts
gh pr create --base main --head feat/granular-alerts --title "feat(alerts): granular listing alerts — status changes + bubble new-listing digests" --body "<summary per repo convention>"
```

- [ ] **Step 3: Operational follow-ups (flag in PR body, not blockers)**
- Apply migration 034 (Supabase SQL editor — instant DDL).
- The worker tolerates pre-migration prod (bubbles phase logs + skips), so merge order is safe.

---

## Self-review notes

- Spec coverage: detection (Task 2/5), anti-irritation shaping (Task 3), tease + brokerage email
  (Task 4), worker + send-gated baselines (Task 5), migration (Task 1), API (Task 6), UI toggle
  (Task 7). "Manage alerts" footer link → Task 4 footer. No-backlog watermark → Task 5 first-sight
  branch. §6.3b cap → MAX_BUBBLE_FETCH=100 + row cap 6.
- Type consistency: `NewListingAlert`/`BubbleMatches`/`BubbleSection` defined in Task 3, consumed
  in Tasks 4–5; `StatusEvent`/`resolvedBaseline` (Task 2) consumed in Task 5; `DropAlert` moves to
  digest.ts (Task 4) and alerts.ts imports it (Task 5).
- Known judgment call encoded: users with no profile email advance baselines anyway (else they'd
  re-classify forever); spelled out in Task 5.
