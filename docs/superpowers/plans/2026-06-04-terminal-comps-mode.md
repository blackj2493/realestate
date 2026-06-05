# Terminal Comps Mode (Sold + Leased) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the exclusive For Sale/Sold/For Rent strip into a HouseSigma-style multi-select `For Sale · Sold · Leased · For Rent` view where active inventory and closed comps render together on map + list, filters apply across layers, the map blob is fixed by clustering, sale-vs-lease is decided by real values, and the VOW notice shows once.

**Architecture:** Four independent layers — two active (IDX `properties` via the public Typesense client, split by `TransactionType`) and two closed comps (VOW `sold_listings` via the gated `/api/market/activity/sold` route, split by a new real-values `DealType` flag). `performSearch` fans out to ≤2 sources in parallel and merges into one `ListingDocument[]` tagged by layer; the existing `AlphaMap` + `LedgerPanel` + `ListingCardBody` render the merged set. Pure helpers (`src/lib/sold/*`, `src/lib/listings/*`) hold all testable logic so Vitest (node-env, no jsdom) covers it; UI is verified via typecheck/lint/build/manual.

**Tech Stack:** Next.js App Router, TypeScript, Zustand, Typesense, deck.gl + Supercluster, Tailwind, Vitest (node-env).

**Spec:** `docs/superpowers/specs/2026-06-04-terminal-comps-mode-design.md`

---

## Pre-flight (do once before Task 0.1)

- [ ] **Establish a clean, isolated branch.** Check `git branch --show-current` + `git status`. If a concurrent session is still active on `feat/terminal-sold-mode` with uncommitted WIP, create an isolated worktree off `main`; otherwise create `feat/terminal-comps-mode` off `main` in place. Then `git add` ONLY the two doc files and commit:
```bash
git fetch origin
git switch -c feat/terminal-comps-mode origin/main      # or: git worktree add ../comps feat/terminal-comps-mode origin/main
git add docs/superpowers/specs/2026-06-04-terminal-comps-mode-design.md docs/superpowers/plans/2026-06-04-terminal-comps-mode.md
git commit -m "docs(comps): terminal comps-mode spec + implementation plan"
```
- Test command used throughout: `npx vitest run <path>`. Pre-commit verification: `npm run typecheck && npm run lint` (a PreToolUse hook also enforces this on commit).

## File Structure

| File | Responsibility | New/Mod |
| --- | --- | --- |
| `src/lib/sold/dealType.ts` | Pure: derive `'sold'|'leased'` from MlsStatus/TransactionType | New |
| `src/lib/sold/layers.ts` | Pure: `LayerKey`, query-plan + transactionMode from active layers | New |
| `src/lib/sold/mergeLayers.ts` | Pure: merge + sort + dedupe tagged docs from multiple sources | New |
| `src/lib/listings/layerStatus.ts` | Pure: `layerOf(doc)` + status chip `{label,tone}` | New |
| `src/lib/typesense/soldListingsSchema.ts` | Add `DealType` faceted field + doc type | Mod |
| `scripts/worker/soldIndexer.ts` | Derive+set `DealType`; backfill SELECT adds raw status cols | Mod |
| `scripts/worker/ingester.ts` | Incremental path passes MlsStatus/TransactionType to indexer | Mod |
| `scripts/admin/add-sold-deal-type.ts` | Admin: ALTER live `sold_listings` to add `DealType` | New |
| `src/app/api/market/activity/sold/route.ts` | Filter by `DealType` (sold/leased) replacing price floor | Mod |
| `src/app/api/market/activity/sold/soldMapper.ts` | Map `DealType`/leased date onto `SoldListing` | Mod |
| `src/lib/sold/adapter.ts` | Adapt leased comps; set `compKind` | Mod |
| `src/lib/sold/fetchSoldComps.ts` | Fetch sold and/or leased; pass `dealType`+filters | Mod |
| `src/lib/typesense/client.ts` | `ListingDocument`: `compKind`, `LeasedDate` | Mod |
| `src/lib/stores/commandCenterStore.ts` | Replace `listingMode` with `activeLayers` set | Mod |
| `src/components/CommandCenter/LayerChips.tsx` | Multi-select layer chips | New |
| `src/components/CommandCenter/FilterBar.tsx` | Use `LayerChips`; gate active-only controls | Mod |
| `src/app/properties/page.tsx` | `performSearch` multi-source fetch + merge; gate overlay | Mod |
| `src/components/Map/AlphaMap.tsx` | Comp-layer fixed hues; clustering tweak | Mod |
| `src/components/Map/mapLogic.ts` | `clusterOptionsForZoom` (tighter radius) | Mod |
| `src/components/CommandCenter/LedgerPanel.tsx` | Mode-aware header; single VOW notice | Mod |
| `src/components/CommandCenter/ListingCardBody.tsx` | Leased branch; remove per-card notice | Mod |

---

## Phase 0 — Data foundation (`DealType` + re-backfill)

### Task 0.1: `DealType` derivation from real values

**Files:**
- Create: `src/lib/sold/dealType.ts`
- Test: `src/lib/sold/dealType.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/sold/dealType.test.ts
import { describe, it, expect } from "vitest";
import { deriveDealType } from "./dealType";

describe("deriveDealType", () => {
  it("uses MlsStatus first: 'Leased' → leased", () => {
    expect(deriveDealType("Leased", "For Sale")).toBe("leased");
  });
  it("'Sold' / 'Closed Sale' → sold", () => {
    expect(deriveDealType("Sold", null)).toBe("sold");
    expect(deriveDealType("Closed Sale", null)).toBe("sold");
  });
  it("falls back to TransactionType when MlsStatus is unhelpful", () => {
    expect(deriveDealType("Closed", "For Lease")).toBe("leased");
    expect(deriveDealType("Closed", "For Sale")).toBe("sold");
  });
  it("defaults to sold when neither signal is present (price is NEVER used)", () => {
    expect(deriveDealType(null, null)).toBe("sold");
    expect(deriveDealType("", "")).toBe("sold");
  });
  it("is case/space tolerant", () => {
    expect(deriveDealType("  leased  ", null)).toBe("leased");
    expect(deriveDealType(null, "for lease")).toBe("leased");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './dealType'`)

