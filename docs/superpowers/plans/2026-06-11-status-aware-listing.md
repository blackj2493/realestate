# Status-Aware Listing Page + True Value Rebrand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The listing detail page renders three distinct states — Active (unchanged), Sold (sold-price hero + "Our Call vs. The Sale" accuracy card), De-listed (OFF MARKET banner, valuation stack kept) — and "PureProperty Estimate" is renamed to "True Value".

**Architecture:** A new pure module `src/lib/property/listingStatus.ts` resolves a `ListingStatus` discriminated union from the raw payload + an optional `raw_vow_delisted` row, picks the closest-model `SoldAccuracy`, and gates both for anonymous users. `getListingDetail` wires it in (one extra indexed PK lookup, only for non-sold rows) and `gateVowDerived` delegates to `gateListingStatus`. The page branches header/rail/meta on `status.kind`.

**Tech Stack:** Next.js 15 server components, Supabase (service role), Vitest (node env — pure logic only, no jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-11-status-aware-listing-design.md`
**Branch:** `feat/status-aware-listing` (already cut from origin/main; spec committed as fd809ce)

**Conventions that apply to every task:**
- Run commands with `npm.cmd` / `npx.cmd` (Windows env).
- Test command: `npx.cmd vitest run <file> --reporter=dot` (or `npm.cmd run test` for the full suite).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- NEVER stage `CLAUDE.md`, `.claude/settings*.json`, `.env*`. The untracked `scripts/admin/_probe*.ts` / `_list*` / `_mint*` / `_verify*` files are leftovers from another session — never stage them.

---

### Task 1: Status resolution — pure module

**Files:**
- Create: `src/lib/property/listingStatus.ts`
- Create: `src/lib/property/listingStatus.test.ts`

The module is deliberately free of imports from `getListingDetail.ts` (avoids an import cycle) and free of IO (vitest node env).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/property/listingStatus.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resolveListingStatus,
  type DelistedRowLite,
} from "./listingStatus";

const delistedRow = (over: Partial<DelistedRowLite> = {}): DelistedRowLite => ({
  mls_status: "Terminated",
  delisted_date: "2026-03-14",
  days_on_market: 71,
  list_price: 949_900,
  ...over,
});

describe("resolveListingStatus", () => {
  it("active when payload is Active and no delisted row", () => {
    expect(resolveListingStatus({ StandardStatus: "Active" }, null)).toEqual({ kind: "active" });
  });

  it("sold from StandardStatus=Closed with ClosePrice + CloseDate", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 875_000, CloseDate: "2026-06-09" },
      null
    );
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: 875_000, closeDate: "2026-06-09" });
  });

  it("sold from MlsStatus=Sold alone (case-insensitive, payload StandardStatus stale)", () => {
    const s = resolveListingStatus({ StandardStatus: "Active", MlsStatus: "sold" }, null);
    expect(s.kind).toBe("sold");
  });

  it("LEASED label from MlsStatus=Leased or TransactionType=For Lease", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Closed", MlsStatus: "Leased", ClosePrice: 2600 }, null)
    ).toMatchObject({ kind: "sold", label: "LEASED" });
    expect(
      resolveListingStatus(
        { StandardStatus: "Closed", MlsStatus: "Sold", TransactionType: "For Lease" },
        null
      )
    ).toMatchObject({ kind: "sold", label: "LEASED" });
  });

  it("sold with non-disclosed price → closePrice null; falls back to PurchaseContractDate", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 0, PurchaseContractDate: "2026-06-01" },
      null
    );
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: null, closeDate: "2026-06-01" });
  });

  it("delisted from the archive row when payload looks frozen-Active", () => {
    const s = resolveListingStatus({ StandardStatus: "Active" }, delistedRow());
    expect(s).toEqual({
      kind: "delisted",
      mlsStatus: "Terminated",
      delistedDate: "2026-03-14",
      daysOnMarket: 71,
      lastListPrice: 949_900,
    });
  });

  it("sold wins over a delisted row (terminated then sold on relist)", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 875_000 },
      delistedRow()
    );
    expect(s.kind).toBe("sold");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: FAIL — `Cannot find module './listingStatus'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `src/lib/property/listingStatus.ts`:

```ts
/**
 * listingStatus — pure status resolution + sold-accuracy picker for the listing
 * detail page (spec: docs/superpowers/specs/2026-06-11-status-aware-listing-design.md).
 *
 * Why a `raw_vow_delisted` row is part of the input: Query B (sold) upserts the
 * updated payload into `listings`, but Query C (Terminated/Expired/Suspended) only
 * writes `raw_vow_delisted` — the `listings` row stays frozen looking Active, so
 * the archive lookup is the ONLY truth source for the de-listed state.
 *
 * Deliberately IO-free and import-light (no getListingDetail import → no cycle;
 * unit-testable in the node-env vitest setup).
 */

/** Slim projection of a raw_vow_delisted row (see scripts/worker/delistedIndexer.ts). */
export interface DelistedRowLite {
  mls_status: string | null;
  delisted_date: string | null;
  days_on_market: number | null;
  list_price: number | null;
}

export interface SoldStatus {
  kind: "sold";
  label: "SOLD" | "LEASED";
  /** VOW-gated. Null when not disclosed (DoNotDiscloseUntilClosingYN) or for anon. */
  closePrice: number | null;
  closeDate: string | null;
}

export interface DelistedStatus {
  kind: "delisted";
  /** "Terminated" | "Expired" | "Suspended" — VOW-gated (null for anon). */
  mlsStatus: string | null;
  delistedDate: string | null;
  daysOnMarket: number | null;
  lastListPrice: number | null;
}

export interface ActiveStatus {
  kind: "active";
}

export type ListingStatus = ActiveStatus | SoldStatus | DelistedStatus;

export function resolveListingStatus(
  payload: Record<string, unknown>,
  delistedRow: DelistedRowLite | null
): ListingStatus {
  const std = String(payload["StandardStatus"] ?? "").toLowerCase().trim();
  const mls = String(payload["MlsStatus"] ?? "").toLowerCase().trim();

  if (std === "closed" || mls === "sold" || mls === "leased") {
    const tx = String(payload["TransactionType"] ?? "").toLowerCase();
    const label: SoldStatus["label"] =
      mls === "leased" || tx.startsWith("for lease") ? "LEASED" : "SOLD";
    const cp = payload["ClosePrice"];
    const closePrice = typeof cp === "number" && cp > 0 ? cp : null;
    const cd = payload["CloseDate"] ?? payload["PurchaseContractDate"];
    const closeDate = typeof cd === "string" && cd ? cd : null;
    return { kind: "sold", label, closePrice, closeDate };
  }

  if (delistedRow) {
    return {
      kind: "delisted",
      mlsStatus: delistedRow.mls_status ?? null,
      delistedDate: delistedRow.delisted_date ?? null,
      daysOnMarket: delistedRow.days_on_market ?? null,
      lastListPrice: delistedRow.list_price ?? null,
    };
  }

  return { kind: "active" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/listingStatus.ts src/lib/property/listingStatus.test.ts
git commit -m "feat(listing): pure status resolution (active/sold/delisted) for the detail page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Non-disclosure fallback + sold-accuracy picker

**Files:**
- Modify: `src/lib/property/listingStatus.ts` (append)
- Modify: `src/lib/property/listingStatus.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/property/listingStatus.test.ts` (add `fillClosePriceFromSaleHistory`, `pickSoldAccuracy` to the existing import from `./listingStatus`):

```ts
describe("fillClosePriceFromSaleHistory", () => {
  const soldNoPrice = {
    kind: "sold",
    label: "SOLD",
    closePrice: null,
    closeDate: null,
  } as const;

  it("fills closePrice/closeDate from this listing's OWN sale event only", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
      { listing_key: "X13146238", close_price: 875_000, close_date: "2026-06-09" },
    ]);
    expect(filled).toEqual({
      kind: "sold",
      label: "SOLD",
      closePrice: 875_000,
      closeDate: "2026-06-09",
    });
  });

  it("does NOT borrow a prior campaign's sale price (stays null)", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
    ]);
    expect(filled.kind === "sold" && filled.closePrice).toBeNull();
  });

  it("is a no-op for already-priced sold and for non-sold statuses", () => {
    const priced = { ...soldNoPrice, closePrice: 875_000 };
    expect(fillClosePriceFromSaleHistory(priced, "X13146238", [])).toBe(priced);
    const active = { kind: "active" } as const;
    expect(fillClosePriceFromSaleHistory(active, "X13146238", [])).toBe(active);
  });
});

