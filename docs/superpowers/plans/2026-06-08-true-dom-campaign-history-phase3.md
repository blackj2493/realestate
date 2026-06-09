# True DOM Campaign-History — Phase 3 Implementation Plan (the visible timeline UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the HouseSigma-parity campaign history on the listing page — a **price-graph hero** (sale-price trajectory across campaigns, off-market gaps, stitched-window shading, lease lane) and a **drill-down event table** — both fed by the Phase-2b gated `campaignHistory` and gated to authed users.

**Architecture:** Pure transforms in `src/lib/campaignHistory/timeline.ts` turn `CampaignEvent[]` into (a) newest-first table rows and (b) a chart series with off-market gaps + the current stitched-window span — these are TDD'd in node-env. Two focused client components consume them: `CampaignHistorySection` (table, generalizes the `SaleHistorySection` gated-teaser pattern) and `CampaignTimelineChart` (Recharts `ComposedChart` hero). The listing page renders them from the gated `view.campaignHistory`.

**Tech Stack:** TypeScript, React (client components), Recharts, Tailwind (existing slate/cyan/amber tokens — additive, do NOT override globals), Vitest (node-env, pure-logic only — UI verified by typecheck/lint/build + manual).

**Spec:** `docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md` §9 (UI) + §10 (gating). **Prior:** Phases 1/2a/2b shipped the data + the gated `CampaignHistoryView` (`available`, `campaignCount`, `trueDom`, `totalPriceDrop`, `firstSeenDate`, `events: CampaignEvent[]`) on branch `feat/true-dom-campaign-history`. For anon, `events: []` + `trueDom: null` but `campaignCount`/`firstSeenDate` survive (the teaser hooks).

**Conventions:** Tests `npm run test`; `npm run typecheck`; `npm run lint`; `npm run build` (Next build = the real UI gate). Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `feat/true-dom-campaign-history`.

**Deviation from spec §9 (noted):** the spec said "a 3rd mode on `DOMTimelineChart`". `DOMTimelineChart` is already 290 lines / 2 modes; a campaign ComposedChart with markers + gaps + shading would make it unwieldy. We build a focused **new** `CampaignTimelineChart` instead and let the page choose which to render. The existing `DOMTimelineChart` stays as the fallback for listings with no campaign ledger.

---

## File structure (Phase 3)

