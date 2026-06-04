# Terminal: Status Badges + Gated Sold Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the terminal from silently mixing conditionally-sold/dead listings into the for-sale browse (Phase 1: badge them), and add a HouseSigma-style gated "Sold" comps mode with a time window (Phase 2).

**Architecture:** Phase 1 is a pure display change — `ListingCardBody` reads the already-populated `Status` field and renders a badge. Phase 2 adds a third state to the transaction strip (`For Sale · Sold · For Rent`); selecting **Sold** switches the page's data source from the client-side `searchListings` (public `properties` collection) to the **server-only** gated `/api/market/activity/sold` route (admin key, `sold_listings` collection), passing the map viewport as a polygon. Sold rows are adapted to `ListingDocument` so the existing map + ledger + popup render them unchanged, with `ListingCardBody` branching to a sold layout (sold price, over/under-ask, sold date). Anonymous users get a count-only teaser via the existing `VowGateOverlay`.

**Tech Stack:** Next.js (App Router), TypeScript, Zustand, Typesense, Tailwind, Vitest (node env — pure-logic tests only; UI verified via typecheck/lint/build per repo convention).

**Spec:** `docs/superpowers/specs/2026-06-03-terminal-sold-mode-and-status-badges-design.md`

**Scope note (Sold mode v1):** the Sold strip + time-window dropdown + map/list of recent solds for the current viewport, gated. The price/beds/baths/type/persona chips are **hidden** in Sold mode for v1 (the sold route doesn't take a price range, and wiring the rest is a clean follow-up — Phase 2.1). This matches the reference screenshots (a "Sold" toggle + a window dropdown) and avoids shipping inert controls.

**Commands:**
- Single test file: `npx vitest run <path>`
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`
- Build: `npm run build`

---

## PHASE 1 — Listing-status badges (no gate, no reindex, independently shippable)

### Task 1: `statusBadge()` pure helper

**Files:**
- Create: `src/lib/listings/statusBadge.ts`
- Test: `src/lib/listings/statusBadge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/listings/statusBadge.test.ts
import { describe, it, expect } from "vitest";
import { statusBadge } from "./statusBadge";

describe("statusBadge", () => {
  it("returns null for plain-active statuses (no badge needed)", () => {
    for (const s of ["New", "Price Change", "Extension", "Active", "", undefined]) {
      expect(statusBadge(s)).toBeNull();
    }
  });

  it("flags conditionally-sold listings (amber)", () => {
    expect(statusBadge("Sold Conditional")).toEqual({ label: "Sold Cond.", tone: "warn" });
    expect(statusBadge("Sold Conditional Escape")).toEqual({ label: "Sold Cond.", tone: "warn" });
  });

  it("flags conditionally-leased listings (amber)", () => {
    expect(statusBadge("Leased Conditional")).toEqual({ label: "Leased Cond.", tone: "warn" });
    expect(statusBadge("Leased Conditional Escape")).toEqual({ label: "Leased Cond.", tone: "warn" });
  });

  it("flags back-on-market listings (info)", () => {
    expect(statusBadge("Deal Fell Through")).toEqual({ label: "Back on Market", tone: "info" });
  });

  it("passes through any other non-active status verbatim (neutral)", () => {
    expect(statusBadge("Suspended")).toEqual({ label: "Suspended", tone: "neutral" });
  });

  it("is case/space tolerant", () => {
    expect(statusBadge("  sold conditional  ")).toEqual({ label: "Sold Cond.", tone: "warn" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/listings/statusBadge.test.ts`
Expected: FAIL — `statusBadge` is not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/listings/statusBadge.ts
/**
 * Maps a TRREB `Status` (MlsStatus, per transformer.ts:980) to a small badge for
 * the active-browse card. Plain-active statuses return null (the For Sale/Lease chip
 * already conveys availability). Conditional-sale / conditional-lease / dead statuses
 * leak into the active `properties` collection because they are still
 * StandardStatus=Active in the IDX feed (verified: ~2,424 "Sold Conditional" live on
 * 2026-06-03), so we surface their real status instead of hiding them.
 *
 * IDX display only — no VOW data, no close price. Tone drives the chip colour.
 */
export type BadgeTone = "warn" | "info" | "neutral";

export interface StatusBadge {
  label: string;
  tone: BadgeTone;
}

const PLAIN_ACTIVE = new Set(["new", "price change", "extension", "active", ""]);

export function statusBadge(status: string | undefined | null): StatusBadge | null {
  const s = (status ?? "").toLowerCase().trim();
  if (PLAIN_ACTIVE.has(s)) return null;
  if (s.startsWith("sold conditional")) return { label: "Sold Cond.", tone: "warn" };
  if (s.startsWith("leased conditional")) return { label: "Leased Cond.", tone: "warn" };
  if (s === "deal fell through") return { label: "Back on Market", tone: "info" };
  // Forward-compatible: show any other non-active status verbatim, Title-Cased.
  const label = (status ?? "").trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  return { label, tone: "neutral" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/listings/statusBadge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/listings/statusBadge.ts src/lib/listings/statusBadge.test.ts
git commit -m "feat(terminal): statusBadge helper for conditional/dead listing statuses"
```

---

### Task 2: Render the status badge in `ListingCardBody`

**Files:**
- Modify: `src/components/CommandCenter/ListingCardBody.tsx`

- [ ] **Step 1: Add the import** (top of file, after the existing `cn` import on line 15)

```ts
import { statusBadge, type BadgeTone } from "@/lib/listings/statusBadge";
```

- [ ] **Step 2: Add a tone→class map** (module scope, after the imports)

```ts
const BADGE_TONE: Record<BadgeTone, string> = {
  warn: "bg-amber-500/15 text-amber-300",
  info: "bg-sky-500/15 text-sky-300",
  neutral: "bg-slate-500/15 text-slate-300",
};
```

- [ ] **Step 3: Render the badge in the chip row.** Compute the badge *after* the `chips` array is built (after line 56), so `addr`/`chips`/`type`/`badge` are all in scope for both this layout and the Task 12 sold branch:

```ts
const badge = statusBadge(doc.Status);
```

Then update the chip row so the badge sits left of the freshness, and the row shows whenever a transaction chip, badge, or age exists. Replace the block currently at lines 61-75 with:

```tsx
{(doc.TransactionType || badge || age !== null) && (
  <div className="flex items-center gap-1.5 text-[10px]">
    {doc.TransactionType && (
      <span
        className={cn(
          "shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide",
          /lease/i.test(doc.TransactionType) ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
        )}
      >
        {doc.TransactionType}
      </span>
    )}
    {badge && (
      <span
        className={cn(
          "shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide",
          BADGE_TONE[badge.tone]
        )}
      >
        {badge.label}
      </span>
    )}
    {age !== null && <span className="text-slate-500">{age === 0 ? "today" : `${age}d ago`}</span>}
  </div>
)}
```

- [ ] **Step 4: Verify typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`doc.Status` already exists on `ListingDocument`, `src/lib/typesense/client.ts:179`.)

- [ ] **Step 5: Manual check**

Run `npm run dev`, open `/properties`, search a hot market (e.g. Brampton). Expected: some cards now show an amber "Sold Cond." chip beside the green "For Sale" chip.

- [ ] **Step 6: Commit**

```bash
git add src/components/CommandCenter/ListingCardBody.tsx
git commit -m "feat(terminal): badge conditional/dead listing statuses on the card"
```

**✅ Phase 1 complete — shippable on its own.**

---

## PHASE 2 — Gated Sold mode

### Task 3: Sold display config (configurable window cap)

**Files:**
- Create: `src/lib/sold/config.ts`
- Test: `src/lib/sold/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sold/config.test.ts
import { describe, it, expect } from "vitest";
import { SOLD_DISPLAY_MAX_DAYS, SOLD_WINDOW_OPTIONS, clampWindowDays } from "./config";

describe("sold config", () => {
  it("defaults the cap to 180 days", () => {
    expect(SOLD_DISPLAY_MAX_DAYS).toBe(180);
  });

  it("only offers window options within the cap", () => {
    expect(SOLD_WINDOW_OPTIONS.every((d) => d <= SOLD_DISPLAY_MAX_DAYS)).toBe(true);
    expect(SOLD_WINDOW_OPTIONS).toContain(90);
    expect(SOLD_WINDOW_OPTIONS).toContain(180);
  });

  it("clamps a requested window to [1, cap]", () => {
    expect(clampWindowDays(9999)).toBe(SOLD_DISPLAY_MAX_DAYS);
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(-5)).toBe(1);
    expect(clampWindowDays(90)).toBe(90);
    expect(clampWindowDays(Number.NaN)).toBe(SOLD_DISPLAY_MAX_DAYS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sold/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sold/config.ts
/**
 * Sold-comp display window. The 180-day cap is an ENGINEERING limit (the
 * `sold_listings` Typesense collection holds a rolling 180-day window — see
 * soldListingsSchema.ts). It is NOT a legal limit: neither TRREB agreement
 * (.claude/docs/legal/*.pdf) specifies a display duration; the binding rules live
 * in the un-repo'd "VOW Policy and Rules". Raising this beyond 180 also requires a
 * data-path change (read older comps from raw_vow_sold) — see the spec §6. Override
 * via env once the licensed window is confirmed with the Broker-of-Record / PROPTX.
 */
export const SOLD_DISPLAY_MAX_DAYS: number = (() => {
  const raw = Number(process.env.NEXT_PUBLIC_SOLD_DISPLAY_MAX_DAYS);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 180) : 180;
})();

/** Time-window dropdown options (days), filtered to the active cap. Default selection = max. */
export const SOLD_WINDOW_OPTIONS: number[] = [1, 3, 7, 30, 90, 180].filter(
  (d) => d <= SOLD_DISPLAY_MAX_DAYS
);

/** Clamp a requested window to [1, cap]; non-finite falls back to the cap. */
export function clampWindowDays(days: number): number {
  if (!Number.isFinite(days)) return SOLD_DISPLAY_MAX_DAYS;
  return Math.min(SOLD_DISPLAY_MAX_DAYS, Math.max(1, Math.floor(days)));
}
```

> Note: the env override is capped at 180 here because the `sold_listings` collection cannot serve more than 180 days yet. When the multi-year `raw_vow_sold` path lands (spec §6), remove the inner `Math.min(raw, 180)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sold/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/config.ts src/lib/sold/config.test.ts
git commit -m "feat(sold): configurable sold-display window cap (default 180d)"
```

---

### Task 4: Sold-vs-ask delta util (the §10 differentiator)

**Files:**
- Create: `src/lib/sold/delta.ts`
- Test: `src/lib/sold/delta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sold/delta.test.ts
import { describe, it, expect } from "vitest";
import { soldVsAsk } from "./delta";

describe("soldVsAsk", () => {
  it("returns null when ask is missing or non-positive", () => {
    expect(soldVsAsk(900000, null)).toBeNull();
    expect(soldVsAsk(900000, 0)).toBeNull();
    expect(soldVsAsk(900000, undefined)).toBeNull();
  });

  it("computes an over-ask sale", () => {
    expect(soldVsAsk(1_100_000, 1_000_000)).toEqual({ deltaAbs: 100_000, deltaPct: 10, direction: "over" });
  });

  it("computes an under-ask sale", () => {
    expect(soldVsAsk(950_000, 1_000_000)).toEqual({ deltaAbs: -50_000, deltaPct: -5, direction: "under" });
  });

  it("computes an at-ask sale", () => {
    expect(soldVsAsk(1_000_000, 1_000_000)).toEqual({ deltaAbs: 0, deltaPct: 0, direction: "at" });
  });

  it("rounds the percentage to one decimal", () => {
    expect(soldVsAsk(1_033_300, 1_000_000)?.deltaPct).toBe(3.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sold/delta.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sold/delta.ts
/** Close-vs-ask: how far a sold price landed over/under the (last) list price. */
export interface SoldDelta {
  deltaAbs: number; // closePrice - listPrice (signed dollars)
  deltaPct: number; // signed %, one decimal
  direction: "over" | "under" | "at";
}

export function soldVsAsk(
  closePrice: number,
  listPrice: number | null | undefined
): SoldDelta | null {
  if (!listPrice || listPrice <= 0 || !Number.isFinite(closePrice)) return null;
  const deltaAbs = closePrice - listPrice;
  const deltaPct = Math.round((deltaAbs / listPrice) * 1000) / 10;
  const direction = deltaAbs > 0 ? "over" : deltaAbs < 0 ? "under" : "at";
  return { deltaAbs, deltaPct, direction };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sold/delta.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/delta.ts src/lib/sold/delta.test.ts
git commit -m "feat(sold): close-vs-ask delta util"
```

---

### Task 5: Extend the sold route — return coordinates + use the configurable cap

**Files:**
- Create: `src/app/api/market/activity/sold/soldMapper.ts`
- Modify: `src/app/api/market/activity/sold/route.ts`
- Test: `src/app/api/market/activity/sold/soldMapper.test.ts`

The route drops `location` (no map coords), hardcodes `MAX_WINDOW_DAYS = 180`, and defines `SoldListing` + the inline doc map inside the route module (so a node-env test of it would pull in `next/server`). Extract the type + mapper into a pure sibling `soldMapper.ts`, add `lat`/`lng`, and source the cap from config. The route **re-exports** `SoldListing` for back-compat (`MarketActivityPanel.tsx:8` imports it from the route).

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/market/activity/sold/soldMapper.test.ts
import { describe, it, expect } from "vitest";
import { mapSoldDoc } from "./soldMapper";

describe("mapSoldDoc", () => {
  it("maps a sold doc and splits the geopoint into lat/lng", () => {
    const out = mapSoldDoc({
      id: "W123",
      UnparsedAddress: "1 King St, Toronto, ON",
      ClosePrice: 950000,
      ListPrice: 999000,
      PurchaseContractDate: 1_716_000_000_000,
      PropertySubType: "Detached",
      BedroomsTotal: 3,
      BathroomsTotalInteger: 2,
      BuildingAreaTotal: 1500,
      ListOfficeName: "ACME REALTY",
      City: "Toronto",
      primaryImageUrl: "https://img/x.jpg",
      location: [43.65, -79.38],
    });
    expect(out.id).toBe("W123");
    expect(out.closePrice).toBe(950000);
    expect(out.listPrice).toBe(999000);
    expect(out.lat).toBe(43.65);
    expect(out.lng).toBe(-79.38);
    expect(out.soldDate).toBe(new Date(1_716_000_000_000).toISOString());
  });

  it("yields null coords when the geopoint is absent", () => {
    const out = mapSoldDoc({ id: "X1", ClosePrice: 500000, PurchaseContractDate: 0 });
    expect(out.lat).toBeNull();
    expect(out.lng).toBeNull();
    expect(out.soldDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/market/activity/sold/soldMapper.test.ts`
Expected: FAIL — module `./soldMapper` not found.

- [ ] **Step 3: Create the pure mapper, then rewire the route**

Create `src/app/api/market/activity/sold/soldMapper.ts`:

```ts
// src/app/api/market/activity/sold/soldMapper.ts
/** Pure shape + mapper for sold rows — kept out of route.ts so node-env tests don't load next/server. */

export interface SoldListing {
  id: string;
  address: string;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  propertySubType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  brokerage: string | null;
  city: string | null;
  /** Best-fit thumbnail URL (selectPrimaryImage), null when no usable VOW media. */
  primaryImageUrl: string | null;
  /** Latitude/longitude for map pins; null when the postal code didn't resolve. */
  lat: number | null;
  lng: number | null;
}

export const posOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Map a raw `sold_listings` document to the API's `SoldListing` shape. */
export function mapSoldDoc(d: Record<string, unknown>): SoldListing {
  const ms = Number(d.PurchaseContractDate);
  const loc = Array.isArray(d.location) ? (d.location as number[]) : null;
  return {
    id: String(d.id ?? ""),
    address: (d.UnparsedAddress as string) || "",
    closePrice: Number(d.ClosePrice) || 0,
    listPrice: posOrNull(d.ListPrice),
    soldDate: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
    propertySubType: (d.PropertySubType as string) || null,
    beds: posOrNull(d.BedroomsTotal),
    baths: posOrNull(d.BathroomsTotalInteger),
    sqft: posOrNull(d.BuildingAreaTotal),
    brokerage: (d.ListOfficeName as string) || null,
    city: (d.City as string) || null,
    primaryImageUrl: (d.primaryImageUrl as string) || null,
    lat: loc && Number.isFinite(loc[0]) ? loc[0] : null,
    lng: loc && Number.isFinite(loc[1]) ? loc[1] : null,
  };
}
```

Then edit `src/app/api/market/activity/sold/route.ts`:

(a) After line 31 (`import { getConsumer } ...`), add:

```ts
import { SOLD_DISPLAY_MAX_DAYS } from "@/lib/sold/config";
import { mapSoldDoc, type SoldListing } from "./soldMapper";

// Re-export so existing importers (MarketActivityPanel.tsx) keep resolving it here.
export type { SoldListing } from "./soldMapper";
```

(b) Replace `const MAX_WINDOW_DAYS = 180;` (line 35) with:

```ts
const MAX_WINDOW_DAYS = SOLD_DISPLAY_MAX_DAYS;
```

(c) Delete the now-duplicated declarations in route.ts:
- the whole `export interface SoldListing { ... }` block (lines 85-99),
- the `const posOrNull = ...` helper (lines 157-160).

(d) Replace the inline `.map(...)` body inside `computeSold` (lines 179-196) with:

```ts
  const listings: SoldListing[] = (res.hits ?? []).map((h) => mapSoldDoc(h.document as Record<string, unknown>));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/market/activity/sold/soldMapper.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the existing dashboard sold tests still pass + typecheck**

Run: `npx vitest run src/app/api/market/activity && npx tsc --noEmit`
Expected: PASS / no errors. (The dashboard `MarketActivityPanel` ignores the new `lat`/`lng` fields — additive change.)

- [ ] **Step 6: Commit**

```bash
git add src/app/api/market/activity/sold/soldMapper.ts src/app/api/market/activity/sold/route.ts src/app/api/market/activity/sold/soldMapper.test.ts
git commit -m "feat(sold): extract pure sold mapper with coords + configurable cap"
```

---

### Task 6: Store — listing mode, sold window, locked state

**Files:**
- Modify: `src/lib/stores/commandCenterStore.ts`

- [ ] **Step 1: Add the import** (after line 16, the fundamentals import):

```ts
import { SOLD_DISPLAY_MAX_DAYS } from "@/lib/sold/config";
```

- [ ] **Step 2: Add a `ListingMode` type** (after line 20, the `CommuteMode` export):

```ts
/** Transaction strip: active sale / sold comps / active lease. `sold` switches data source. */
export type ListingMode = "sale" | "sold" | "rent";
```

- [ ] **Step 3: Declare the interface members.** In `CommandCenterState`, right after the `transactionMode`/`setTransactionMode` pair (after line 101):

```ts
  // Listing mode — the three-state strip (For Sale / Sold / For Rent). `sale`/`rent`
  // mirror transactionMode (active path); `sold` switches to the gated sold route.
  listingMode: ListingMode;
  setListingMode: (mode: ListingMode) => void;
  // Sold-comp window (days) + the anonymous gate flag for the teaser overlay.
  soldWindowDays: number;
  setSoldWindowDays: (days: number) => void;
  soldLocked: boolean;
  setSoldLocked: (locked: boolean) => void;
```

- [ ] **Step 4: Implement them.** In the store body, right after the `setTransactionMode` implementation (after line 240, before `propertyClass: "residential"`):

```ts
  listingMode: "sale",
  // sale/rent mirror transactionMode (+ reset price bounds, like setTransactionMode);
  // sold pins transactionMode to "sale" so the sale price config + class axis stay valid.
  setListingMode: (mode) =>
    set((state) => {
      const tx = mode === "rent" ? "rent" : "sale";
      const { min, max } = priceConfig(tx);
      return {
        listingMode: mode,
        transactionMode: tx,
        universalFilters: { ...state.universalFilters, price: [min, max] },
      };
    }),
  soldWindowDays: SOLD_DISPLAY_MAX_DAYS,
  setSoldWindowDays: (days) => set({ soldWindowDays: days }),
  soldLocked: false,
  setSoldLocked: (locked) => set({ soldLocked: locked }),
```

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/commandCenterStore.ts
git commit -m "feat(terminal): listingMode + sold window/locked store state"
```

---

### Task 7: Adapter — `SoldListing` → `ListingDocument`

**Files:**
- Modify: `src/lib/typesense/client.ts` (add 2 optional fields to `ListingDocument`)
- Create: `src/lib/sold/adapter.ts`
- Test: `src/lib/sold/adapter.test.ts`

- [ ] **Step 1: Add optional sold fields to `ListingDocument`.** In `src/lib/typesense/client.ts`, inside `interface ListingDocument`, after the `Status?: string;` / `DaysOnMarket?` block (around line 180):

```ts
  // ─── Sold-comp overlay (set only by the sold adapter; see src/lib/sold/adapter.ts) ─
  /** True when this doc is an adapted VOW sold comp, not an active IDX listing. */
  IsSoldComp?: boolean;
  /** Sold ("purchase contract") date as ISO string — sold comps only. */
  SoldDate?: string;
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/sold/adapter.test.ts
import { describe, it, expect } from "vitest";
import { soldToListingDocument } from "./adapter";
import type { SoldListing } from "@/app/api/market/activity/sold/route";

const base: SoldListing = {
  id: "W123",
  address: "1 King St, Toronto, ON",
  closePrice: 950000,
  listPrice: 999000,
  soldDate: "2026-05-20T00:00:00.000Z",
  propertySubType: "Detached",
  beds: 3,
  baths: 2,
  sqft: 1500,
  brokerage: "ACME REALTY",
  city: "Toronto",
  primaryImageUrl: "https://img/x.jpg",
  lat: 43.65,
  lng: -79.38,
};

describe("soldToListingDocument", () => {
  it("maps close price to ListPrice (pin/card price) and ask to OriginalListPrice", () => {
    const d = soldToListingDocument(base);
    expect(d.ListPrice).toBe(950000);
    expect(d.OriginalListPrice).toBe(999000);
  });

  it("flags the doc as a sold comp and carries the sold date", () => {
    const d = soldToListingDocument(base);
    expect(d.IsSoldComp).toBe(true);
    expect(d.SoldDate).toBe("2026-05-20T00:00:00.000Z");
  });

  it("uses [lat, lng] for location when coords exist", () => {
    expect(soldToListingDocument(base).location).toEqual([43.65, -79.38]);
  });

  it("falls back to [0, 0] when coords are missing (filtered out by the map)", () => {
    const d = soldToListingDocument({ ...base, lat: null, lng: null });
    expect(d.location).toEqual([0, 0]);
  });

  it("carries brokerage + thumbnail for the card", () => {
    const d = soldToListingDocument(base);
    expect(d.ListOfficeName).toBe("ACME REALTY");
    expect(d.primaryImageUrl).toBe("https://img/x.jpg");
    expect(d.thumbnailUrl).toBe("https://img/x.jpg");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/sold/adapter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/sold/adapter.ts
/**
 * Adapt a VOW `SoldListing` (server sold route) into the `ListingDocument` shape the
 * terminal's map + ledger + popup already render. We reuse those surfaces rather than
 * build parallel ones; `ListingCardBody` branches on `IsSoldComp` to show the sold
 * layout (sold price, over/under-ask, sold date). ListPrice carries the SOLD price so
 * the map pin shows what it sold for; OriginalListPrice carries the ask for the delta.
 */
import type { ListingDocument } from "@/lib/typesense/client";
import type { SoldListing } from "@/app/api/market/activity/sold/route";

export function soldToListingDocument(s: SoldListing): ListingDocument {
  const hasCoords = s.lat != null && s.lng != null;
  return {
    id: s.id,
    ListPrice: s.closePrice,
    OriginalListPrice: s.listPrice ?? undefined,
    UnparsedAddress: s.address || undefined,
    City: s.city ?? undefined,
    PropertySubType: s.propertySubType ?? undefined,
    BedroomsTotal: s.beds ?? undefined,
    BathroomsTotalInteger: s.baths ?? undefined,
    BuildingAreaTotal: s.sqft ?? undefined,
    ListOfficeName: s.brokerage ?? undefined,
    primaryImageUrl: s.primaryImageUrl ?? undefined,
    thumbnailUrl: s.primaryImageUrl ?? undefined,
    // [lat, lng] per ListingDocument.location; [0,0] for ungeocoded rows (map filters them).
    location: hasCoords ? [s.lat as number, s.lng as number] : [0, 0],
    IsSoldComp: true,
    SoldDate: s.soldDate ?? undefined,
    // Discriminators consumed by render paths; sold comps carry no active-only metrics.
    isDistressed: false,
    hasSecondarySuitePotential: false,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/sold/adapter.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/typesense/client.ts src/lib/sold/adapter.ts src/lib/sold/adapter.test.ts
git commit -m "feat(sold): adapt SoldListing to ListingDocument for shared rendering"
```

---

### Task 8: Sold fetch helper + query builder

**Files:**
- Create: `src/lib/sold/fetchSoldComps.ts`
- Test: `src/lib/sold/buildSoldQuery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sold/buildSoldQuery.test.ts
import { describe, it, expect } from "vitest";
import { buildSoldQuery } from "./fetchSoldComps";

describe("buildSoldQuery", () => {
  it("uses the viewport as a 4-corner polygon (lat,lng pairs) when bounds exist", () => {
    const qs = buildSoldQuery({
      mapBounds: { north: 44, south: 43, east: -79, west: -80 },
      location: "Toronto",
      windowDays: 90,
      limit: 100,
    });
    const p = new URLSearchParams(qs);
    // S,W, S,E, N,E, N,W
    expect(p.get("polygon")).toBe("43,-80,43,-79,44,-79,44,-80");
    expect(p.get("windowDays")).toBe("90");
    expect(p.get("limit")).toBe("100");
    expect(p.get("region")).toBeNull();
  });

  it("falls back to region=location when no bounds", () => {
    const qs = buildSoldQuery({ mapBounds: null, location: "Brampton", windowDays: 180, limit: 100 });
    const p = new URLSearchParams(qs);
    expect(p.get("region")).toBe("Brampton");
    expect(p.get("polygon")).toBeNull();
  });

  it("clamps the window to the cap", () => {
    const qs = buildSoldQuery({ mapBounds: null, location: "Ajax", windowDays: 9999, limit: 100 });
    expect(new URLSearchParams(qs).get("windowDays")).toBe("180");
  });

  it("returns an empty string when there is neither bounds nor location", () => {
    expect(buildSoldQuery({ mapBounds: null, location: "", windowDays: 90, limit: 100 })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/sold/buildSoldQuery.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/sold/fetchSoldComps.ts
/**
 * Client-side fetch of gated sold comps for the terminal. Builds the query for the
 * server-only /api/market/activity/sold route (viewport → polygon, else region), then
 * adapts the rows to ListingDocument for the shared map + ledger renderers. The route
 * applies the VOW gate: anonymous callers get { count, listings: [], locked: true }.
 */
import type { MapBounds } from "@/lib/stores/commandCenterStore";
import type { ListingDocument } from "@/lib/typesense/client";
import type { SoldListing } from "@/app/api/market/activity/sold/route";
import { soldToListingDocument } from "./adapter";
import { clampWindowDays } from "./config";

export interface SoldQueryArgs {
  mapBounds: MapBounds | null;
  location: string;
  windowDays: number;
  limit: number;
}

/** Build the route query string. Empty string = no area resolvable (caller shows empty state). */
export function buildSoldQuery({ mapBounds, location, windowDays, limit }: SoldQueryArgs): string {
  const p = new URLSearchParams();
  if (mapBounds) {
    const { north: N, south: S, east: E, west: W } = mapBounds;
    p.set("polygon", `${S},${W},${S},${E},${N},${E},${N},${W}`);
  } else if (location.trim()) {
    p.set("region", location.trim());
  } else {
    return "";
  }
  p.set("windowDays", String(clampWindowDays(windowDays)));
  p.set("limit", String(limit));
  return p.toString();
}

export interface SoldCompsResult {
  docs: ListingDocument[];
  count: number;
  locked: boolean;
}

export async function fetchSoldComps(args: SoldQueryArgs): Promise<SoldCompsResult> {
  const qs = buildSoldQuery(args);
  if (!qs) return { docs: [], count: 0, locked: false };
  const res = await fetch(`/api/market/activity/sold?${qs}`);
  if (!res.ok) throw new Error(`sold fetch failed: ${res.status}`);
  const data = (await res.json()) as { count?: number; listings?: SoldListing[]; locked?: boolean };
  return {
    docs: (data.listings ?? []).map(soldToListingDocument),
    count: data.count ?? 0,
    locked: !!data.locked,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/sold/buildSoldQuery.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/fetchSoldComps.ts src/lib/sold/buildSoldQuery.test.ts
git commit -m "feat(sold): client fetch + viewport→polygon query builder"
```

---

### Task 9: FilterBar — three-state strip + window dropdown

**Files:**
- Create: `src/components/CommandCenter/SoldWindowDropdown.tsx`
- Modify: `src/components/CommandCenter/FilterBar.tsx`

- [ ] **Step 1: Create the window dropdown**

```tsx
// src/components/CommandCenter/SoldWindowDropdown.tsx
"use client";

import React from "react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { SOLD_WINDOW_OPTIONS } from "@/lib/sold/config";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const fmt = (d: number) => (d === 1 ? "Last 1 day" : `Last ${d} days`);

/** Time-window picker shown only in Sold mode (mirrors the HouseSigma "90d" control). */
export default function SoldWindowDropdown() {
  const { soldWindowDays, setSoldWindowDays } = useCommandCenterStore();
  return (
    <label className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-400`}>
      <span className="sr-only">Sold window</span>
      <select
        value={soldWindowDays}
        onChange={(e) => setSoldWindowDays(Number(e.target.value))}
        className="border border-slate-800 bg-slate-900 px-2 py-1.5 text-cyan-300 focus:border-cyan-500/50 focus:outline-none"
      >
        {SOLD_WINDOW_OPTIONS.map((d) => (
          <option key={d} value={d}>
            {fmt(d)}
          </option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Wire the strip in FilterBar.** In `src/components/CommandCenter/FilterBar.tsx`:

(a) Add import (after line 13, the `InvestorChip` import):

```ts
import SoldWindowDropdown from "./SoldWindowDropdown";
```

(b) Fix the destructure (lines 33-49): keep `transactionMode` (still used for the price config + investor check), **remove** `setTransactionMode`, and add the two listing-mode fields:

```ts
    transactionMode,
    listingMode,
    setListingMode,
```

(c) Gate the investor layer off in sold mode. Replace line 55:

```ts
  const investorLayer = listingMode !== "sold" && isInvestorLayerActive(transactionMode, propertyClass);
```

(d) Replace the **entire** `return ( ... )` JSX (lines 93-195) with this — the three-state strip + window dropdown, and the rest of the bar wrapped in a non-sold guard:

```tsx
  return (
    <div className="no-scrollbar flex h-11 items-center gap-x-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-3">
      {/* Listing-status strip — For Sale / Sold / For Rent (Sold switches data source). */}
      <FundamentalToggle
        ariaLabel="Listing status"
        value={listingMode}
        onChange={setListingMode}
        options={[
          { value: "sale", label: "For Sale" },
          { value: "sold", label: "Sold" },
          { value: "rent", label: "For Rent" },
        ]}
      />
      {listingMode === "sold" && <SoldWindowDropdown />}

      {/* Everything else is the active-browse bar — hidden in Sold mode (v1). */}
      {listingMode !== "sold" && (
        <>
          <FundamentalToggle
            ariaLabel="Property class"
            value={propertyClass}
            onChange={setPropertyClass}
            options={[
              { value: "residential", label: "Residential" },
              { value: "commercial", label: "Commercial" },
            ]}
          />
          <div className="h-5 w-px shrink-0 bg-slate-800" />

          {/* Persona preset — residential-sale only (rent/commercial = basic browse). */}
          {investorLayer && (
            <>
              <PresetChip />
              <div className="h-5 w-px shrink-0 bg-slate-800" />
            </>
          )}

          {CORE_FILTERS.map((def) => {
            const useDef =
              def.key === "homeType" ? scopedTypeDef : def.key === "price" ? scopedPriceDef : def;
            return (
              <FilterChip
                key={def.key}
                def={useDef}
                value={universalFilters[def.key] ?? useDef.defaultValue}
                onChange={(v) => setUniversalFilter(def.key, v)}
                onClear={() => setUniversalFilter(def.key, freshDefault(useDef.defaultValue))}
              />
            );
          })}

          {investorLayer && (
            <>
              <div className="h-5 w-px shrink-0 bg-slate-800" />
              {controls.map((c, i) => (
                <InvestorChip key={`${activePersona}-${i}`} control={c} />
              ))}
            </>
          )}

          {addedDefs.map((def) => (
            <FilterChip
              key={def.key}
              def={def}
              value={universalFilters[def.key] ?? def.defaultValue}
              onChange={(v) => setUniversalFilter(def.key, v)}
              onClear={() => {
                setUniversalFilter(def.key, freshDefault(def.defaultValue));
                removeAddedFilter(def.key);
              }}
            />
          ))}

          <Popover
            trigger={
              <span
                className={cn(
                  LABEL,
                  "flex shrink-0 cursor-pointer items-center gap-1 border border-dashed border-slate-700 px-2.5 py-1.5 text-slate-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
                )}
              >
                <Plus className="h-3 w-3" />
                Add filter
              </span>
            }
            className="p-2"
          >
            <AddFilterPalette />
          </Popover>
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2">
        {anyActive && listingMode !== "sold" && (
          <button
            onClick={clearAll}
            className={cn(
              LABEL,
              "flex items-center gap-1.5 border border-slate-700 px-2 py-1 text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            )}
          >
            Clear
            <RotateCcw className="h-3 w-3" />
          </button>
        )}
        <span className={cn(LABEL, nudge.overflowing ? "text-amber-400" : "text-slate-400")}>
          {nudge.text}
        </span>
      </div>
    </div>
  );
```

- [ ] **Step 3: Verify typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors. (If the JSX guard nesting trips the build, confirm the single `<>...</>` wraps exactly the class-axis → "+ Add filter" range and closes before `ml-auto`.)

- [ ] **Step 4: Commit**

```bash
git add src/components/CommandCenter/SoldWindowDropdown.tsx src/components/CommandCenter/FilterBar.tsx
git commit -m "feat(terminal): For Sale/Sold/For Rent strip + sold window dropdown"
```

---

### Task 10: page.tsx — branch the search on listing mode

**Files:**
- Modify: `src/app/properties/page.tsx`

- [ ] **Step 1: Add imports** (after line 35, `useBubbleHydration`):

```ts
import { fetchSoldComps } from "@/lib/sold/fetchSoldComps";
```

- [ ] **Step 2: Pull the new store fields.** In the destructure (lines 55-83), add after `propertyClass,`:

```ts
    listingMode,
    soldWindowDays,
    setSoldLocked,
```

- [ ] **Step 3: Branch `performSearch`.** At the very top of the `performSearch` callback body (right after `setIsLoading(true); setError(null);`, line 135), insert the sold branch:

```ts
      // ─── Sold mode: gated server route (sold_listings), NOT client Typesense ───
      if (listingMode === "sold") {
        try {
          const { docs, count, locked } = await fetchSoldComps({
            mapBounds,
            location,
            windowDays: soldWindowDays,
            limit: MAX_LISTINGS,
          });
          setSoldLocked(locked);
          setSearchResult({ listings: docs, totalFound: count, page: 1, perPage: MAX_LISTINGS, processingTimeMs: 0 });
          setTotalCount(count);
        } catch (err) {
          console.error("[CommandCenter] Sold search error:", err);
          setError(err instanceof Error ? err.message : "Sold comps temporarily unavailable.");
          setSearchResult(null);
        } finally {
          setIsLoading(false);
        }
        return;
      }
```

- [ ] **Step 4: Add the new deps** to the `performSearch` `useCallback` dependency array (line 204). Add `listingMode, soldWindowDays, setSoldLocked,`:

```ts
  }, [persona, filters, universalFilters, location, transactionMode, propertyClass, listingMode, soldWindowDays, setSoldLocked, commute.enabled, commute.polygon, school.enabled, school.level, school.system, school.minScore, school.targetSchool, colorBand, drawPolygon, mapBounds, setSearchResult, setIsLoading, setError, setTotalCount]);
```

- [ ] **Step 5: Add `listingMode` to the reset-bounds effect deps** (line 211) so switching INTO/OUT of sold reframes the zone:

```ts
  }, [location, activePersona, transactionMode, propertyClass, listingMode, commute.enabled, commute.polygon, school.enabled, school.targetSchool, setMapBounds]);
```

- [ ] **Step 6: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual check (signed-in)**

Run `npm run dev`, sign in (a terms-accepted account), open `/properties`, click **Sold**, set the window. Expected: recent solds appear as pins + ledger rows; panning the map re-queries. (Sold price shows on pins; full sold card comes in Task 12.)

- [ ] **Step 8: Commit**

```bash
git add src/app/properties/page.tsx
git commit -m "feat(terminal): route Sold mode to the gated sold-comps API"
```

---

### Task 11: Anonymous teaser — VowGateOverlay over map + ledger

**Files:**
- Modify: `src/app/properties/page.tsx`

When `soldLocked`, the server returned zero rows and a count. Blur nothing (there's nothing to blur) — overlay the lock + count on both panes.

- [ ] **Step 1: Add imports** (after the `fetchSoldComps` import from Task 10):

```ts
import VowGateOverlay from "@/components/auth/VowGateOverlay";
```

- [ ] **Step 2: Pull `soldLocked`** from the store destructure (add next to `listingMode`):

```ts
    soldLocked,
```

- [ ] **Step 3: Compute the lock flag + message** (after line 233, `const heatAggregation = ...`):

```ts
  const showSoldLock = listingMode === "sold" && soldLocked;
  const soldLockMsg = `${totalCount.toLocaleString()} recent sale${totalCount === 1 ? "" : "s"} — sign in to view`;
```

- [ ] **Step 4: Overlay the map.** Inside the map container `<div className="relative min-w-0 flex-1">` (line 241), add as the last child before its closing `</div>` (after the `SaveBubbleButton` block, line 266):

```tsx
          {showSoldLock && <VowGateOverlay message={soldLockMsg} />}
```

- [ ] **Step 5: Overlay the ledger.** Wrap the ledger container (lines 282-284) so the overlay can sit over it:

```tsx
        <div className="relative flex shrink-0 flex-col bg-slate-950" style={{ width: ledgerWidth }}>
          <LedgerPanel className="flex-1 min-h-0" />
          {showSoldLock && <VowGateOverlay message={soldLockMsg} />}
        </div>
```

- [ ] **Step 6: Verify typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 7: Manual check (signed-out)**

In a private window (logged out), open `/properties`, click **Sold**. Expected: both panes show the lock + "N recent sales — sign in to view"; no addresses/prices in the DOM (server stripped them).

- [ ] **Step 8: Commit**

```bash
git add src/app/properties/page.tsx
git commit -m "feat(terminal): anon teaser overlay for Sold mode (VowGateOverlay)"
```

---

### Task 12: Sold card layout in `ListingCardBody`

**Files:**
- Modify: `src/components/CommandCenter/ListingCardBody.tsx`

Render a sold layout (sold price + over/under-ask + sold date + §6.3 notice) when `doc.IsSoldComp`.

- [ ] **Step 1: Add imports** (next to the `statusBadge` import from Phase 1 Task 2):

```ts
import { soldVsAsk } from "@/lib/sold/delta";
```

- [ ] **Step 2: Add a sold layout branch.** At the very start of the component's `return`, before the active layout fragment, insert an early sold render. Right after the `const badge = statusBadge(doc.Status);` line (added in Task 2), add:

```ts
  if (doc.IsSoldComp) {
    const delta = soldVsAsk(doc.ListPrice, doc.OriginalListPrice ?? null);
    const soldOn = doc.SoldDate ? new Date(doc.SoldDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
    const deltaTone =
      delta?.direction === "over" ? "text-rose-300" : delta?.direction === "under" ? "text-emerald-300" : "text-slate-300";
    return (
      <>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className="shrink-0 rounded-sm bg-rose-500/15 px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide text-rose-300">
            Sold
          </span>
          {soldOn && <span className="text-slate-500">{soldOn}</span>}
        </div>
        <p className="mt-0.5 truncate font-sans text-base font-bold text-cyan-300">
          {doc.ListPrice ? `$${doc.ListPrice.toLocaleString()}` : "—"}
        </p>
        {delta && (
          <p className={cn("mt-0.5 font-mono text-xs font-semibold", deltaTone)}>
            {delta.direction === "at" ? "At ask" : `${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct}% ${delta.direction} ask`}
            <span className="ml-1 text-slate-500">(asked ${(doc.OriginalListPrice ?? 0).toLocaleString()})</span>
          </p>
        )}
        <p className="mt-0.5 line-clamp-2 pr-2 font-sans text-sm font-medium leading-snug text-slate-200">{addr}</p>
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-300">
            {chips.map((chip, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-slate-600">·</span>}
                {chip}
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <span className="normal-case tracking-normal">{doc.id}</span>
          <span className="text-slate-600">·</span>
          <span>{type}</span>
          {doc.ListOfficeName && (
            <>
              <span className="text-slate-600">·</span>
              <span className="truncate normal-case tracking-normal">{doc.ListOfficeName}</span>
            </>
          )}
        </div>
        {/* TRREB §6.3 — sold data shown to a registered, bona-fide consumer. */}
        <p className="mt-1 text-[9px] leading-tight text-slate-600">
          Sold data via VOW for registered users; not an appraisal.
        </p>
      </>
    );
  }
```

> `addr`, `chips`, and `type` are already computed above (lines 45-56) and are in scope for this early return.
>
> **Compliance:** replace the placeholder §6.3 line above with the **exact** TRREB §6.3 sold-display notice already shipped in `src/components/dashboard/MarketActivityPanel.tsx` (the hardcoded notice near the sold rows), so the wording is identical across the app. Copy it verbatim.

- [ ] **Step 3: Verify typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual check (signed-in)**

`/properties` → **Sold** → a ledger row / map popup shows: red "Sold" chip + date, the sold price, a colored "+X% over ask (asked $…)" line, brokerage, and the §6.3 notice.

- [ ] **Step 5: Commit**

```bash
git add src/components/CommandCenter/ListingCardBody.tsx
git commit -m "feat(terminal): sold-comp card layout (sold price, over/under-ask, §6.3 notice)"
```

**✅ Phase 2 complete.**

---

## Final verification

- [ ] Run the full sold + listings test suite: `npx vitest run src/lib/sold src/lib/listings src/app/api/market/activity`
- [ ] `npx tsc --noEmit && npm run lint && npm run build`
- [ ] Manual matrix: signed-out Sold = teaser on both panes; signed-in Sold = pins + sold cards + window switching re-queries; For Sale/For Rent unchanged from before; conditional badges visible in For Sale.

---

## Deferred (tracked, not in this plan — see spec §6)

- Beds/baths/type/price filter pass-through in Sold mode (route supports beds/baths/type; price range on `ClosePrice` is not yet a route param).
- Multi-year window (>180d) via `raw_vow_sold` — needs BoR/PROPTX-confirmed licensed window + a data-path decision.
- Leased comps (collection is sales-only); sold-price heatmap lens.