Run: `npx vitest run src/lib/sold/dealType.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/sold/dealType.ts
/**
 * Deal type for a closed VOW comp — derived from REAL board values, never price
 * (a cheap sale or a luxury rental must not be misclassified). MlsStatus is the
 * primary signal ("Leased" vs "Sold"/"Closed Sale"); TransactionType ("For Lease"/
 * "For Sale") is the fallback; default 'sold' so a blank never leaks rent into a
 * sale-price field.
 */
export type DealType = "sold" | "leased";

export function deriveDealType(
  mlsStatus: string | null | undefined,
  transactionType: string | null | undefined
): DealType {
  const mls = (mlsStatus ?? "").trim().toLowerCase();
  if (mls.includes("leas")) return "leased";
  if (mls.includes("sold") || mls.includes("sale")) return "sold";
  const tx = (transactionType ?? "").trim().toLowerCase();
  if (tx.includes("leas")) return "leased";
  return "sold";
}
```

- [ ] **Step 4: Run it — expect PASS.** `npx vitest run src/lib/sold/dealType.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/dealType.ts src/lib/sold/dealType.test.ts
git commit -m "feat(comps): deriveDealType from MlsStatus/TransactionType (not price)"
```

### Task 0.2: Add `DealType` to the sold schema + index it

**Files:**
- Modify: `src/lib/typesense/soldListingsSchema.ts` (fields array + `SoldListingDocument`)
- Modify: `scripts/worker/soldIndexer.ts` (`SoldIndexInput`, `toSoldDocument`, backfill SELECT)
- Modify: `scripts/worker/ingester.ts` (incremental call site)

- [ ] **Step 1: Add the schema field.** In `soldListingsSchema.ts`, after the `location`/`NearbySchools` fields, add:

```ts
    // Real-values deal type ('sold' | 'leased') — replaces the $50k price proxy for
    // separating closed sales from closed leases. Faceted so the route can filter exactly.
    { name: 'DealType', type: 'string' as const, facet: true, optional: true },
```

And in `interface SoldListingDocument` add:

```ts
  /** 'sold' | 'leased' — derived from MlsStatus/TransactionType at index time. */
  DealType?: 'sold' | 'leased';
```

- [ ] **Step 2: Thread the source fields into the indexer.** In `soldIndexer.ts`, add to `interface SoldIndexInput`:

```ts
  /** Raw board status signals for deriving DealType (real values, not price). */
  mls_status: string | null;
  transaction_type: string | null;
```

Import the helper at the top:

```ts
import { deriveDealType } from '../../src/lib/sold/dealType';
```

In `toSoldDocument`, after `doc.PurchaseContractDate = ms;` block is built (right before `if (primaryImageUrl) ...`), set:

```ts
  doc.DealType = deriveDealType(r.mls_status, r.transaction_type);
```

In the backfill `columns` string, add the two JSONB extractions:

```ts
    'parking_total, list_price, close_price, purchase_contract_date, basement_tier, ' +
    'mls_status:raw_payload->>MlsStatus, txn_type:raw_payload->>TransactionType, ' +
    'brokerage:raw_payload->>ListOfficeName, ' +
```

And in the backfill row→input mapping (the `toSoldDocument(row as SoldIndexInput, ...)` call), the aliases `mls_status` and `txn_type` must land on the input. Map them explicitly right before the call:

```ts
      const doc = toSoldDocument(
        { ...(row as any), mls_status: row.mls_status ?? null, transaction_type: row.txn_type ?? null } as SoldIndexInput,
        row.brokerage ?? null,
        { media: row.media, images: row.images }
      );
```

- [ ] **Step 3: Wire the incremental (daily-sync) path.** In `ingester.ts`, find where the daily sold batch builds Typesense docs via `toSoldDocument(...)` and ensure it passes the raw status fields. The raw listing object has `raw.MlsStatus` and `raw.TransactionType`; the input object passed to `toSoldDocument` must include:

```ts
      mls_status: raw.MlsStatus ?? null,
      transaction_type: raw.TransactionType ?? null,
```

(If the incremental path maps the just-upserted `SoldListingRecord` rather than `raw`, add `mls_status`/`transaction_type` to that mapping from `raw` at the same site — grep for `toSoldDocument` in `ingester.ts` to locate it.)

- [ ] **Step 4: Typecheck.** `npm run typecheck` — expect no errors (new field optional; input fields supplied at both call sites).

- [ ] **Step 5: Commit**

```bash
git add src/lib/typesense/soldListingsSchema.ts scripts/worker/soldIndexer.ts scripts/worker/ingester.ts
git commit -m "feat(comps): index DealType on sold_listings (incremental + backfill)"
```

### Task 0.3: Admin ALTER script + run the re-backfill (operational)

**Files:**
- Create: `scripts/admin/add-sold-deal-type.ts`

- [ ] **Step 1: Write the alter script** (mirrors `add-transaction-type.ts`, but targets `sold_listings` and pulls the field def from `soldListingsSchema`):

```ts
// scripts/admin/add-sold-deal-type.ts
/**
 * Add the `DealType` faceted field to the live `sold_listings` collection so the
 * sold route can filter sold vs leased by REAL values (replacing the $50k price
 * proxy). After altering, run `npx tsx scripts/worker/soldIndexer.ts backfill` to
 * repopulate DealType on the 180-day window (the backfill upserts every doc).
 * Reads/writes ONLY Typesense. Idempotent.
 *   npx tsx scripts/admin/add-sold-deal-type.ts          # dry-run
 *   npx tsx scripts/admin/add-sold-deal-type.ts --apply  # alter
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { soldListingsSchema, SOLD_LISTINGS_COLLECTION } from '@/lib/typesense/soldListingsSchema';

const APPLY = process.argv.includes('--apply');
const KEY = process.env.TYPESENSE_ADMIN_API_KEY || '';
const FIELD = 'DealType';
const ts = new Typesense.Client({
  nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
  apiKey: KEY,
  connectionTimeoutSeconds: 120,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = any;

async function main() {
  if (!KEY) { console.error('❌ TYPESENSE_ADMIN_API_KEY not set'); process.exit(1); }
  const coll: AnyObj = await ts.collections(SOLD_LISTINGS_COLLECTION).retrieve();
  if ((coll.fields || []).some((f: AnyObj) => f.name === FIELD)) {
    console.log(`✅ '${FIELD}' already present — no alter needed.`); return;
  }
  const def = (soldListingsSchema.fields as AnyObj[]).find((f) => f.name === FIELD);
  if (!def) throw new Error(`${FIELD} missing from soldListingsSchema.fields`);
  console.log(`Adding field: ${JSON.stringify(def)}`);
  if (!APPLY) { console.log('(dry-run — re-run with --apply)'); return; }
  await ts.collections(SOLD_LISTINGS_COLLECTION).update({ fields: [def] } as AnyObj);
  console.log('✅ Altered. Now run: npx tsx scripts/worker/soldIndexer.ts backfill');
}
main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```