- Modify `src/lib/campaignHistory/trueDom.ts` — extract + export `currentStitchedSaleSpan` (so the chart's stitched-window shading reuses the EXACT engine stitch, no logic drift); `computeTrueDomFromCampaigns` calls it (its tests stay green).
- Create `src/lib/campaignHistory/timeline.ts` (+test) — `buildEventRows` + `buildSaleChartSeries` (pure, TDD).
- Create `src/components/Property/CampaignHistorySection.tsx` — the event table + gated teaser.
- Create `src/components/CommandCenter/CampaignTimelineChart.tsx` — the price-graph hero.
- Modify `src/app/(app)/properties/[id]/page.tsx` — render the hero + table from `view.campaignHistory` (fallback to the existing chart/sale-history when no ledger).

---

## Task 1: Pure transforms — `timeline.ts` (+ engine span helper)

**Files:**
- Modify: `src/lib/campaignHistory/trueDom.ts`
- Create: `src/lib/campaignHistory/timeline.ts`
- Test: `src/lib/campaignHistory/timeline.test.ts`

- [ ] **Step 1: Extract the stitch span in `trueDom.ts`**

In `trueDom.ts`, ADD this exported helper (after the existing `resolveEndMs`), and REFACTOR `computeTrueDomFromCampaigns` to use it. The helper IS the walk currently inlined in `computeTrueDomFromCampaigns` (sale-only, newest-first, stitch by gap ≤ window):

```ts
export interface StitchedSpan {
  startMs: number;          // earliest stitched sale-campaign start
  endMs: number;            // now if newest sale is Active, else its terminal date
  originalListPrice: number | null; // earliest stitched original ask (for drop)
}

/** The current continuous SALE campaign span (stitch consecutive sales whose
 *  gap prior.end→next.start ≤ windowDays). null when there are no parseable sales. */
export function currentStitchedSaleSpan(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): StitchedSpan | null {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const sales = events
    .filter((e) => e.transaction_type === 'Sale')
    .map((e) => ({ e, startMs: parseTimestamp(e.entry_date), endMs: 0 }))
    .filter((n): n is { e: CampaignEvent; startMs: number; endMs: number } => n.startMs !== null)
    .map((n) => ({ ...n, endMs: resolveEndMs(n.e, opts.nowMs) }))
    .sort((a, b) => b.startMs - a.startMs);
  if (sales.length === 0) return null;

  const newest = sales[0];
  const endMs = newest.e.status === 'Active' ? opts.nowMs : newest.endMs;
  let startMs = newest.startMs;
  let originalListPrice = newest.e.original_list_price ?? newest.e.list_price ?? null;
  let nextStartMs = newest.startMs;
  for (let i = 1; i < sales.length; i++) {
    const prior = sales[i];
    if (Math.floor((nextStartMs - prior.endMs) / DAY_MS) > windowDays) break;
    startMs = prior.startMs;
    const priorOrig = prior.e.original_list_price ?? prior.e.list_price;
    if (priorOrig != null) originalListPrice = priorOrig;
    nextStartMs = prior.startMs;
  }
  return { startMs, endMs, originalListPrice };
}
```

Then REPLACE the body of `computeTrueDomFromCampaigns` AFTER `const campaign_count = …` with the version that delegates to the helper (behavior identical — its existing 12 tests must stay green):

```ts
  const span = currentStitchedSaleSpan(events, { nowMs, windowDays });
  if (!span) {
    return { true_dom: 0, total_price_drop: 0, campaign_count, is_stale: false };
  }
  const true_dom = Math.max(0, Math.floor((span.endMs - span.startMs) / DAY_MS));
  // newest sale campaign's current list price (for the drop)
  const newestSaleList = events
    .filter((e) => e.transaction_type === 'Sale' && parseTimestamp(e.entry_date) !== null)
    .sort((a, b) => (parseTimestamp(b.entry_date) ?? 0) - (parseTimestamp(a.entry_date) ?? 0))[0]?.list_price ?? 0;
  const total_price_drop =
    span.originalListPrice != null && newestSaleList > 0
      ? Math.max(0, span.originalListPrice - newestSaleList)
      : 0;
  return { true_dom, total_price_drop, campaign_count, is_stale: true_dom > staleDays };
```

Run: `npx vitest run src/lib/campaignHistory/trueDom.test.ts`
Expected: PASS — all 12 existing tests still green (refactor is behavior-preserving). If any fails, the refactor changed behavior — STOP and report.

- [ ] **Step 2: Write the failing `timeline.test.ts`**

Create `src/lib/campaignHistory/timeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEventRows, buildSaleChartSeries } from './timeline';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z');
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

const chain363: CampaignEvent[] = [
  ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', list_price: 1729000, original_list_price: 1729000 }),
  ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900, price_change_date: '2026-05-27T12:53:06Z' }),
  ev({ listing_key: 'N12409326', status: 'Terminated', entry_date: '2025-09-17T15:32:06Z', end_date: '2025-10-15', list_price: 1990000, original_list_price: 1990000 }),
  ev({ listing_key: 'N12656610', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-01-02T17:40:02Z', end_date: '2026-03-02', list_price: 5000 }),
];

describe('buildEventRows', () => {
  const rows = buildEventRows(chain363);
  it('explodes campaigns into newest-first timeline rows', () => {
    // newest event first; N13410488 Listed is the most recent dated row
    expect(rows[0].listingKey).toBe('N13410488');
    expect(rows[0].kind).toBe('Listed for Sale');
  });
  it('emits a Price Changed row when a campaign changed price', () => {
    const pc = rows.find((r) => r.listingKey === 'N13135326' && r.kind === 'Price Changed');
    expect(pc).toBeTruthy();
    expect(pc!.price).toBe(1850000);
  });
  it('emits a terminal row (Terminated) with the end date', () => {
    const term = rows.find((r) => r.listingKey === 'N12409326' && r.kind === 'Terminated');
    expect(term).toBeTruthy();
    expect(term!.date.slice(0, 10)).toBe('2025-10-15');
  });
  it('labels lease listings as Listed for Lease', () => {
    expect(rows.some((r) => r.listingKey === 'N12656610' && r.kind === 'Listed for Lease')).toBe(true);
  });
});

describe('buildSaleChartSeries', () => {
  const s = buildSaleChartSeries(chain363, { nowMs: NOW });
  it('marks the stitched current-campaign window (2026-05-15 → now)', () => {
    expect(s.stitchStartT).toBe(Date.parse('2026-05-15T17:38:46Z'));
    expect(s.stitchEndT).toBe(NOW);
  });
  it('inserts an off-market gap (null price) between the 2025 and 2026 sale efforts', () => {
    expect(s.points.some((p) => p.price === null)).toBe(true);
  });
  it('excludes lease prices from the price points (scale separation)', () => {
    expect(s.points.every((p) => p.price === null || p.price >= 1000000)).toBe(true);
    expect(s.leasePeriods.length).toBe(1); // the one lease campaign becomes a lane
  });
  it('emits event markers for listed/terminated', () => {
    expect(s.markers.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/timeline.test.ts`
Expected: FAIL — cannot find module `./timeline`.

- [ ] **Step 4: Implement `src/lib/campaignHistory/timeline.ts`**

```ts
import { currentStitchedSaleSpan } from './trueDom';
import type { CampaignEvent, CampaignStatus, TransactionKind } from './types';

export type TimelineEventKind =
  | 'Listed for Sale' | 'Listed for Lease' | 'Price Changed'
  | 'Terminated' | 'Expired' | 'Suspended' | 'Sold';

export interface TimelineRow {
  date: string;              // ISO
  kind: TimelineEventKind;
  price: number | null;
  deltaPct: number | null;   // for Price Changed: (new-orig)/orig
  listingKey: string;
  status: CampaignStatus;
  transactionType: TransactionKind;
  brokerage: string | null;
  address: string | null;
}

function ms(d: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isNaN(t) ? null : t;
}

/** Explode each campaign into Listed / Price Changed / terminal rows, newest-first. */
export function buildEventRows(events: CampaignEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const base = {
      listingKey: e.listing_key, status: e.status, transactionType: e.transaction_type,
      brokerage: e.brokerage, address: e.address,
    };
    if (e.entry_date) {
      rows.push({
        ...base, date: e.entry_date,
        kind: e.transaction_type === 'Lease' ? 'Listed for Lease' : 'Listed for Sale',
        price: e.original_list_price ?? e.list_price, deltaPct: null,
      });
    }
    if (e.price_change_date && e.original_list_price != null && e.list_price != null && e.original_list_price !== e.list_price) {
      rows.push({
        ...base, date: e.price_change_date, kind: 'Price Changed',
        price: e.list_price,
        deltaPct: (e.list_price - e.original_list_price) / e.original_list_price,
      });
    }
    if (e.end_date && e.status !== 'Active') {
      rows.push({
        ...base, date: e.end_date, kind: e.status as TimelineEventKind,
        price: e.status === 'Sold' ? e.close_price : null, deltaPct: null,
      });
    }
  }
  return rows.sort((a, b) => (ms(b.date) ?? 0) - (ms(a.date) ?? 0));
}

export interface ChartPoint { t: number; price: number | null; }
export interface ChartMarker { t: number; price: number; kind: TimelineEventKind; }
export interface SaleChartSeries {
  points: ChartPoint[];                 // time-ordered; price=null over off-market gaps
  markers: ChartMarker[];               // event dots on the price line
  stitchStartT: number | null;          // ReferenceArea x1 (current continuous campaign)
  stitchEndT: number | null;            // ReferenceArea x2 (now or terminal)
  leasePeriods: { startT: number; endT: number }[]; // rendered as a lane, NOT on the $ axis
}

/** Sale-price trajectory across campaigns with off-market gaps + the stitched window. */
export function buildSaleChartSeries(
  events: CampaignEvent[],
  opts: { nowMs: number; windowDays?: number }
): SaleChartSeries {
  const sales = events
    .filter((e) => e.transaction_type === 'Sale' && ms(e.entry_date) !== null)
    .map((e) => ({ e, startT: ms(e.entry_date)!, endT: ms(e.end_date) ?? opts.nowMs }))
    .sort((a, b) => a.startT - b.startT); // oldest → newest

  const points: ChartPoint[] = [];
  const markers: ChartMarker[] = [];
  let prevEndT: number | null = null;

  sales.forEach((s, i) => {
    // off-market gap before this campaign → break the line
    if (prevEndT != null && s.startT > prevEndT) {
      points.push({ t: prevEndT, price: null });
      points.push({ t: s.startT, price: null });
    }
    const orig = s.e.original_list_price ?? s.e.list_price ?? null;
    if (orig != null) {
      points.push({ t: s.startT, price: orig });
      markers.push({ t: s.startT, price: orig, kind: 'Listed for Sale' });
    }
    const pcT = ms(s.e.price_change_date);
    if (pcT != null && s.e.list_price != null && orig != null && s.e.list_price !== orig) {
      points.push({ t: pcT, price: s.e.list_price });
      markers.push({ t: pcT, price: s.e.list_price, kind: 'Price Changed' });
    }
    const isNewest = i === sales.length - 1;
    const lastPrice = s.e.list_price ?? orig;
    if (isNewest && s.e.status === 'Active' && lastPrice != null) {
      points.push({ t: opts.nowMs, price: lastPrice });
    } else if (s.e.status !== 'Active' && lastPrice != null) {
      points.push({ t: s.endT, price: lastPrice });
      markers.push({ t: s.endT, price: s.e.status === 'Sold' ? (s.e.close_price ?? lastPrice) : lastPrice, kind: s.e.status as TimelineEventKind });
    }
    prevEndT = s.endT;
  });

  const span = currentStitchedSaleSpan(events, { nowMs: opts.nowMs, windowDays: opts.windowDays });
  const leasePeriods = events
    .filter((e) => e.transaction_type === 'Lease' && ms(e.entry_date) !== null)
    .map((e) => ({ startT: ms(e.entry_date)!, endT: ms(e.end_date) ?? opts.nowMs }));

  return {
    points,
    markers,
    stitchStartT: span?.startMs ?? null,
    stitchEndT: span?.endMs ?? null,
    leasePeriods,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/timeline.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Full campaignHistory suite + typecheck, then commit**

Run: `npx vitest run src/lib/campaignHistory && npm run typecheck`
Expected: all PASS (the trueDom refactor kept its 12 tests green).

```bash
git add src/lib/campaignHistory/trueDom.ts src/lib/campaignHistory/timeline.ts src/lib/campaignHistory/timeline.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): timeline transforms (event rows + sale-price chart series)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `CampaignHistorySection` — the event table