describe("pickSoldAccuracy", () => {
  it("null when there is no close price or no models", () => {
    expect(pickSoldAccuracy({ closePrice: null, avmValue: 700_000, expectedSalePrice: 870_000 })).toBeNull();
    expect(pickSoldAccuracy({ closePrice: 875_000, avmValue: null, expectedSalePrice: null })).toBeNull();
  });

  it("picks the closest model — usually Expected Sale Price", () => {
    const a = pickSoldAccuracy({ closePrice: 875_000, avmValue: 709_484, expectedSalePrice: 872_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
    expect(a.estimateValue).toBe(872_000);
    expect(a.closePrice).toBe(875_000);
    expect(a.diffPct).toBeCloseTo((872_000 - 875_000) / 875_000, 6);
  });

  it("picks True Value when the AVM was nearer", () => {
    const a = pickSoldAccuracy({ closePrice: 700_000, avmValue: 705_000, expectedSalePrice: 850_000 })!;
    expect(a.modelLabel).toBe("True Value");
    expect(a.estimateValue).toBe(705_000);
  });

  it("works with a single available model", () => {
    const a = pickSoldAccuracy({ closePrice: 875_000, avmValue: null, expectedSalePrice: 880_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
    expect(a.diffPct).toBeGreaterThan(0); // signed: estimate above close
  });

  it("ties go to Expected Sale Price", () => {
    const a = pickSoldAccuracy({ closePrice: 800_000, avmValue: 810_000, expectedSalePrice: 790_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: FAIL — `fillClosePriceFromSaleHistory is not a function` (import error).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/property/listingStatus.ts`:

```ts
/** Minimal sale-event shape (structural subset of getListingDetail's SaleEvent — no import cycle). */
export interface SaleEventLite {
  listing_key: string;
  close_price: number | null;
  close_date: string | null;
}

/**
 * Non-disclosure fallback: a Closed payload may carry ClosePrice=0
 * (DoNotDiscloseUntilClosingYN). property_sale_history sometimes has the figure once
 * the deal closes — but ONLY this listing's own event is trustworthy; a prior
 * campaign's sale price would corrupt the accuracy math.
 */
export function fillClosePriceFromSaleHistory(
  status: ListingStatus,
  listingKey: string,
  saleEvents: SaleEventLite[]
): ListingStatus {
  if (status.kind !== "sold" || status.closePrice) return status;
  const own = saleEvents.find(
    (e) => e.listing_key === listingKey && (e.close_price ?? 0) > 0
  );
  if (!own) return status;
  return {
    ...status,
    closePrice: own.close_price,
    closeDate: status.closeDate ?? own.close_date,
  };
}

/** The accuracy receipt: how close our closest model came to the actual sale. */
export interface SoldAccuracy {
  modelLabel: "Expected Sale Price" | "True Value";
  estimateValue: number;
  closePrice: number;
  /** Signed: (estimate − close) / close. Positive ⇒ we over-called. */
  diffPct: number;
}

/**
 * Compare the close against both models and keep ONLY the closest (user decision:
 * showing the list-blind AVM's ~11% delta alongside would hurt credibility).
 * Ties go to Expected Sale Price (listed first).
 */
export function pickSoldAccuracy(args: {
  closePrice: number | null;
  avmValue: number | null;
  expectedSalePrice: number | null;
}): SoldAccuracy | null {
  const { closePrice, avmValue, expectedSalePrice } = args;
  if (!closePrice || closePrice <= 0) return null;

  const candidates: Array<{ modelLabel: SoldAccuracy["modelLabel"]; value: number }> = [];
  if (expectedSalePrice && expectedSalePrice > 0)
    candidates.push({ modelLabel: "Expected Sale Price", value: expectedSalePrice });
  if (avmValue && avmValue > 0)
    candidates.push({ modelLabel: "True Value", value: avmValue });
  if (candidates.length === 0) return null;

  const best = candidates.reduce((a, b) =>
    Math.abs(b.value - closePrice) < Math.abs(a.value - closePrice) ? b : a
  );
  return {
    modelLabel: best.modelLabel,
    estimateValue: best.value,
    closePrice,
    diffPct: (best.value - closePrice) / closePrice,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/listingStatus.ts src/lib/property/listingStatus.test.ts
git commit -m "feat(listing): sold-accuracy picker (closest model only) + non-disclosure fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: VOW gating for the status

**Files:**
- Modify: `src/lib/property/listingStatus.ts` (append)
- Modify: `src/lib/property/listingStatus.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/property/listingStatus.test.ts` (add `gateListingStatus` to the import):

```ts
describe("gateListingStatus", () => {
  it("authed users see everything unchanged", () => {
    const sold = { kind: "sold", label: "SOLD", closePrice: 875_000, closeDate: "2026-06-09" } as const;
    expect(gateListingStatus(sold, true)).toBe(sold);
  });

  it("anon keeps the sold KIND + label but loses price/date (HouseSigma model)", () => {
    const gated = gateListingStatus(
      { kind: "sold", label: "LEASED", closePrice: 2_600, closeDate: "2026-06-09" },
      false
    );
    expect(gated).toEqual({ kind: "sold", label: "LEASED", closePrice: null, closeDate: null });
  });

  it("anon keeps the delisted KIND but loses all VOW specifics", () => {
    const gated = gateListingStatus(
      {
        kind: "delisted",
        mlsStatus: "Terminated",
        delistedDate: "2026-03-14",
        daysOnMarket: 71,
        lastListPrice: 949_900,
      },
      false
    );
    expect(gated).toEqual({
      kind: "delisted",
      mlsStatus: null,
      delistedDate: null,
      daysOnMarket: null,
      lastListPrice: null,
    });
  });

  it("active passes through for anon", () => {
    expect(gateListingStatus({ kind: "active" }, false)).toEqual({ kind: "active" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: FAIL — `gateListingStatus is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/property/listingStatus.ts`:

```ts
/**
 * VOW gating (CLAUDE.md §4): the status KIND is public (anon sees the SOLD /
 * OFF MARKET badge — HouseSigma model; the badge itself is the conversion hook),
 * but every VOW-sourced number/date is stripped. Called from gateVowDerived so
 * one call fully de-VOWs a ListingDetail.
 */
export function gateListingStatus(status: ListingStatus, isAuthed: boolean): ListingStatus {
  if (isAuthed) return status;
  if (status.kind === "sold")
    return { kind: "sold", label: status.label, closePrice: null, closeDate: null };
  if (status.kind === "delisted")
    return {
      kind: "delisted",
      mlsStatus: null,
      delistedDate: null,
      daysOnMarket: null,
      lastListPrice: null,
    };
  return status;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run src/lib/property/listingStatus.test.ts --reporter=dot`
Expected: PASS (19 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/property/listingStatus.ts src/lib/property/listingStatus.test.ts
git commit -m "feat(listing): VOW gate for listing status (kind public, numbers stripped)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Wire status + soldAccuracy into getListingDetail

**Files:**
- Modify: `src/lib/property/getListingDetail.ts`

No new unit test (the function is IO-bound; the pure logic is covered by Tasks 1–3). Verified by typecheck + the existing suite.

- [ ] **Step 1: Add the import**

In `src/lib/property/getListingDetail.ts`, after the existing imports (line ~43, after the `computeExpectedSale` import), add:

```ts
import {
  resolveListingStatus,
  fillClosePriceFromSaleHistory,
  pickSoldAccuracy,
  gateListingStatus,
  type DelistedRowLite,
  type ListingStatus,
  type SoldAccuracy,
} from "@/lib/property/listingStatus";
```

- [ ] **Step 2: Extend the ListingDetail interface**

In the `ListingDetail` interface (currently ends with `rooms: RoomData[];`), add two fields after `campaignHistory`:

```ts
  /** Active / Sold / De-listed state. Kind is public; VOW numbers gated for anon. */
  status: ListingStatus;
  /** How close our closest model came to the actual sale (sold only; VOW-gated). */
  soldAccuracy: SoldAccuracy | null;
```

- [ ] **Step 3: Extend gateVowDerived**

In `gateVowDerived`, inside the returned object (after `expectedSale: null,`), add:

```ts
    status: gateListingStatus(detail.status, false),
    soldAccuracy: null,
```

- [ ] **Step 4: Resolve the status inside the fetch**

In the `getListingDetail` body, directly AFTER the Deal Score block (after `const dealScore = computeDealScore({...});`, before the Expected Sale block), insert:

```ts
    // Status resolution — sold comes straight from the payload (Query B upserts the
    // Closed payload into `listings`); Terminated/Expired/Suspended live ONLY in
    // raw_vow_delisted (the listings row stays frozen-Active), so non-sold rows get
    // one indexed PK lookup there. Best-effort: a miss/timeout degrades to "active".
    let status: ListingStatus = resolveListingStatus(payload, null);
    if (status.kind === "active") {
      try {
        const { data: dRow } = await withTimeout(
          supabase
            .from("raw_vow_delisted")
            .select("mls_status, delisted_date, days_on_market, list_price")
            .eq("listing_key", listingKey)
            .maybeSingle(),
          4000,
          "Delisted lookup"
        );
        if (dRow) status = resolveListingStatus(payload, dRow as DelistedRowLite);
      } catch (dlErr) {
        console.error(`[getListingDetail] delisted lookup failed for ${listingKey}:`, dlErr);
      }
    }
```

- [ ] **Step 5: Fill non-disclosed close price + compute accuracy**

AFTER the sale-history block (after the `catch (saleErr)` block closes) and BEFORE the campaign-history block, insert:

```ts
    // Non-disclosure fallback (own sale event only) + the accuracy receipt.
    status = fillClosePriceFromSaleHistory(status, listing.listing_key, saleHistory.events);
    const soldAccuracy = pickSoldAccuracy({
      closePrice: status.kind === "sold" ? status.closePrice : null,
      avmValue: estimate?.estimatedValue ?? null,
      expectedSalePrice: expectedSale?.expectedPrice ?? null,
    });
```

- [ ] **Step 6: Return the new fields**

In the final return object, after `campaignHistory,` add:

```ts
      status,
      soldAccuracy,
```

- [ ] **Step 7: Typecheck + full test suite**

Run: `npm.cmd run typecheck`
Expected: PASS — note any OTHER constructor of `ListingDetail` the compiler flags (e.g. an API route building the object literally) and add the two fields there with `resolveListingStatus`/`null` as appropriate. As of origin/main, `getListingDetail` is the only constructor; `gateVowDerived` callers (`page.tsx`, `src/app/api/properties/[id]/route.ts` if present) consume, not construct.

Run: `npm.cmd run test`
Expected: PASS (all suites; no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/lib/property/getListingDetail.ts
git commit -m "feat(listing): resolve sold/delisted status + accuracy in getListingDetail (VOW-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: SoldOutcomeCard — "Our Call vs. The Sale"

**Files:**
- Create: `src/components/Property/SoldOutcomeCard.tsx`

UI component — no unit test (node-env vitest, no jsdom; per repo convention UI is verified via typecheck/lint/build + manual).

- [ ] **Step 1: Create the component**

Create `src/components/Property/SoldOutcomeCard.tsx`:

```tsx
"use client";

/**
 * SoldOutcomeCard — "Our Call vs. The Sale". Once a listing sells we show the
 * receipt: how close our closest model (almost always the Expected Sale Price;
 * True Value when the AVM was nearer) came to the actual close. Confidence-aware
 * copy: |diff| ≤ 3% gets the headline "Within X%" treatment; bigger misses get
 * neutral framing — a miss must never read as a hidden flex (spec §2).
 *
 * VOW-gated: sold price + accuracy are VOW-derived → blurred teaser for anon
 * (the real numbers never reach their DOM; the server nulls soldAccuracy).
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice } from "@/lib/utils";
import type { SoldAccuracy } from "@/lib/property/listingStatus";
import VowGateOverlay from "@/components/auth/VowGateOverlay";

/** ≤3% |diff| → bragging tone; above → neutral. */
const BRAG_THRESHOLD_PCT = 3;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export default function SoldOutcomeCard({
  accuracy,
  closeDate,
  locked,
}: {
  accuracy: SoldAccuracy | null;
  closeDate?: string | null;
  /** VOW gate: render a blurred "sign in" teaser for anon (only when data exists). */
  locked?: boolean;
}) {
  if (locked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Our Call vs. The Sale</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="space-y-2 blur-sm select-none" aria-hidden="true">
              <p className="text-3xl font-bold text-primary">Within 0.0%</p>
              <p className="text-sm text-muted-foreground">
                We expected $0,000,000 — it sold for $0,000,000.
              </p>
            </div>
            <VowGateOverlay message="Sign in to see the sold price and how close our estimate was" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!accuracy) return null;

  const absPct = Math.abs(accuracy.diffPct) * 100;
  const brag = absPct <= BRAG_THRESHOLD_PCT;
  const soldLine = `${formatPrice(accuracy.closePrice)}${closeDate ? ` on ${fmtDate(closeDate)}` : ""}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Our Call vs. The Sale</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {brag ? (
            <>
              <p className="text-3xl font-bold text-emerald-400">
                Within {absPct.toFixed(1)}%
              </p>
              <p className="text-sm text-slate-300">
                We expected{" "}
                <span className="font-mono text-slate-100">{formatPrice(accuracy.estimateValue)}</span>{" "}
                — it sold for <span className="font-mono text-slate-100">{soldLine}</span>.
              </p>
            </>
          ) : (
            <>
              <p className="text-3xl font-bold text-slate-200">
                {accuracy.diffPct < 0 ? "Sold above" : "Sold below"} our call
              </p>
              <p className="text-sm text-slate-300">
                We expected{" "}
                <span className="font-mono text-slate-100">{formatPrice(accuracy.estimateValue)}</span>; it
                sold for <span className="font-mono text-slate-100">{soldLine}</span> —{" "}
                {absPct.toFixed(1)}% {accuracy.diffPct < 0 ? "above" : "below"} our estimate.
              </p>
            </>
          )}

          <p className="border-t pt-3 text-xs text-muted-foreground">
            Call made by our {accuracy.modelLabel} model before the sale price was known.
            Deterministic estimate — not an MLS or TRREB figure.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm.cmd run typecheck`  → Expected: PASS
Run: `npm.cmd run lint`        → Expected: PASS (component is not yet imported anywhere; that's fine)

- [ ] **Step 3: Commit**

```bash
git add src/components/Property/SoldOutcomeCard.tsx
git commit -m "feat(listing): SoldOutcomeCard — accuracy receipt vs actual sale, VOW-gated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: True Value rebrand + sold-aware estimate card

**Files:**
- Modify: `src/components/Property/ListingEstimateCard.tsx`
- Modify: `src/app/(app)/properties/compare/CompareClient.tsx:139`

- [ ] **Step 1: Rename the card + add subtitle + hideAskDelta prop**

In `src/components/Property/ListingEstimateCard.tsx`:

(a) Extend the props interface:

```ts
interface ListingEstimateCardProps {
  estimate: AVMResult | null;
  listPrice: number;
  cityRegion?: string;
  city?: string;
  /** VOW gate: AVM is VOW-derived — render a blurred "Login Required" teaser for anon. */
  locked?: boolean;
  /** Sold/de-listed views: the ask is moot — suppress the "below/above ask" delta line. */
  hideAskDelta?: boolean;
}
```

and add `hideAskDelta` to the destructured params of `ListingEstimateCard`.

(b) Replace BOTH `<CardTitle>PureProperty Estimate</CardTitle>` occurrences (locked teaser ~line 44 and main render ~line 66) with:

```tsx
        <CardTitle>True Value</CardTitle>
        <p className="text-xs text-muted-foreground">
          What the asset itself is worth — independent of asking price.
        </p>
```

(c) In the locked teaser, change the overlay message:

```tsx
            <VowGateOverlay message="Sign in to view the True Value" />
```

(d) Wrap the ask-delta line (the `<DeltaVsAsking ... />` element in the main render) so it respects the new prop:

```tsx
              {!hideAskDelta && (
                <DeltaVsAsking
                  estimatedValue={estimate.estimatedValue}
                  listPrice={listPrice}
                />
              )}
```

- [ ] **Step 2: Rebrand sweep — remaining user-visible string**

In `src/app/(app)/properties/compare/CompareClient.tsx` line 139, change:

```
Est. Value is the PureProperty Estimate — our own deterministic model, not an MLS/TRREB figure.
```

to:

```
Est. Value is the True Value — our own deterministic model, not an MLS/TRREB figure.
```

Then verify no user-visible occurrences remain (comments are fine to leave):

Run: `git grep -n "PureProperty Estimate" -- src`
Expected: hits only in comments (`getListingDetail.ts` header/body comments, `ListingTerminal.tsx` JSX comment, `ExpectedSaleCard.tsx` doc comment, `getCompareData.ts` comments). No `<CardTitle>`/JSX-text hits.

- [ ] **Step 3: Typecheck + lint**

Run: `npm.cmd run typecheck` → Expected: PASS
Run: `npm.cmd run lint` → Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/Property/ListingEstimateCard.tsx "src/app/(app)/properties/compare/CompareClient.tsx"
git commit -m "feat(brand): rename PureProperty Estimate to True Value; sold-aware ask-delta toggle

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Status-aware ListingActions

**Files:**
- Modify: `src/app/(app)/properties/[id]/ListingActions.tsx`

- [ ] **Step 1: Add the statusKind prop and branch the CTAs**

In `src/app/(app)/properties/[id]/ListingActions.tsx`:

(a) Extend the props:

```ts
export default function ListingActions({
  id,
  address,
  city,
  price,
  thumb,
  statusKind = "active",
}: {
  id: string;
  address?: string;
  city?: string;
  price?: number;
  thumb?: string;
  /** Drives the CTA set: sold/delisted drop Schedule Viewing; delisted promotes Watchlist. */
  statusKind?: "active" | "sold" | "delisted";
}) {
```

(b) Wrap the Schedule Viewing button so it only renders for active listings:

```tsx
      {statusKind === "active" && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          <CalendarDays className="h-4 w-4" />
          Schedule Viewing
        </button>
      )}
```

(c) Make the Watchlist button the primary CTA for de-listed listings (relist alert — status-change alerts already fire on relist). Replace the watchlist button's `className` and label logic:

```tsx
      <button
        type="button"
        onClick={() =>
          void toggleWatch({
            listing_key: id,
            address,
            city,
            list_price: price,
            thumb,
          })
        }
        aria-pressed={watched}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
          statusKind === "delisted" && !watched
            ? "border-transparent bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
            : watched
              ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
              : "border-slate-700 text-slate-300 hover:bg-slate-800"
        )}
      >
        {watched ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        {statusKind === "delisted"
          ? watched
            ? "Watching for a relist"
            : "Watch for a Relist"
          : watched
            ? "On your Watchlist"
            : "Add to Watchlist"}
      </button>
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm.cmd run typecheck` → Expected: PASS (prop is optional — existing call sites unaffected)
Run: `npm.cmd run lint` → Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/properties/[id]/ListingActions.tsx"
git commit -m "feat(listing): status-aware CTAs — no viewings on dead listings, relist-watch for delisted

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Status-aware page — header, rail, meta, JSON-LD

**Files:**
- Modify: `src/app/(app)/properties/[id]/page.tsx`

All edits in one task because they share the same `status` plumbing; commit at the end.

- [ ] **Step 1: Imports**

Add to the imports in `page.tsx`:

```ts
import SoldOutcomeCard from "@/components/Property/SoldOutcomeCard";
```

- [ ] **Step 2: Status-aware metadata**

In `generateMetadata`, replace the two lines

```ts
  const title = `${address} — ${formatPrice(price)} | PureProperty`;
```
and
```ts
  const isActive = (p.StandardStatus ?? "Active") === "Active";
```

with (status kind is public — no VOW numbers in metadata; the price shown stays the LIST price):

```ts
  const statusSuffix =
    detail.status.kind === "sold"
      ? ` — ${detail.status.label}`
      : detail.status.kind === "delisted"
        ? " — Off Market"
        : "";
  const title = `${address} — ${formatPrice(price)}${statusSuffix} | PureProperty`;
  // Frozen-Active payloads (Terminated/Expired/Suspended) must noindex too — trust
  // the resolved status, not the stale payload field.
  const isActive =
    detail.status.kind === "active" && (p.StandardStatus ?? "Active") === "Active";
```

- [ ] **Step 3: Status-aware JSON-LD**

In `buildJsonLd`, replace the hardcoded availability line

```ts
      availability: "https://schema.org/InStock",
```

with:

```ts
      availability:
        detail.status.kind === "sold"
          ? "https://schema.org/SoldOut"
          : detail.status.kind === "delisted"
            ? "https://schema.org/OutOfStock"
            : "https://schema.org/InStock",
```

- [ ] **Step 4: Page-body plumbing**

In `PropertyPage`, after the existing `const hasExpectedSale = ...` line, add:

```ts
  const hasSoldAccuracy = detail.soldAccuracy !== null;
  const hasSoldPrice = detail.status.kind === "sold" && detail.status.closePrice !== null;
```

After `const view = gateVowDerived(detail, isAuthed);` add (ALWAYS read status/accuracy from `view` below this point — `detail.status` carries ungated VOW numbers):

```ts
  const status = view.status;
  const soldAccuracy = view.soldAccuracy;
  const isActiveListing = status.kind === "active";
  const soldPrice = status.kind === "sold" ? status.closePrice : null;
  const soldDate = status.kind === "sold" ? status.closeDate : null;
```

- [ ] **Step 5: Status-aware header**

Replace the header price row (the `<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">…</div>` block containing the price span, "Listed X days ago" span, and `DealScoreBadge`) with:

```tsx
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                {status.kind === "sold" ? (
                  <>
                    <span className="rounded bg-rose-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-rose-400">
                      {status.label}
                      {soldDate ? ` ${new Date(soldDate).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })}` : ""}
                    </span>
                    {soldPrice ? (
                      <>
                        <span className="font-mono text-3xl font-bold text-emerald-400">
                          {formatPrice(soldPrice)}
                        </span>
                        {price > 0 && (
                          <>
                            <span className="font-mono text-lg text-slate-500 line-through">
                              {formatPrice(price)}
                            </span>
                            <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-300">
                              {((soldPrice / price) * 100).toFixed(1)}% of ask
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-3xl font-bold text-slate-400">
                          {formatPrice(price)}
                        </span>
                        {hasSoldPrice && (
                          <Link
                            href="/login"
                            className="rounded border border-slate-700 px-2 py-0.5 text-xs text-cyan-300 hover:bg-slate-800"
                          >
                            Sign in for the sold price
                          </Link>
                        )}
                      </>
                    )}
                  </>
                ) : status.kind === "delisted" ? (
                  <>
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-amber-400">
                      OFF MARKET
                    </span>
                    <span className="font-mono text-3xl font-bold text-slate-400">
                      {formatPrice(price)}
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-3xl font-bold text-emerald-400">
                    {formatPrice(price)}
                  </span>
                )}
                <span className="text-sm text-slate-500">
                  {p.City}
                  {p.PropertySubType ? `, ${p.PropertySubType}` : ""}
                </span>
                {isActiveListing && (
                  <span className="text-sm font-semibold text-slate-400">
                    Listed {dom} {dom === 1 ? "day" : "days"} ago
                  </span>
                )}
                {status.kind === "sold" && (
                  <span className="text-sm font-semibold text-slate-400">
                    Sold after {dom} {dom === 1 ? "day" : "days"} on market
                  </span>
                )}
                {isActiveListing && (
                  <DealScoreBadge score={view.dealScore.score} grade={view.dealScore.grade} />
                )}
              </div>
              {status.kind === "delisted" && (
                <p className="mt-1 text-sm text-amber-300/80">
                  {status.mlsStatus
                    ? `${status.mlsStatus} ${
                        status.delistedDate
                          ? new Date(status.delistedDate).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" })
                          : ""
                      }${status.daysOnMarket != null ? ` · ${status.daysOnMarket} days on market` : ""}${
                        status.lastListPrice ? ` · last asking ${formatPrice(status.lastListPrice)}` : ""
                      }`
                    : "This listing is no longer on the market."}
                </p>
              )}
```

(`Link` is already imported in this file.)

- [ ] **Step 6: Status-aware right rail**

Replace the rail block from `<DealScoreCard …/>` through `<ExpectedSaleCard …/>` (keep `ForceAppreciationCard` onward) with:

```tsx
              {/* Sold: lead with the accuracy receipt — Deal Score / Expected Sale are
                  for live asks; their job here is done. */}
              {status.kind === "sold" && (
                <SoldOutcomeCard
                  accuracy={soldAccuracy}
                  closeDate={soldDate}
                  locked={!isAuthed && hasSoldAccuracy}
                />
              )}

              {isActiveListing && (
                <DealScoreCard dealScore={view.dealScore} locked={!isAuthed && hasDealScore} />
              )}

              {/* True Value — our list-blind AVM ("what the asset is worth") */}
              <ListingEstimateCard
                estimate={view.estimate}
                listPrice={price}
                cityRegion={p.CityRegion}
                city={p.City}
                locked={!isAuthed && hasEstimate}
                hideAskDelta={status.kind === "sold"}
              />

              {/* Expected Sale Price — only meaningful against a live ask */}
              {isActiveListing && (
                <ExpectedSaleCard
                  expectedSale={view.expectedSale}
                  estimate={view.estimate}
                  listPrice={price}
                  city={p.City}
                  propertySubType={p.PropertySubType}
                  locked={!isAuthed && hasExpectedSale}
                />
              )}
```

- [ ] **Step 7: Asset Summary + sandbox seed + actions**

(a) In the Asset Summary block, ABOVE the existing `List Price` row, add a sold-price row (renders only when authed — `soldPrice` is gated null for anon):

```tsx
                  {soldPrice !== null && (
                    <SummaryRow
                      label={status.kind === "sold" && status.label === "LEASED" ? "Leased Price" : "Sold Price"}
                      value={formatPrice(soldPrice)}
                      valueClass="text-rose-400"
                    />
                  )}
```

and change the existing List Price row's `valueClass` to be status-aware:

```tsx
                  <SummaryRow
                    label="List Price"
                    value={formatPrice(price)}
                    valueClass={isActiveListing ? "text-emerald-400" : "text-slate-400"}
                  />
```

(b) Seed the Underwriting Sandbox with the sold price when we have it (gated `soldPrice` → anon silently keeps the list price):

```tsx
              <UnderwritingSandbox
                listingId={id}
                listPrice={soldPrice ?? price}
                annualTaxes={p.TaxAnnualAmount || 0}
                monthlyFees={p.AssociationFee || 0}
                hasSuitePotential={hasSuitePotential}
              />
```

(c) Pass the status to the actions:

```tsx
              <ListingActions
                id={id}
                address={address}
                city={detail.city ?? undefined}
                price={price}
                thumb={detail.media_urls[0]}
                statusKind={status.kind}
              />
```

- [ ] **Step 8: Update the page header comment**

Update the file's top doc comment line `* Compliance: serves the listings table (active IDX) only; ...` to reflect reality:

```ts
 * Compliance: serves the `listings` table; sold/de-listed states render status-aware
 * views with VOW numbers gated (kind public, prices/dates authed-only); brokerage is
 * displayed; all derived metrics are deterministic (no LLM transformation).
```

- [ ] **Step 9: Verify**

Run: `npm.cmd run typecheck` → Expected: PASS
Run: `npm.cmd run lint` → Expected: PASS
Run: `npm.cmd run test` → Expected: PASS
Run: `npm.cmd run build` → Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/properties/[id]/page.tsx"
git commit -m "feat(listing): status-aware detail page — sold hero + accuracy card, off-market banner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: End-to-end verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full gate**

Run all four; every one must PASS before claiming done:
```
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run build
```

- [ ] **Step 2: Find one real listing key per state**

Create a throwaway probe (note the `_` prefix keeps it out of commits; delete after):

`scripts/admin/_findStatusSmokeKeys.ts`:
```ts
import "dotenv/config";
import { getServiceRoleClient } from "../../src/lib/supabase/client";

async function main() {
  const sb = getServiceRoleClient();
  const { data: sold } = await sb
    .from("listings")
    .select("listing_key")
    .or("full_payload->>MlsStatus.eq.Sold,full_payload->>StandardStatus.eq.Closed")
    .limit(3);
  console.log("SOLD:", sold?.map((r) => r.listing_key));

  const { data: dl } = await sb.from("raw_vow_delisted").select("listing_key").limit(20);
  for (const r of dl ?? []) {
    const { data: hit } = await sb
      .from("listings")
      .select("listing_key")
      .eq("listing_key", r.listing_key)
      .maybeSingle();
    if (hit) {
      console.log("DELISTED (in listings):", hit.listing_key);
      break;
    }
  }
}
main();
```

Run: `npx.cmd tsx scripts/admin/_findStatusSmokeKeys.ts`
Expected: at least one SOLD key; a DELISTED key may legitimately not exist (de-listed rows only enter `listings` if they were once Active-synced) — if none, smoke-test delisted by temporarily checking any active key still renders `kind: "active"` correctly and note it.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm.cmd run dev`, then verify in the browser:

1. `/properties/<SOLD_KEY>` signed in: SOLD badge + sold-price hero + struck ask + % of ask; "Our Call vs. The Sale" with a real %; True Value card titled correctly with no ask-delta line; no Deal Score / Expected Sale / Schedule Viewing; sandbox seeded with the sold price; Asset Summary shows Sold Price.
2. Same URL in a private window (anon): SOLD badge visible, list price hero, "Sign in for the sold price" chip, accuracy card blurred with the sign-in overlay; no sold numbers anywhere in view-source (search the HTML for the sold price digits — MUST be absent).
3. `/properties/<DELISTED_KEY>` (if found) signed in: OFF MARKET badge + "Terminated <date> · N days on market · last asking $X" line; True Value + Renovation Upside still render; no ESP/Deal Score; "Watch for a Relist" is the primary emerald CTA. Anon: badge + generic line only.
4. Any active listing: pixel-identical behavior to before (Deal Score, True Value title change only, ESP, Schedule Viewing all present).

- [ ] **Step 4: Clean up the probe**

```bash
rm scripts/admin/_findStatusSmokeKeys.ts
```

- [ ] **Step 5: Push + PR**

Push the branch and open a PR against `main` titled `feat: status-aware listing page (sold/de-listed) + True Value rebrand`, body summarizing the three states, the VOW gating model (kind public / numbers authed), and the rebrand. Follow the repo's commit/push routine (no force-push; PR body ends with the Claude Code attribution line).