- [ ] **Step 2: Commit the script**

```bash
git add scripts/admin/add-sold-deal-type.ts
git commit -m "chore(comps): admin script to add DealType field to sold_listings"
```

- [ ] **Step 3: OPERATIONAL (run against live infra; requires `TYPESENSE_ADMIN_API_KEY` + DB access in `.env`/`.env.local`).** Run, in order, and capture output:

```bash
npx tsx scripts/admin/add-sold-deal-type.ts            # dry-run, confirm field def
npx tsx scripts/admin/add-sold-deal-type.ts --apply    # ALTER live collection
npx tsx scripts/worker/soldIndexer.ts backfill         # repopulate DealType (+ refresh coords)
```
Expected: alter succeeds; backfill logs `imported N` for the 180-day window. Verify with a quick search that `DealType:=leased` and `DealType:=sold` both return > 0 (e.g. extend `add-sold-deal-type.ts` report, or use the existing dashboard). **Do not proceed to Task 0.4 until both return non-zero.**

### Task 0.4: Sold route filters by `DealType`; mapper carries it

**Files:**
- Modify: `src/app/api/market/activity/sold/route.ts`
- Modify: `src/app/api/market/activity/sold/soldMapper.ts`
- Test: `src/app/api/market/activity/sold/soldMapper.test.ts` (extend)

- [ ] **Step 1: Failing test for the mapper** — add to `soldMapper.test.ts`:

```ts
  it("carries DealType through (defaults to sold)", () => {
    expect(mapSoldDoc({ id: "X1", DealType: "leased", PurchaseContractDate: 1 }).dealType).toBe("leased");
    expect(mapSoldDoc({ id: "X2", PurchaseContractDate: 1 }).dealType).toBe("sold");
  });
```

- [ ] **Step 2: Run — expect FAIL** (`dealType` not on `SoldListing`). `npx vitest run src/app/api/market/activity/sold/soldMapper.test.ts`

- [ ] **Step 3: Implement in `soldMapper.ts`** — add to `interface SoldListing`:

```ts
  /** 'sold' | 'leased' — real-values deal type from the index. */
  dealType: "sold" | "leased";
```

and in `mapSoldDoc`'s returned object:

```ts
    dealType: (d.DealType as string) === "leased" ? "leased" : "sold",
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Route — replace the price gate with `DealType`.** In `route.ts`:
  - Add `dealType: "sold" | "leased"` to `interface SoldParams`.
  - In `buildSoldFilter`, replace the `ClosePrice:>=${PRICE_FLOOR}` clause with a deal-type clause, keeping a small sanity floor:
    ```ts
    `DealType:=${p.dealType}`,
    `ClosePrice:>=1`,
    ```
    (Leave `PRICE_FLOOR` constant defined but unused-by-filter, or delete it — leases need rent values < 50k.)
  - In the `GET` handler, read it: `const dealType = sp.get("dealType") === "leased" ? "leased" : "sold";` and add `dealType` to the `params` object.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/app/api/market/activity/sold/route.ts src/app/api/market/activity/sold/soldMapper.ts src/app/api/market/activity/sold/soldMapper.test.ts
git commit -m "feat(comps): sold route filters by DealType (sold|leased), not price"
```

---

## Phase 1 — Store + multi-select control

### Task 1.1: Layer model (pure) + store migration

**Files:**
- Create: `src/lib/sold/layers.ts`
- Test: `src/lib/sold/layers.test.ts`
- Modify: `src/lib/stores/commandCenterStore.ts`

- [ ] **Step 1: Failing test**