**Files:**
- Create: `src/components/Property/CampaignHistorySection.tsx`

Generalizes the gated-teaser pattern from `SaleHistorySection.tsx` (read it first for the exact teaser markup to mirror). UI is verified by typecheck/lint/build (no jsdom).

- [ ] **Step 1: Create `src/components/Property/CampaignHistorySection.tsx`**

```tsx
/**
 * CampaignHistorySection — full per-property campaign timeline table (HouseSigma-parity).
 * Renders every campaign event (Listed / Price Changed / Terminated / Expired / Sold)
 * from the gated CampaignHistoryView. VOW data (CLAUDE.md §4): anon sees a blurred
 * teaser + the surviving campaignCount, never the rows (events arrive as [] for anon).
 */
"use client";

import Link from "next/link";
import { History, Lock } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { CampaignHistoryView } from "@/lib/campaignHistory/view";
import { buildEventRows, type TimelineRow, type TimelineEventKind } from "@/lib/campaignHistory/timeline";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const KIND_COLOR: Record<TimelineEventKind, string> = {
  "Listed for Sale": "text-emerald-400",
  "Listed for Lease": "text-sky-400",
  "Price Changed": "text-amber-400",
  Terminated: "text-rose-400",
  Expired: "text-slate-400",
  Suspended: "text-slate-400",
  Sold: "text-amber-300",
};

function Row({ r }: { r: TimelineRow }) {
  return (
    <tr className="border-b border-slate-800/50 font-mono text-xs">
      <td className="py-2 text-left text-slate-400">{fmtDate(r.date)}</td>
      <td className={cn("py-2 text-left font-medium", KIND_COLOR[r.kind])}>{r.kind}</td>
      <td className="py-2 text-right text-slate-300">{r.price ? formatPrice(r.price) : "—"}</td>
      <td className="py-2 text-right">
        {r.deltaPct != null ? (
          <span className={r.deltaPct < 0 ? "text-emerald-400" : "text-rose-400"}>
            {r.deltaPct > 0 ? "+" : ""}{Math.round(r.deltaPct * 100)}%
          </span>
        ) : ("—")}
      </td>
      <td className="py-2 text-right text-slate-500">{r.listingKey}</td>
      <td className="py-2 text-right text-slate-600 truncate max-w-[120px]">{r.brokerage ?? "—"}</td>
    </tr>
  );
}

export default function CampaignHistorySection({
  campaignHistory, isAuthed, className,
}: { campaignHistory: CampaignHistoryView; isAuthed: boolean; className?: string }) {
  const { campaignCount, firstSeenDate, events } = campaignHistory;
  const Title = (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
      <History className="h-4 w-4 text-amber-400" />
      Listing History
      {campaignCount > 0 && (
        <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
          {campaignCount}×
        </span>
      )}
    </h3>
  );

  if (campaignCount === 0) {
    return (
      <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
        {Title}
        <p className="text-xs text-slate-500">No prior listing campaigns on record for this address.</p>
      </div>
    );
  }

  if (!isAuthed) {
    const n = Math.min(campaignCount, 6);
    return (
      <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
        {Title}
        <div className="relative">
          <div className="select-none space-y-2 blur-sm" aria-hidden="true">
            {Array.from({ length: n }).map((_, i) => (
              <div key={i} className="flex justify-between font-mono text-xs text-slate-400">
                <span>2025 ··· ··</span><span>Listed ····</span><span>$•,•••,•••</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded bg-slate-950/50 backdrop-blur-[1px]">
            <Lock className="h-5 w-5 text-cyan-400" />
            <p className="text-xs text-slate-300">
              Listed {campaignCount}× {firstSeenDate ? `since ${new Date(firstSeenDate).getFullYear()}` : ""}
            </p>
            <Link href="/login" className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/20">
              Sign in to view the full history
            </Link>
          </div>
        </div>
        <p className="mt-3 text-[10px] leading-snug text-slate-600">
          Listing history via TRREB VOW — viewable to signed-in users for personal, non-commercial use.
        </p>
      </div>
    );
  }

  const rows = buildEventRows(events);
  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
      {Title}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
              <th className="py-2 text-left font-medium">Date</th>
              <th className="py-2 text-left font-medium">Event</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Δ</th>
              <th className="py-2 text-right font-medium">MLS#</th>
              <th className="py-2 text-right font-medium">Brokerage</th>
            </tr>
          </thead>
          <tbody>{rows.map((r, i) => <Row key={`${r.listingKey}-${r.kind}-${i}`} r={r} />)}</tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px] leading-snug text-slate-600">
        Listing history via TRREB VOW — for your personal, non-commercial use.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS (0 new issues in the file).

```bash
git add src/components/Property/CampaignHistorySection.tsx
git commit -m "$(cat <<'EOF'
feat(true-dom): CampaignHistorySection event table (gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `CampaignTimelineChart` — the price-graph hero

**Files:**
- Create: `src/components/CommandCenter/CampaignTimelineChart.tsx`

Read `src/components/CommandCenter/DOMTimelineChart.tsx` first to match the existing chart styling (slate grid, tooltip, container sizing). UI verified by typecheck/lint/build.

- [ ] **Step 1: Create `src/components/CommandCenter/CampaignTimelineChart.tsx`**

```tsx
/**
 * CampaignTimelineChart — the price-graph HERO for a property's full sale history.
 * Stepped sale-price line across campaigns with off-market GAPS (line breaks),
 * the current stitched-campaign window SHADED (the part counted toward True DOM),
 * event markers, and a lease lane. Fed by buildSaleChartSeries (already gated:
 * events are [] for anon, so this renders nothing for them — the page shows the
 * CampaignHistorySection teaser instead).
 */
"use client";

import React from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceArea, ReferenceDot,
} from "recharts";
import { Activity } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import { buildSaleChartSeries } from "@/lib/campaignHistory/timeline";
import type { CampaignEvent } from "@/lib/campaignHistory/types";

function fmtMonthYear(t: number): string {
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const MARKER_FILL: Record<string, string> = {
  "Listed for Sale": "#10b981", "Price Changed": "#f59e0b",
  Terminated: "#f43f5e", Expired: "#64748b", Sold: "#fbbf24",
};

export default function CampaignTimelineChart({
  events, trueDom, campaignCount, className,
}: {
  events: CampaignEvent[];
  trueDom: number | null;
  campaignCount: number;
  className?: string;
}) {
  const series = React.useMemo(() => buildSaleChartSeries(events, { nowMs: Date.now() }), [events]);
  if (series.points.length === 0) return null; // no sale trajectory (anon or lease-only)

  const data = series.points.map((p) => ({ t: p.t, price: p.price }));

  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-200">Price &amp; Listing Timeline</span>
        </div>
        <span className="text-xs text-slate-500">
          Listed {campaignCount}×{trueDom != null ? ` · True DOM ${trueDom}d` : ""}
        </span>
      </div>

      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 6 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} scale="time"
              tickFormatter={fmtMonthYear} tick={{ fill: "#64748b", fontSize: 10 }}
              tickLine={{ stroke: "#334155" }} axisLine={{ stroke: "#334155" }} />
            <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={{ stroke: "#334155" }}
              axisLine={{ stroke: "#334155" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              domain={["dataMin - 50000", "dataMax + 50000"]} />
            <Tooltip
              labelFormatter={(t) => new Date(Number(t)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              formatter={(v: number) => [v ? formatPrice(v) : "—", "List price"]}
              contentStyle={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 6, fontSize: 12 }} />
            {series.stitchStartT != null && series.stitchEndT != null && (
              <ReferenceArea x1={series.stitchStartT} x2={series.stitchEndT} fill="#0891b2" fillOpacity={0.12}
                stroke="#0891b2" strokeOpacity={0.3} />
            )}
            <Line type="stepAfter" dataKey="price" stroke="#94a3b8" strokeWidth={2} dot={false}
              connectNulls={false} isAnimationActive={false} />
            {series.markers.map((m, i) => (
              <ReferenceDot key={i} x={m.t} y={m.price} r={4}
                fill={MARKER_FILL[m.kind] ?? "#94a3b8"} stroke="#0f172a" strokeWidth={1} isFront />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#10b981" }} />Listed</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} />Price change</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "#f43f5e" }} />Off-market</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: "#0891b2", opacity: 0.4 }} />Current campaign (True DOM)</span>
        {series.leasePeriods.length > 0 && <span className="text-sky-400">{series.leasePeriods.length} lease period{series.leasePeriods.length > 1 ? "s" : ""}</span>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm run lint`
Expected: PASS (0 new issues).

```bash
git add src/components/CommandCenter/CampaignTimelineChart.tsx
git commit -m "$(cat <<'EOF'
feat(true-dom): CampaignTimelineChart price-graph hero (gaps + stitched-window shading)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire into the listing page

**Files:**
- Modify: `src/app/(app)/properties/[id]/page.tsx`

READ the existing render block (the `DOMTimelineChart` + `SaleHistorySection` usage around lines 455-465) before editing. `view.campaignHistory` (gated) already exists on the page from Phase 2b.

- [ ] **Step 1: Add imports (top of file)**
```ts
import CampaignTimelineChart from "@/components/CommandCenter/CampaignTimelineChart";
import CampaignHistorySection from "@/components/Property/CampaignHistorySection";
```

- [ ] **Step 2: Render the hero + table from `view.campaignHistory`**

Locate the existing `<DOMTimelineChart … />` block. Insert the campaign hero ABOVE it (the hero is primary when there's campaign history), and add the campaign table near the existing `<SaleHistorySection … />`. Use this exact pattern (authed users with a sale trajectory get the rich hero; otherwise the existing `DOMTimelineChart` stays as the fallback):

```tsx
              {isAuthed && view.campaignHistory.events.length > 0 ? (
                <CampaignTimelineChart
                  events={view.campaignHistory.events}
                  trueDom={view.campaignHistory.trueDom}
                  campaignCount={view.campaignHistory.campaignCount}
                />
              ) : (
                <DOMTimelineChart
                  currentPrice={price}
                  originalPrice={view.priceTimeline.originalPrice ?? undefined}
                  priceDrop={view.priceTimeline.totalPriceDrop}
                  dom={trueDom}
                  saleMarkers={saleMarkers}
                />
              )}
```

And add the campaign table right after the existing `<SaleHistorySection … />` line:
```tsx
              <CampaignHistorySection campaignHistory={view.campaignHistory} isAuthed={isAuthed} />
```

(Leave `SaleHistorySection` in place — it shows sold-only comps; `CampaignHistorySection` shows the full campaign timeline. They are complementary. If during manual review they feel redundant, that's a follow-up trim, not part of this task.)

- [ ] **Step 3: Build verification (the real UI gate)**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: typecheck clean; lint 0 new issues; **`npm run build` succeeds** (Next compiles the new client components + the page). Report any build error verbatim and fix it.

- [ ] **Step 4: Manual smoke (report; don't block commit on prod data)**

If you can run `npm run dev`: open a listing for a relisted property while signed in and confirm the Price & Listing Timeline hero renders with the shaded current-campaign window + markers, and the Listing History table lists the campaigns; sign out and confirm the table shows the blurred "Listed N×" teaser and the chart falls back to the simple DOM timeline. If you cannot run dev/authenticate locally, say so and rely on typecheck/lint/build.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/properties/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(true-dom): render campaign timeline hero + history table on the listing page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (author)

- Spec coverage: §9 price-graph hero (trajectory + gaps + stitched-window shading + lease lane) → `buildSaleChartSeries` + `CampaignTimelineChart`; §9 event table → `buildEventRows` + `CampaignHistorySection`; §10 gating → both components key off the already-gated `view.campaignHistory` (anon `events: []` → hero returns null, table shows teaser).
- Type consistency: `buildEventRows`/`buildSaleChartSeries` consume `CampaignEvent[]`; components consume `CampaignHistoryView` (Phase 2b) + the timeline transforms; `currentStitchedSaleSpan` is shared by the engine + the chart (no stitch-logic drift).
- Risk: the only logic change to shipped code is the behavior-preserving `trueDom.ts` refactor (guarded by its 12 existing tests). Everything else is additive (new files + page render).

## What's next (after Phase 3)
- **Phase 2c** (operational): nightly `sync.ts` rewire + warm-pass + Typesense `TrueDom` reindex (prod/feed-volume → user go-ahead) so the terminal/map True DOM is corrected too.
- Integrate the branch (merge/PR) once the user is ready.
```