```ts
// src/lib/sold/layers.test.ts
import { describe, it, expect } from "vitest";
import { LAYER_KEYS, toggleLayer, transactionModeForLayers, queryPlan, deriveLegacyListingMode } from "./layers";

describe("layers", () => {
  it("toggle adds/removes but never empties (last layer sticks)", () => {
    expect([...toggleLayer(new Set(["forSale"]), "sold")]).toEqual(["forSale", "sold"]);
    expect([...toggleLayer(new Set(["forSale", "sold"]), "sold")]).toEqual(["forSale"]);
    expect([...toggleLayer(new Set(["sold"]), "sold")]).toEqual(["sold"]); // can't empty
  });
  it("transactionMode: sale wins, else rent, else sale", () => {
    expect(transactionModeForLayers(new Set(["forRent"]))).toBe("rent");
    expect(transactionModeForLayers(new Set(["forSale", "forRent"]))).toBe("sale");
    expect(transactionModeForLayers(new Set(["sold"]))).toBe("sale");
  });
  it("queryPlan splits active vs comp sources", () => {
    const p = queryPlan(new Set(["forSale", "sold", "leased"]));
    expect(p.active).toEqual({ enabled: true, sale: true, rent: false });
    expect(p.comps).toEqual(["sold", "leased"]);
  });
  it("comp-only plan disables the active source", () => {
    expect(queryPlan(new Set(["sold"])).active).toBeNull();
  });
  it("legacy listingMode: sale/rent win, comp-only → sold", () => {
    expect(deriveLegacyListingMode(new Set(["forSale", "sold"]))).toBe("sale");
    expect(deriveLegacyListingMode(new Set(["forRent"]))).toBe("rent");
    expect(deriveLegacyListingMode(new Set(["leased"]))).toBe("sold");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/lib/sold/layers.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/lib/sold/layers.ts
import type { TransactionMode } from "@/lib/filters/fundamentals";

export type LayerKey = "forSale" | "sold" | "leased" | "forRent";
export const LAYER_KEYS: LayerKey[] = ["forSale", "sold", "leased", "forRent"];

/** Toggle a layer; never returns an empty set (the last lit layer stays on). */
export function toggleLayer(layers: Set<LayerKey>, key: LayerKey): Set<LayerKey> {
  const next = new Set(layers);
  if (next.has(key)) {
    if (next.size === 1) return next; // refuse to empty
    next.delete(key);
  } else next.add(key);
  return next;
}

/** Price-slider / class axis follow the active transaction: sale wins, else rent. */
export function transactionModeForLayers(layers: Set<LayerKey>): TransactionMode {
  if (layers.has("forSale")) return "sale";
  if (layers.has("forRent")) return "rent";
  return "sale";
}

export interface LayerQueryPlan {
  active: { enabled: true; sale: boolean; rent: boolean } | null;
  comps: Array<"sold" | "leased">;
}

/** Which sources to fetch: one active Typesense query (sale/rent) + comp routes. */
export function queryPlan(layers: Set<LayerKey>): LayerQueryPlan {
  const sale = layers.has("forSale");
  const rent = layers.has("forRent");
  const comps: Array<"sold" | "leased"> = [];
  if (layers.has("sold")) comps.push("sold");
  if (layers.has("leased")) comps.push("leased");
  return { active: sale || rent ? { enabled: true, sale, rent } : null, comps };
}

/** Lossy back-compat value for the legacy `listingMode` field during migration only. */
export function deriveLegacyListingMode(layers: Set<LayerKey>): "sale" | "sold" | "rent" {
  if (layers.has("forSale")) return "sale";
  if (layers.has("forRent")) return "rent";
  return "sold"; // comp-only (sold/leased) maps to the legacy "sold" view
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Migrate the store (keep `listingMode` SYNCED so every commit stays green).** In `commandCenterStore.ts`:
  - Import: `import { type LayerKey, transactionModeForLayers, deriveLegacyListingMode } from "@/lib/sold/layers";`
  - ADD to the interface (do NOT delete `listingMode` yet — it stays as a synced back-compat value so `page.tsx`/`LedgerPanel` keep compiling until they migrate in Phase 2):
    ```ts
    // Active layers — multi-select For Sale·Sold·Leased·For Rent (any combination,
    // never empty). transactionMode/price bounds follow transactionModeForLayers().
    activeLayers: Set<LayerKey>;
    toggleLayer: (key: LayerKey) => void;
    ```
  - In the store body, ADD `activeLayers`/`toggleLayer` (which also keeps `listingMode` in sync), and DELETE only `setListingMode` (its sole caller, FilterBar, moves to `toggleLayer` in Task 1.2 — grep `setListingMode` first to confirm no other caller; migrate any stray caller in this commit):
    ```ts
    activeLayers: new Set<LayerKey>(["forSale"]),
    toggleLayer: (key) =>
      set((state) => {
        const next = new Set(state.activeLayers);
        if (next.has(key)) { if (next.size > 1) next.delete(key); }
        else next.add(key);
        const tx = transactionModeForLayers(next);
        const { min, max } = priceConfig(tx);
        return {
          activeLayers: next,
          transactionMode: tx,
          listingMode: deriveLegacyListingMode(next), // synced back-compat; removed in Task 3.4 Step 1
          universalFilters: { ...state.universalFilters, price: [min, max] },
        };
      }),
    ```
  - Keep `listingMode` (initial `"sale"`, now updated only by `toggleLayer`), the `ListingMode` type, `transactionMode`, `setTransactionMode`, `soldWindowDays`, `soldLocked`, `propertyClass`. Remove the `setListingMode` interface line + its implementation.

- [ ] **Step 6: Typecheck + commit (GREEN — `listingMode` still exists, now synced).**

```bash
npm run typecheck
git add src/lib/sold/layers.ts src/lib/sold/layers.test.ts src/lib/stores/commandCenterStore.ts
git commit -m "feat(comps): activeLayers store model (listingMode kept synced)"
```

### Task 1.2: `LayerChips` control + FilterBar wiring

**Files:**
- Create: `src/components/CommandCenter/LayerChips.tsx`
- Modify: `src/components/CommandCenter/FilterBar.tsx`
- Modify: `src/lib/stores/commandCenterStore.ts` (committed here with Task 1.1 Step 5)

- [ ] **Step 1: Build the multi-select chips.**

```tsx
// src/components/CommandCenter/LayerChips.tsx
"use client";
import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { LAYER_KEYS, type LayerKey } from "@/lib/sold/layers";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const META: Record<LayerKey, { label: string; on: string }> = {
  forSale: { label: "For Sale", on: "bg-emerald-500/15 text-emerald-300" },
  sold:    { label: "Sold",     on: "bg-rose-500/15 text-rose-300" },
  leased:  { label: "Leased",   on: "bg-violet-500/15 text-violet-300" },
  forRent: { label: "For Rent", on: "bg-teal-500/15 text-teal-300" },
};

/** Independent multi-select status layers (any combination; never empty). */
export default function LayerChips() {
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  const toggleLayer = useCommandCenterStore((s) => s.toggleLayer);
  return (
    <div role="group" aria-label="Listing layers" className="flex shrink-0 items-center divide-x divide-slate-800 border border-slate-800 bg-slate-900">
      {LAYER_KEYS.map((key) => {
        const active = activeLayers.has(key);
        return (
          <button key={key} type="button" aria-pressed={active} onClick={() => toggleLayer(key)}
            className={cn(LABEL, "px-2.5 py-1.5 transition-colors", active ? META[key].on : "text-slate-400 hover:text-slate-200")}>
            {META[key].label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Wire FilterBar.** In `FilterBar.tsx`:
  - Replace `listingMode, setListingMode` in the `useCommandCenterStore()` destructure with `activeLayers`.
  - Add a derived flag near the top of the component: `const compOnly = !activeLayers.has("forSale") && !activeLayers.has("forRent");`
  - Replace the `<FundamentalToggle ariaLabel="Listing status" .../>` block + the `{listingMode === "sold" && <SoldWindowDropdown />}` line with:
    ```tsx
    <LayerChips />
    {(activeLayers.has("sold") || activeLayers.has("leased")) && <SoldWindowDropdown />}
    ```
  - Replace every remaining `listingMode !== "sold"` guard with `!compOnly` (the active-browse controls show whenever an active layer is on). Update the `investorLayer` line to: `const investorLayer = !compOnly && isInvestorLayerActive(transactionMode, propertyClass);`
  - Import `LayerChips` and remove the now-unused `FundamentalToggle` import for the status strip (keep it for the Residential/Commercial toggle).

- [ ] **Step 3: Typecheck + lint — GREEN.** `npm run typecheck && npm run lint`. `page.tsx`/`LedgerPanel.tsx` still read the synced `listingMode`, so they compile; FilterBar now drives `activeLayers`/`toggleLayer`.

- [ ] **Step 4: Commit the control**

```bash
git add src/components/CommandCenter/LayerChips.tsx src/components/CommandCenter/FilterBar.tsx
git commit -m "feat(comps): multi-select layer chips replace the exclusive strip"
```

---

## Phase 2 — Multi-source fetch + merge + combined map/list + clustering

### Task 2.1: Merge helper + per-doc layer status (pure)

**Files:**
- Create: `src/lib/sold/mergeLayers.ts`
- Test: `src/lib/sold/mergeLayers.test.ts`
- Create: `src/lib/listings/layerStatus.ts`
- Test: `src/lib/listings/layerStatus.test.ts`
- Modify: `src/lib/typesense/client.ts` (`ListingDocument` fields)

- [ ] **Step 1: Add discriminators to `ListingDocument`** in `client.ts` (near the existing `IsSoldComp`/`SoldDate`):

```ts
  /** Comp layer for an adapted VOW comp ('sold' | 'leased'); absent for active docs. */
  compKind?: "sold" | "leased";
  /** Leased ("contract") date as ISO string — leased comps only. */
  LeasedDate?: string;
```

- [ ] **Step 2: Failing tests**

```ts
// src/lib/listings/layerStatus.test.ts
import { describe, it, expect } from "vitest";
import { layerStatus } from "./layerStatus";
import type { ListingDocument } from "@/lib/typesense/client";
const doc = (p: Partial<ListingDocument>): ListingDocument => ({ id: "x", ListPrice: 1, location: [0,0], isDistressed: false, hasSecondarySuitePotential: false, ...p });
describe("layerStatus", () => {
  it("comp kinds win", () => {
    expect(layerStatus(doc({ compKind: "sold" })).label).toBe("SOLD");
    expect(layerStatus(doc({ compKind: "leased" })).label).toBe("LEASED");
  });
  it("active uses TransactionType", () => {
    expect(layerStatus(doc({ TransactionType: "For Lease" })).label).toBe("FOR RENT");
    expect(layerStatus(doc({ TransactionType: "For Sale" })).label).toBe("FOR SALE");
  });
});
```

```ts
// src/lib/sold/mergeLayers.test.ts
import { describe, it, expect } from "vitest";
import { mergeLayers } from "./mergeLayers";
import type { ListingDocument } from "@/lib/typesense/client";
const d = (id: string, t?: number): ListingDocument => ({ id, ListPrice: 1, location: [0,0], isDistressed: false, hasSecondarySuitePotential: false, EntryTimestamp: t });
describe("mergeLayers", () => {
  it("concatenates, de-dupes by id (first wins), sorts by recency desc", () => {
    const out = mergeLayers([[d("a", 100), d("b", 300)], [d("b", 999), d("c", 200)]]);
    expect(out.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});
```

- [ ] **Step 3: Run — expect FAIL** for both.

- [ ] **Step 4: Implement**

```ts
// src/lib/listings/layerStatus.ts
import type { ListingDocument } from "@/lib/typesense/client";
export type LayerTone = "sale" | "sold" | "leased" | "rent";
export interface LayerStatus { label: string; tone: LayerTone; }

/** The status chip for any merged doc — comp kind first, else active TransactionType. */
export function layerStatus(doc: ListingDocument): LayerStatus {
  if (doc.compKind === "sold") return { label: "SOLD", tone: "sold" };
  if (doc.compKind === "leased") return { label: "LEASED", tone: "leased" };
  if (doc.TransactionType && /lease/i.test(doc.TransactionType)) return { label: "FOR RENT", tone: "rent" };
  return { label: "FOR SALE", tone: "sale" };
}

export const LAYER_TONE_CLASS: Record<LayerTone, string> = {
  sale: "bg-emerald-500/15 text-emerald-300",
  sold: "bg-rose-500/15 text-rose-300",
  leased: "bg-violet-500/15 text-violet-300",
  rent: "bg-teal-500/15 text-teal-300",
};
```

```ts
// src/lib/sold/mergeLayers.ts
import type { ListingDocument } from "@/lib/typesense/client";

/** "Recency" for interleaving: leased/sold date, else listing entry timestamp. */
function recency(d: ListingDocument): number {
  const iso = d.LeasedDate ?? d.SoldDate;
  if (iso) { const t = new Date(iso).getTime(); if (Number.isFinite(t)) return t; }
  return d.EntryTimestamp ?? 0;
}

/** Merge per-source doc lists into one: de-dupe by id (first source wins), sort recency desc. */
export function mergeLayers(sources: ListingDocument[][]): ListingDocument[] {
  const byId = new Map<string, ListingDocument>();
  for (const list of sources) for (const doc of list) if (!byId.has(doc.id)) byId.set(doc.id, doc);
  return [...byId.values()].sort((a, b) => recency(b) - recency(a));
}
```

- [ ] **Step 5: Run — expect PASS** for both. `npx vitest run src/lib/sold/mergeLayers.test.ts src/lib/listings/layerStatus.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/typesense/client.ts src/lib/sold/mergeLayers.ts src/lib/sold/mergeLayers.test.ts src/lib/listings/layerStatus.ts src/lib/listings/layerStatus.test.ts
git commit -m "feat(comps): pure mergeLayers + per-doc layerStatus"
```

### Task 2.2: Adapter + fetchSoldComps support sold AND leased

**Files:**
- Modify: `src/lib/sold/adapter.ts`
- Modify: `src/lib/sold/fetchSoldComps.ts`
- Test: `src/lib/sold/adapter.test.ts` (extend); `src/lib/sold/buildSoldQuery.test.ts` (extend)

- [ ] **Step 1: Failing adapter test** — add to `adapter.test.ts`:

```ts
  it("sets compKind + LeasedDate for leased comps", () => {
    const doc = soldToListingDocument({ id: "L1", dealType: "leased", soldDate: "2026-05-01T00:00:00Z", closePrice: 3200, listPrice: 3300, address: "1 King St", lat: 43.6, lng: -79.4 } as any);
    expect(doc.compKind).toBe("leased");
    expect(doc.LeasedDate).toBe("2026-05-01T00:00:00Z");
    expect(doc.ListPrice).toBe(3200);
  });
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement in `adapter.ts`** — set the discriminators from `s.dealType` (note `SoldListing` now has `dealType`):

```ts
    IsSoldComp: true,
    compKind: s.dealType,
    SoldDate: s.dealType === "sold" ? (s.soldDate ?? undefined) : undefined,
    LeasedDate: s.dealType === "leased" ? (s.soldDate ?? undefined) : undefined,
```

- [ ] **Step 4: `fetchSoldComps` — fetch each comp kind.** Change the signature to accept the comp kinds and fetch them in parallel, returning the merged docs + a combined count + a locked flag. Update `buildSoldQuery` to take `dealType` and append `&dealType=${dealType}`:

```ts
// buildSoldQuery: after p.set("limit", ...)
  p.set("dealType", dealType);   // dealType: "sold" | "leased" added to SoldQueryArgs
```

```ts
// fetchSoldComps: new shape
export async function fetchSoldComps(
  args: Omit<SoldQueryArgs, "dealType"> & { kinds?: Array<"sold" | "leased"> }
): Promise<SoldCompsResult> {
  const kinds = args.kinds ?? ["sold"]; // default keeps the pre-Task-2.3 page.tsx caller green
  const results = await Promise.all(
    kinds.map(async (dealType) => {
      const qs = buildSoldQuery({ ...args, dealType });
      if (!qs) return { docs: [] as ListingDocument[], count: 0, locked: false };
      const res = await fetch(`/api/market/activity/sold?${qs}`);
      if (!res.ok) throw new Error(`sold fetch failed: ${res.status}`);
      const data = (await res.json()) as { count?: number; listings?: SoldListing[]; locked?: boolean };
      return { docs: (data.listings ?? []).map(soldToListingDocument), count: data.count ?? 0, locked: !!data.locked };
    })
  );
  return {
    docs: results.flatMap((r) => r.docs),
    count: results.reduce((n, r) => n + r.count, 0),
    locked: results.some((r) => r.locked),
  };
}
```
Add `dealType: "sold" | "leased";` to `interface SoldQueryArgs`.

- [ ] **Step 5: Update `buildSoldQuery.test.ts`** — add `dealType: "sold"` to existing call args and assert `dealType=sold` appears in the query string. Run both tests — expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sold/adapter.ts src/lib/sold/adapter.test.ts src/lib/sold/fetchSoldComps.ts src/lib/sold/buildSoldQuery.test.ts
git commit -m "feat(comps): adapter + fetchSoldComps handle sold and leased kinds"
```

### Task 2.3: `performSearch` multi-source fetch + merge

**Files:**
- Modify: `src/app/properties/page.tsx`

- [ ] **Step 1: Replace the `listingMode === "sold"` branch** at the top of `performSearch` with a comp-aware fan-out. Read `activeLayers` from the store destructure (replace `listingMode`). Build the plan, fetch active + comps in parallel, merge:

```tsx
    const plan = queryPlan(activeLayers); // import { queryPlan } from "@/lib/sold/layers"
    try {
      // Fan out: comps (gated VOW route, sold and/or leased) + active (public Typesense),
      // whichever layers are lit, in parallel. runActiveSearch() is the EXISTING active-query
      // body extracted into a local helper that RETURNS a SearchResult (no setState inside).
      const [compRes, activeRes] = await Promise.all([
        plan.comps.length
          ? fetchSoldComps({ mapBounds, location, windowDays: soldWindowDays, limit: MAX_LISTINGS, kinds: plan.comps })
          : Promise.resolve({ docs: [] as ListingDocument[], count: 0, locked: false }),
        plan.active ? runActiveSearch() : Promise.resolve(null),
      ]);

      setSoldLocked(plan.comps.length > 0 && compRes.locked);

      const sources: ListingDocument[][] = [];
      if (compRes.docs.length) sources.push(compRes.docs);
      if (activeRes) sources.push(activeRes.listings);
      const merged = mergeLayers(sources).slice(0, MAX_LISTINGS); // import mergeLayers

      const total = (activeRes?.totalFound ?? 0) + compRes.count;
      setSearchResult({ listings: merged, totalFound: total, page: 1, perPage: MAX_LISTINGS, processingTimeMs: activeRes?.processingTimeMs ?? 0 });
      setTotalCount(total);
      return;
    } catch (err) {
      console.error("[CommandCenter] Search error:", err);
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
```

  **Implementation note for the engineer:** the cleanest refactor is to extract the *existing* active-search body (lines building `coreClauses … searchListings(...)`) into a local `async function runActiveSearch(): Promise<SearchResult>` that returns the result instead of calling `setSearchResult`. Then `performSearch` becomes: build `plan`; fetch comps (if any) and active (if any) in parallel with `Promise.all`; `mergeLayers`; set a single `searchResult`. For `totalCount`, show the active `totalFound` when an active layer is on, plus the comp count; when comp-only, show the comp count (drives the gate teaser). Keep the existing `try/catch/finally(setIsLoading(false))`.

- [ ] **Step 2: Update dependencies + the reset-bounds effect.** Replace `listingMode` with `activeLayers` in the `performSearch` `useCallback` deps and in the `setMapBounds(null)` reset effect's dep array.

- [ ] **Step 3: Update the gate overlay.** Replace `const showSoldLock = listingMode === "sold" && soldLocked;` with `const showSoldLock = soldLocked;` (soldLocked is only set true when comp layers were fetched and locked). Keep the `soldLockMsg`/`VowGateOverlay` placements.

- [ ] **Step 4: Verify (no unit test — app surface).** `npm run typecheck && npm run lint && npm run build`. Then manual: `npx next dev -p 3000`, open `/properties`, toggle `Sold`, `Sold + For Sale`, `Leased`, confirm both panes populate and the merged list interleaves with no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/properties/page.tsx
git commit -m "feat(comps): performSearch fans out to active + comp sources and merges"
```

### Task 2.4: Map layer colors + clustering fix; ledger interleave + chips

**Files:**
- Modify: `src/components/Map/mapLogic.ts`
- Modify: `src/components/Map/AlphaMap.tsx`
- Modify: `src/components/CommandCenter/LedgerPanel.tsx`
- Test: `src/components/Map/mapLogic.test.ts` (extend, if present) or `src/components/Map/clusterOptions.test.ts` (new)

- [ ] **Step 1: Failing test for tighter, zoom-aware cluster radius**

```ts
// src/components/Map/clusterOptions.test.ts
import { describe, it, expect } from "vitest";
import { clusterRadiusForZoom } from "./mapLogic";
describe("clusterRadiusForZoom", () => {
  it("is tighter when zoomed out (don't blob a city), looser when zoomed in", () => {
    expect(clusterRadiusForZoom(11)).toBeLessThan(64);
    expect(clusterRadiusForZoom(11)).toBeLessThanOrEqual(clusterRadiusForZoom(16));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/components/Map/clusterOptions.test.ts`

- [ ] **Step 3: Implement in `mapLogic.ts`** — keep `CLUSTER_OPTIONS` but add a zoom-aware radius (smaller at low zoom so spread-out comps don't all merge):

```ts
/** Cluster radius (px) by zoom — smaller when zoomed out so dense comps don't blob
 *  into one bubble; truly coincident points (one building) still cluster at any radius. */
export function clusterRadiusForZoom(zoom: number): number {
  return zoom <= 12 ? 28 : zoom <= 14 ? 40 : 56;
}
```

- [ ] **Step 4: Use it in `AlphaMap.tsx`.** Replace the `clusterIndex` memo's `{ ...CLUSTER_OPTIONS }` radius with the zoom-aware value, and add `viewState.zoom` to the memo deps:

```ts
  const clusterIndex = useMemo(() => {
    const index = new Supercluster<PinProps>({ ...CLUSTER_OPTIONS, radius: clusterRadiusForZoom(Math.round(viewState.zoom)) });
    index.load(renderData.map((p) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p.coordinates }, properties: { listing: p as ListingDocument } })));
    return index;
  }, [renderData, viewState.zoom]);
```
Import `clusterRadiusForZoom` from `./mapLogic`.

- [ ] **Step 5: Comp-layer pin colors.** In `AlphaMap.tsx`, give comp docs a fixed hue instead of the metric ramp. In the `listingPins` TextLayer `getBackgroundColor`, branch on `compKind` first:

```ts
      getBackgroundColor: (f) => {
        const listing = (f.properties as PinProps).listing;
        if (selectedIds.has(listing.id)) return [34, 211, 238, 255];
        if (listing.compKind === "sold") return [244, 63, 94, 230];     // rose
        if (listing.compKind === "leased") return [167, 139, 250, 230]; // violet
        const c = getScatterColor(listing);
        return [c[0], c[1], c[2], 235];
      },
```
Add `selectedIds` already in deps; no dep change needed (compKind is per-doc, stable in renderData). Comps thus read as red/violet while active keeps the yield ramp.

- [ ] **Step 6: Ledger header + interleaved status chips.** In `LedgerPanel.tsx`:
  - Replace the `listingMode` destructure with `activeLayers`.
  - Header: show a comps-aware label when any comp layer is on:
    ```tsx
    {(activeLayers.has("sold") || activeLayers.has("leased")) ? (
      <><span className="font-semibold text-cyan-400">{totalCount.toLocaleString()}</span> Comps
        <span className="mx-1.5 text-slate-600">|</span>VOW · last <span className="text-cyan-400">{soldWindowDays}d</span></>
    ) : ( /* existing "Active Listings" branch */ )}
    ```
  - The per-row status chip is rendered by `ListingCardBody` via `layerStatus` (Task 3.2), so no row-loop change here beyond passing the already-merged `properties`.

- [ ] **Step 7: Verify.** `npm run typecheck && npm run lint && npm run build`; manual: toggle Sold+For Sale, confirm red sold pins beside ramp-colored active pins, and that zooming the city no longer shows one mega-bubble.

- [ ] **Step 8: Commit**

```bash
git add src/components/Map/mapLogic.ts src/components/Map/clusterOptions.test.ts src/components/Map/AlphaMap.tsx src/components/CommandCenter/LedgerPanel.tsx
git commit -m "feat(comps): zoom-aware clustering + comp pin colors + ledger header"
```

---

## Phase 3 — Leased card, filters across layers, single disclaimer

### Task 3.1: `ListingCardBody` — leased branch, status chip, remove per-card notice

**Files:**
- Modify: `src/components/CommandCenter/ListingCardBody.tsx`

- [ ] **Step 1: Generalise the comp branch.** Change `if (doc.IsSoldComp) {` to handle both kinds. Replace the hard-coded `Sold` chip + date with `layerStatus(doc)` (import `layerStatus`, `LAYER_TONE_CLASS` from `@/lib/listings/layerStatus`), use `LeasedDate` for leased and add a `/mo` suffix on price for leased:

```tsx
  if (doc.compKind || doc.IsSoldComp) {
    const status = layerStatus(doc);
    const isLeased = doc.compKind === "leased";
    const delta = soldVsAsk(doc.ListPrice, doc.OriginalListPrice ?? null);
    const onIso = isLeased ? doc.LeasedDate : doc.SoldDate;
    const on = onIso ? new Date(onIso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
    const deltaTone = delta?.direction === "over" ? "text-rose-300" : delta?.direction === "under" ? "text-emerald-300" : "text-slate-300";
    return (
      <>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={cn("shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide", LAYER_TONE_CLASS[status.tone])}>{status.label}</span>
          {on && <span className="text-slate-500">{on}</span>}
        </div>
        <p className="mt-0.5 truncate font-sans text-base font-bold text-cyan-300">
          {doc.ListPrice ? `$${doc.ListPrice.toLocaleString()}${isLeased ? "/mo" : ""}` : "—"}
        </p>
        {/* …existing delta + address + chips + MLS·type·brokerage block, unchanged… */}
      </>
    );
  }
```
  - **Remove** the per-card §6.3 `<p className="mt-1 text-[9px] …">Sold data via TRREB VOW …</p>` line entirely (the single notice lives in the ledger footer — Task 3.3).

- [ ] **Step 2: Verify.** `npm run typecheck && npm run lint`; manual: a leased comp shows `LEASED`, `$3,200/mo`, leased date, brokerage, and no per-card disclaimer.

- [ ] **Step 3: Commit**

```bash
git add src/components/CommandCenter/ListingCardBody.tsx
git commit -m "feat(comps): leased card layout via layerStatus; drop per-card VOW notice"
```

### Task 3.2: Single VOW notice in the ledger footer

**Files:**
- Modify: `src/components/CommandCenter/LedgerPanel.tsx`

- [ ] **Step 1: Add the one-line notice** above/within the existing footer, shown only when a comp layer is on:

```tsx
      {(activeLayers.has("sold") || activeLayers.has("leased")) && (
        <p className="border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[9px] leading-tight text-slate-600">
          Sold/leased data via TRREB VOW — deemed reliable but not guaranteed accurate by PROPTX; for consumers with a bona fide interest only, not for any commercial purpose.
        </p>
      )}
```
(Place directly above the existing `{/* Footer */}` block. Brokerage stays per-row in `ListingCardBody` — §6.3(c).)

- [ ] **Step 2: Verify + commit.** `npm run typecheck && npm run lint`.

```bash
git add src/components/CommandCenter/LedgerPanel.tsx
git commit -m "feat(comps): single VOW notice in ledger footer (not per card)"
```

### Task 3.3: Basic filters apply to comp layers

**Files:**
- Modify: `src/lib/sold/fetchSoldComps.ts` (+ `buildSoldQuery`)
- Modify: `src/app/properties/page.tsx` (pass universal filter values into `fetchSoldComps`)

- [ ] **Step 1: Map universal filters → sold route params.** The route already accepts `types,minBeds,minBaths,minGarage,basement,minFrontage`. In `buildSoldQuery`, accept an optional `filters` object and append the params it supports:

```ts
  if (filters?.minBeds) p.set("minBeds", String(filters.minBeds));
  if (filters?.minBaths) p.set("minBaths", String(filters.minBaths));
  if (filters?.types?.length) p.set("types", filters.types.join(","));
  // price → ClosePrice range is NOT a route param today; covered by deal-type + window. (YAGNI: add only if asked.)
```

- [ ] **Step 2: In `page.tsx`,** derive the comp `filters` from `universalFilters` (beds/baths/type keys) and pass them into `fetchSoldComps`. Keep persona/investor chips OUT of the comp query (they have no forward metrics) — only basic universal filters flow to comps.

- [ ] **Step 3: Verify.** `npm run typecheck && npm run lint && npm run build`; manual: set Beds≥3 with Sold on → comp results shrink accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sold/fetchSoldComps.ts src/app/properties/page.tsx
git commit -m "feat(comps): basic filters (beds/baths/type) apply to comp layers"
```

### Task 3.4: Remove the legacy shim + final verification

- [ ] **Step 1: Drop the `listingMode` shim.** Now that `page.tsx` (Task 2.3) and `LedgerPanel` (Task 2.4) read `activeLayers`, grep `listingMode` repo-wide — expect zero readers outside the store. Delete the `listingMode` field + `ListingMode` type from `commandCenterStore.ts`, the `listingMode: deriveLegacyListingMode(next)` line from `toggleLayer`, and `deriveLegacyListingMode` + its test from `layers.ts`. `npm run typecheck` to confirm nothing references it. Commit: `chore(comps): drop legacy listingMode shim`.
- [ ] **Step 2: Full gate.** `npm run typecheck && npm run lint && npm run build && npx vitest run` — all green.
- [ ] **Step 3: Manual matrix** on `/properties` (fresh `npx next dev`): For Sale only; Sold only (anon → count teaser, 0 rows; signed-in → rows); Sold + For Sale (merged, red+ramp pins, interleaved list, single notice); For Rent + Leased; clustering no longer blobs at city zoom; leased card shows `/mo`.
- [ ] **Step 4:** Use `superpowers:finishing-a-development-branch` to open the PR.

---

## Self-Review

**Spec coverage:** Layer taxonomy → 1.1/1.2; DealType real values → 0.1–0.4; re-backfill/blob-is-clustering → 0.3 + 2.4; combined fetch/merge → 2.1–2.3; pin colors → 2.4; interleaved list + chips → 2.1/2.4/3.1; leased card → 3.1; single disclaimer → 3.2; filters across layers → 3.3; compliance (gate, ≤100, brokerage, one notice) → 2.3/3.1/3.2. All covered.

**Type consistency:** `LayerKey` (forSale|sold|leased|forRent), `DealType`/`compKind` (sold|leased), `layerStatus`→`LayerTone` (sale|sold|leased|rent), `queryPlan().comps: Array<"sold"|"leased">`, `fetchSoldComps({kinds})`, `mergeLayers(sources[][])` — names consistent across tasks.

**Known integration risk (flagged for the implementer):** Task 2.3 is the one non-mechanical refactor (extract `runActiveSearch`, fan-out, merge, and reconcile `totalCount`). Treat its merge/count logic as the place to slow down and verify in the running app.
