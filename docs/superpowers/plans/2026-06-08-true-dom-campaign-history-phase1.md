# True DOM Campaign-History — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for HouseSigma-parity True DOM — a `property_campaign_history` table, a deterministic `campaignHistory` module (fetch + normalize), and a corrected True DOM engine v2 — all unit-tested, with no behavior change to the live app yet.

**Architecture:** A per-property campaign ledger is reconstructed from the VOW feed by address. This phase delivers the pure pieces: the table (storage), `normalize` (raw VOW → `CampaignEvent[]`), `fetch` (address query + unit filtering), and `computeTrueDomFromCampaigns` (start→next-start stitch over *real* terminal dates, replacing the broken `ModificationTimestamp`-as-end logic). Wiring into the sync/read paths and the UI are Phases 2–3.

**Tech Stack:** TypeScript, Vitest (node-env, pure-logic — no React render tests), Supabase/Postgres (`pg` via Session pooler), the AMPRE/ProptX OData feed via `ProptXClient`.

**Spec:** `docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md`

**Conventions:**
- Tests: `npm run test` (all) or `npx vitest run <path>` (one file). Type/lint: `npm run typecheck`, `npm run lint`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Work on branch `feat/true-dom-campaign-history` (already cut from `main`).

---

## File structure (Phase 1)

- Create `supabase/migrations/032_create_property_campaign_history.sql` — the ledger table (storage).
- Create `scripts/admin/applyMigration032.ts` — apply the migration via the Session pooler.
- Create `src/lib/campaignHistory/types.ts` — shared types (`CampaignEvent`, `CampaignStatus`, …).
- Create `src/lib/campaignHistory/normalize.ts` (+ `.test.ts`) — raw VOW record → `CampaignEvent`.
- Create `src/lib/campaignHistory/fetch.ts` (+ `.test.ts`) — address filter + unit filter + live fetch wrapper.
- Create `src/lib/campaignHistory/trueDom.ts` (+ `.test.ts`) — `computeTrueDomFromCampaigns`.

Each file has one responsibility; `trueDom.ts` reuses `parseTimestamp`/`daysBetween` and `fetch.ts` reuses `unitsMatchForMerge`/`normalizeAddressComponent` from `src/lib/typesense/TemporalDistressEngine.ts` (DRY).

---

## Task 1: Migration — `property_campaign_history`

**Files:**
- Create: `supabase/migrations/032_create_property_campaign_history.sql`
- Create: `scripts/admin/applyMigration032.ts`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/032_create_property_campaign_history.sql`:

```sql
-- Migration 032: property_campaign_history
-- Per-property campaign ledger (one row per property_hash) powering the corrected
-- True DOM and the HouseSigma-parity event timeline. Reconstructed from the VOW feed
-- by address (scripts + getListingDetail, Phases 2-3); SEPARATE from the sold-only
-- property_sale_history (which stays for AVM/comps). See
-- docs/superpowers/specs/2026-06-08-true-dom-campaign-history-design.md.

CREATE TABLE IF NOT EXISTS property_campaign_history (
  property_hash      VARCHAR(64) PRIMARY KEY,
  -- newest-first array of CampaignEvent (see src/lib/campaignHistory/types.ts):
  --   { listing_key, transaction_type, status, entry_date, end_date, end_reason,
  --     list_price, original_list_price, close_price, brokerage, price_change_date, address }
  events             JSONB DEFAULT '[]'::jsonb,
  true_dom           INTEGER,        -- current continuous SALE campaign (35-day stitch)
  total_price_drop   NUMERIC,        -- over that current stitched campaign (>=0)
  campaign_count     INTEGER DEFAULT 0,
  first_seen_date    DATE,
  is_stale           BOOLEAN DEFAULT FALSE,
  fetched_at         TIMESTAMPTZ,    -- TTL / freshness anchor (24h)
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE property_campaign_history IS
  'Per-property campaign ledger (one row per property_hash) for corrected True DOM + event timeline. Reconstructed from the VOW feed by address; refreshed nightly for active listings.';

-- Reuse the shared updated_at trigger fn (defined in migration 007).
DROP TRIGGER IF EXISTS update_property_campaign_history_updated_at ON property_campaign_history;
CREATE TRIGGER update_property_campaign_history_updated_at
  BEFORE UPDATE ON property_campaign_history
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Write the apply script**

Create `scripts/admin/applyMigration032.ts`:

```ts
/**
 * Apply migration 032 (property_campaign_history) via the Session pooler.
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md §12).
 * Run: npx tsx --env-file=.env scripts/admin/applyMigration032.ts
 */
import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const cs = (process.env.DATABASE_URL || '').trim();
  if (!cs) {
    console.error('❌ DATABASE_URL not set (use the Supabase Session pooler string).');
    process.exit(1);
  }
  const sql = readFileSync(
    join(process.cwd(), 'supabase/migrations/032_create_property_campaign_history.sql'),
    'utf8'
  );
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("SET statement_timeout TO '60000'");
    await client.query(sql);
    const { rows } = await client.query(
      "SELECT to_regclass('public.property_campaign_history') AS tbl"
    );
    console.log(`✅ Applied. property_campaign_history = ${rows[0].tbl}`);
  } finally {
    await client.end();
  }
}
main().catch((e) => {
  console.error('CRASH', e.message);
  process.exit(1);
});
```

- [ ] **Step 3: Apply the migration**

Run: `npx tsx --env-file=.env scripts/admin/applyMigration032.ts`
Expected: `✅ Applied. property_campaign_history = property_campaign_history`

(Fallback if `DATABASE_URL` isn't the pooler here: paste the SQL from Step 1 into the Supabase SQL editor and run — it's instant DDL, CLAUDE.md §12.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/032_create_property_campaign_history.sql scripts/admin/applyMigration032.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): migration 032 — property_campaign_history ledger table

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/campaignHistory/types.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/campaignHistory/types.ts`:

```ts
/** Campaign-history domain types. One CampaignEvent == one listing (campaign). */

export type TransactionKind = 'Sale' | 'Lease';
export type CampaignStatus = 'Active' | 'Terminated' | 'Expired' | 'Suspended' | 'Sold';

/** One campaign (listing) at a physical address, normalized from the VOW feed. */
export interface CampaignEvent {
  listing_key: string;
  transaction_type: TransactionKind;
  status: CampaignStatus;
  entry_date: string | null;        // OriginalEntryTimestamp (ISO)
  end_date: string | null;          // resolved terminal date for the status
  end_reason: CampaignStatus | null; // null while Active
  list_price: number | null;        // last/current list price for the campaign
  original_list_price: number | null;
  close_price: number | null;       // Sold only
  brokerage: string | null;         // ListOfficeName
  price_change_date: string | null; // PriceChangeTimestamp (one net change per campaign)
  address: string | null;           // UnparsedAddress
}

/** Result of computeTrueDomFromCampaigns. */
export interface CampaignTrueDom {
  true_dom: number;
  total_price_drop: number;
  campaign_count: number;
  is_stale: boolean;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/campaignHistory/types.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): campaignHistory shared types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Normalize (raw VOW → CampaignEvent)

**Files:**
- Create: `src/lib/campaignHistory/normalize.ts`
- Test: `src/lib/campaignHistory/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/campaignHistory/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapStatus, normalizeCampaign, normalizeCampaigns, type RawVowCampaign } from './normalize';

describe('mapStatus', () => {
  it('maps the real VOW status pairs', () => {
    expect(mapStatus('Active', 'New')).toBe('Active');
    expect(mapStatus('Cancelled', 'Terminated')).toBe('Terminated');
    expect(mapStatus('Expired', 'Expired')).toBe('Expired');
    expect(mapStatus('Closed', 'Sold')).toBe('Sold');
    expect(mapStatus('Suspended', 'Suspended')).toBe('Suspended');
  });
  it('treats Sold/Closed with highest precedence', () => {
    expect(mapStatus('Closed', 'Terminated')).toBe('Sold');
  });
});

describe('normalizeCampaign', () => {
  it('normalizes a terminated sale with a real end date', () => {
    const raw: RawVowCampaign = {
      ListingKey: 'N13135326', StandardStatus: 'Cancelled', MlsStatus: 'Terminated',
      TransactionType: 'For Sale', OriginalEntryTimestamp: '2026-05-15T17:38:46Z',
      ListPrice: 1850000, OriginalListPrice: 1699900, TerminatedDate: '2026-06-04',
      PriceChangeTimestamp: '2026-05-27T12:53:06Z', ListOfficeName: 'ACME REALTY',
      UnparsedAddress: '363 Maria Antonia Road, Vaughan, ON L4H 0X5',
    };
    const e = normalizeCampaign(raw)!;
    expect(e.transaction_type).toBe('Sale');
    expect(e.status).toBe('Terminated');
    expect(e.end_date).toBe('2026-06-04');
    expect(e.end_reason).toBe('Terminated');
    expect(e.original_list_price).toBe(1699900);
    expect(e.price_change_date).toBe('2026-05-27T12:53:06Z');
    expect(e.brokerage).toBe('ACME REALTY');
  });

  it('emits no price_change_date when list == original', () => {
    const e = normalizeCampaign({
      ListingKey: 'X', StandardStatus: 'Active', MlsStatus: 'New', TransactionType: 'For Sale',
      ListPrice: 500000, OriginalListPrice: 500000,
    })!;
    expect(e.price_change_date).toBeNull();
    expect(e.end_date).toBeNull();
    expect(e.end_reason).toBeNull();
  });

  it('returns null when ListingKey is missing, never throws on sparse input', () => {
    expect(normalizeCampaign({})).toBeNull();
    expect(() => normalizeCampaign({ ListingKey: 'Y' })).not.toThrow();
  });

  it('classifies For Lease as Lease', () => {
    const e = normalizeCampaign({ ListingKey: 'L', TransactionType: 'For Lease', StandardStatus: 'Expired', MlsStatus: 'Expired', ExpirationDate: '2025-10-30' })!;
    expect(e.transaction_type).toBe('Lease');
    expect(e.status).toBe('Expired');
    expect(e.end_date).toBe('2025-10-30');
  });
});

describe('normalizeCampaigns', () => {
  it('drops unkeyed rows and sorts newest-first by entry_date', () => {
    const out = normalizeCampaigns([
      { ListingKey: 'A', TransactionType: 'For Sale', StandardStatus: 'Active', MlsStatus: 'New', OriginalEntryTimestamp: '2025-01-01T00:00:00Z' },
      {},
      { ListingKey: 'B', TransactionType: 'For Sale', StandardStatus: 'Active', MlsStatus: 'New', OriginalEntryTimestamp: '2026-01-01T00:00:00Z' },
    ]);
    expect(out.map((e) => e.listing_key)).toEqual(['B', 'A']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/normalize.test.ts`
Expected: FAIL — cannot find module `./normalize`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/campaignHistory/normalize.ts`:

```ts
import type { CampaignEvent, CampaignStatus, TransactionKind } from './types';

/** Subset of VOW /Property fields the campaign ledger consumes. */
export interface RawVowCampaign {
  ListingKey?: string;
  StandardStatus?: string;
  MlsStatus?: string;
  TransactionType?: string;
  PropertySubType?: string;
  OriginalEntryTimestamp?: string;
  ListPrice?: number | string;
  OriginalListPrice?: number | string;
  ClosePrice?: number | string;
  PurchaseContractDate?: string;
  CloseDate?: string;
  TerminatedDate?: string;
  ExpirationDate?: string;
  SuspendedDate?: string;
  UnavailableDate?: string;
  PriceChangeTimestamp?: string;
  ListOfficeName?: string;
  UnitNumber?: string;
  UnparsedAddress?: string;
  [k: string]: unknown;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  const s = v == null ? '' : String(v).trim();
  return s ? s : null;
}

/** Deterministic (StandardStatus, MlsStatus) -> CampaignStatus. Grounded in the
 *  live VOW feed: off-market is Cancelled/Expired (NOT StandardStatus 'Terminated'). */
export function mapStatus(standard?: string, mls?: string): CampaignStatus {
  const s = (standard ?? '').toLowerCase().trim();
  const m = (mls ?? '').toLowerCase().trim();
  if (s === 'closed' || m === 'sold' || m === 'leased') return 'Sold';
  if (s === 'active' || m === 'new' || m === 'price change' || m === 'extension' || m === 'active') return 'Active';
  if (s === 'cancelled' || s === 'canceled' || m === 'terminated') return 'Terminated';
  if (s === 'expired' || m === 'expired') return 'Expired';
  if (s === 'suspended' || m === 'suspended') return 'Suspended';
  return 'Active'; // unknown still-listed -> treat as on-market
}

function resolveEndDate(raw: RawVowCampaign, status: CampaignStatus): string | null {
  switch (status) {
    case 'Sold': return strOrNull(raw.CloseDate) ?? strOrNull(raw.PurchaseContractDate);
    case 'Terminated': return strOrNull(raw.TerminatedDate) ?? strOrNull(raw.UnavailableDate);
    case 'Expired': return strOrNull(raw.ExpirationDate) ?? strOrNull(raw.UnavailableDate);
    case 'Suspended': return strOrNull(raw.SuspendedDate) ?? strOrNull(raw.UnavailableDate);
    case 'Active': return null;
    default: return strOrNull(raw.UnavailableDate);
  }
}

export function normalizeCampaign(raw: RawVowCampaign): CampaignEvent | null {
  const listing_key = strOrNull(raw.ListingKey);
  if (!listing_key) return null;

  const status = mapStatus(raw.StandardStatus, raw.MlsStatus);
  const transaction_type: TransactionKind =
    String(raw.TransactionType ?? '').toLowerCase().includes('lease') ? 'Lease' : 'Sale';

  const list_price = numOrNull(raw.ListPrice);
  const original_list_price = numOrNull(raw.OriginalListPrice);
  const price_change_date =
    original_list_price != null && list_price != null && original_list_price !== list_price
      ? strOrNull(raw.PriceChangeTimestamp)
      : null;

  return {
    listing_key,
    transaction_type,
    status,
    entry_date: strOrNull(raw.OriginalEntryTimestamp),
    end_date: resolveEndDate(raw, status),
    end_reason: status === 'Active' ? null : status,
    list_price,
    original_list_price,
    close_price: numOrNull(raw.ClosePrice),
    brokerage: strOrNull(raw.ListOfficeName),
    price_change_date,
    address: strOrNull(raw.UnparsedAddress),
  };
}

/** Normalize a batch: drop unkeyed, dedupe by listing_key, sort newest-first by entry_date. */
export function normalizeCampaigns(raws: RawVowCampaign[]): CampaignEvent[] {
  const byKey = new Map<string, CampaignEvent>();
  for (const r of raws) {
    const e = normalizeCampaign(r);
    if (e && !byKey.has(e.listing_key)) byKey.set(e.listing_key, e);
  }
  return [...byKey.values()].sort((a, b) => {
    const at = a.entry_date ? Date.parse(a.entry_date) : 0;
    const bt = b.entry_date ? Date.parse(b.entry_date) : 0;
    return (Number.isNaN(bt) ? 0 : bt) - (Number.isNaN(at) ? 0 : at);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/normalize.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaignHistory/normalize.ts src/lib/campaignHistory/normalize.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): campaign normalizer (VOW record -> CampaignEvent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fetch (address filter + unit filter + wrapper)

**Files:**
- Create: `src/lib/campaignHistory/fetch.ts`
- Test: `src/lib/campaignHistory/fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/campaignHistory/fetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCampaignFilter, filterEventsToSubjectUnit } from './fetch';
import type { RawVowCampaign } from './normalize';

describe('buildCampaignFilter', () => {
  it('builds an OData filter from street + city', () => {
    expect(buildCampaignFilter({ StreetNumber: '363', StreetName: 'Maria Antonia', City: 'Vaughan' }))
      .toBe("StreetNumber eq '363' and StreetName eq 'Maria Antonia' and City eq 'Vaughan'");
  });
  it('escapes single quotes', () => {
    expect(buildCampaignFilter({ StreetNumber: '1', StreetName: "O'Connor", City: 'Toronto' }))
      .toBe("StreetNumber eq '1' and StreetName eq 'O''Connor' and City eq 'Toronto'");
  });
  it('returns null without a usable street', () => {
    expect(buildCampaignFilter({ City: 'Vaughan' })).toBeNull();
  });
});

describe('filterEventsToSubjectUnit', () => {
  const sale = (UnitNumber: string | undefined, PropertySubType: string): RawVowCampaign =>
    ({ ListingKey: 'k' + UnitNumber, UnitNumber, PropertySubType } as RawVowCampaign);

  it('keeps freehold rows with no unit', () => {
    const subject = { PropertySubType: 'Detached' };
    const rows = [sale(undefined, 'Detached'), sale(undefined, 'Detached')];
    expect(filterEventsToSubjectUnit(rows, subject)).toHaveLength(2);
  });

  it('keeps only the matching condo unit', () => {
    const subject = { UnitNumber: '1605', PropertySubType: 'Condo Apartment' };
    const rows = [sale('1605', 'Condo Apartment'), sale('1606', 'Condo Apartment')];
    const out = filterEventsToSubjectUnit(rows, subject);
    expect(out.map((r) => r.UnitNumber)).toEqual(['1605']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/fetch.test.ts`
Expected: FAIL — cannot find module `./fetch`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/campaignHistory/fetch.ts`:

```ts
import { ProptXClient } from '@/lib/proptx/client';
import { unitsMatchForMerge } from '@/lib/typesense/TemporalDistressEngine';
import { normalizeCampaigns, type RawVowCampaign } from './normalize';
import type { CampaignEvent } from './types';

/** Address + subtype the fetch/unit-filter needs. */
export interface SubjectAddress {
  StreetNumber?: unknown;
  StreetName?: unknown;
  City?: unknown;
  UnitNumber?: unknown;
  PropertySubType?: unknown;
}

const CAMPAIGN_SELECT = [
  'ListingKey', 'StandardStatus', 'MlsStatus', 'TransactionType', 'PropertySubType',
  'OriginalEntryTimestamp', 'ListPrice', 'OriginalListPrice', 'ClosePrice',
  'PurchaseContractDate', 'CloseDate', 'TerminatedDate', 'ExpirationDate',
  'SuspendedDate', 'UnavailableDate', 'PriorMlsStatus', 'PriceChangeTimestamp',
  'MajorChangeTimestamp', 'ListOfficeName', 'StreetNumber', 'StreetName', 'City',
  'UnitNumber', 'UnparsedAddress',
].join(',');

function odataEscape(v: string): string {
  return v.replace(/'/g, "''");
}

/** OData $filter to pull every campaign at a physical address. null when unusable. */
export function buildCampaignFilter(addr: SubjectAddress): string | null {
  const num = String(addr.StreetNumber ?? '').trim();
  const name = String(addr.StreetName ?? '').trim();
  const city = String(addr.City ?? '').trim();
  if (!num || !name) return null;
  const parts = [
    `StreetNumber eq '${odataEscape(num)}'`,
    `StreetName eq '${odataEscape(name)}'`,
  ];
  if (city) parts.push(`City eq '${odataEscape(city)}'`);
  return parts.join(' and ');
}

/** A building query returns all units; keep only the subject's unit (Phase-2 guards). */
export function filterEventsToSubjectUnit(
  rows: RawVowCampaign[],
  subject: SubjectAddress
): RawVowCampaign[] {
  return rows.filter((r) =>
    unitsMatchForMerge(
      { UnitNumber: subject.UnitNumber, PropertySubType: subject.PropertySubType },
      { UnitNumber: r.UnitNumber, PropertySubType: r.PropertySubType }
    )
  );
}

/**
 * Fetch + normalize every campaign at the subject's address from the VOW feed.
 * Best-effort: returns [] on a missing filter; the caller wraps network errors.
 */
export async function fetchCampaignsByAddress(
  addr: SubjectAddress,
  vowToken: string
): Promise<CampaignEvent[]> {
  const filter = buildCampaignFilter(addr);
  if (!filter) return [];
  const client = new ProptXClient(vowToken, 'VOW');
  const res = await client.getProperties({
    $filter: filter,
    $select: CAMPAIGN_SELECT,
    $top: '100',
    $count: 'true',
  } as Record<string, string>);
  const rows = ((res?.value ?? []) as unknown[]) as RawVowCampaign[];
  return normalizeCampaigns(filterEventsToSubjectUnit(rows, addr));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/fetch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaignHistory/fetch.ts src/lib/campaignHistory/fetch.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): campaign fetch — VOW address query + unit filter

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: True DOM engine v2

**Files:**
- Create: `src/lib/campaignHistory/trueDom.ts`
- Test: `src/lib/campaignHistory/trueDom.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/campaignHistory/trueDom.test.ts`. `NOW` is fixed so results are deterministic. The 363 fixture is the real chain (sale + lease).

```ts
import { describe, it, expect } from 'vitest';
import { computeTrueDomFromCampaigns } from './trueDom';
import type { CampaignEvent } from './types';

const NOW = Date.parse('2026-06-08T18:00:00Z'); // past the 17:38Z entry-of-day so 363 floors to exactly 24
const ev = (p: Partial<CampaignEvent>): CampaignEvent => ({
  listing_key: 'k', transaction_type: 'Sale', status: 'Terminated',
  entry_date: null, end_date: null, end_reason: null, list_price: null,
  original_list_price: null, close_price: null, brokerage: null,
  price_change_date: null, address: null, ...p,
});

// The real 363 Maria Antonia chain (sale + lease), newest-first.
const chain363: CampaignEvent[] = [
  ev({ listing_key: 'N13410488', status: 'Active', entry_date: '2026-06-06T14:46:17Z', end_date: null, end_reason: null, list_price: 1729000, original_list_price: 1729000 }),
  ev({ listing_key: 'N13135326', status: 'Terminated', entry_date: '2026-05-15T17:38:46Z', end_date: '2026-06-04', list_price: 1850000, original_list_price: 1699900 }),
  ev({ listing_key: 'N12656610', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-01-02T17:40:02Z', end_date: '2026-03-02', list_price: 5000 }),
  ev({ listing_key: 'N12500658', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-11-02T16:02:46Z', end_date: '2025-12-31', list_price: 5000 }),
  ev({ listing_key: 'N12409326', status: 'Terminated', entry_date: '2025-09-17T15:32:06Z', end_date: '2025-10-15', list_price: 1990000, original_list_price: 1990000 }),
  ev({ listing_key: 'N12343968', transaction_type: 'Lease', status: 'Expired', entry_date: '2025-08-14T14:08:06Z', end_date: '2025-10-30', list_price: 5300 }),
  ev({ listing_key: 'N12209050', transaction_type: 'Lease', status: 'Terminated', entry_date: '2025-06-10T13:28:48Z', end_date: '2025-08-07', list_price: 5300 }),
];

describe('computeTrueDomFromCampaigns — 363 Maria Antonia', () => {
  const r = computeTrueDomFromCampaigns(chain363, { nowMs: NOW });

  it('stitches the current sale campaign (05-15 -> now), not the 2025 effort', () => {
    expect(r.true_dom).toBe(24); // 2026-05-15 -> 2026-06-08
  });
  it('counts every campaign for the "listed N times" signal', () => {
    expect(r.campaign_count).toBe(7);
  });
  it('reports no drop (they raised the ask)', () => {
    expect(r.total_price_drop).toBe(0);
  });
  it('is not stale below 60 days', () => {
    expect(r.is_stale).toBe(false);
  });
});

describe('computeTrueDomFromCampaigns — edges', () => {
  it('a fresh active listing with no prior ≈ its own age', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'F', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);
    expect(r.campaign_count).toBe(1);
  });

  it('breaks the chain when the gap exceeds the window', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 900000, original_list_price: 900000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-01-01T00:00:00Z', end_date: '2026-02-01', list_price: 950000, original_list_price: 950000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2); // prior ended 2026-02-01, gap > 35d -> not stitched
  });

  it('stitches a prior within the window and surfaces the drop', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'N', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000, original_list_price: 800000 }),
        ev({ listing_key: 'O', status: 'Terminated', entry_date: '2026-05-10T00:00:00Z', end_date: '2026-05-20', list_price: 900000, original_list_price: 900000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(29);            // 2026-05-10 -> 2026-06-08
    expect(r.total_price_drop).toBe(100000); // 900k -> 800k
  });

  it('excludes lease campaigns from the sale True DOM', () => {
    const r = computeTrueDomFromCampaigns(
      [
        ev({ listing_key: 'S', status: 'Active', entry_date: '2026-06-06T00:00:00Z', list_price: 800000 }),
        ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Expired', entry_date: '2026-05-01T00:00:00Z', end_date: '2026-05-30', list_price: 3000 }),
      ],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(2);       // lease ignored for the number
    expect(r.campaign_count).toBe(2); // but still counted in the timeline tally
  });

  it('returns zero true_dom when there is no sale campaign', () => {
    const r = computeTrueDomFromCampaigns(
      [ev({ listing_key: 'L', transaction_type: 'Lease', status: 'Active', entry_date: '2026-06-01T00:00:00Z', list_price: 3000 })],
      { nowMs: NOW }
    );
    expect(r.true_dom).toBe(0);
    expect(r.campaign_count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/campaignHistory/trueDom.test.ts`
Expected: FAIL — cannot find module `./trueDom`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/campaignHistory/trueDom.ts`:

```ts
import { parseTimestamp } from '@/lib/typesense/TemporalDistressEngine';
import type { CampaignEvent, CampaignTrueDom } from './types';

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 35;
const DEFAULT_STALE_DAYS = 60;

interface SaleNode {
  e: CampaignEvent;
  startMs: number;
  endMs: number; // real terminal date, or nowMs for Active / unknown end
}

function resolveEndMs(e: CampaignEvent, nowMs: number): number {
  const end = parseTimestamp(e.end_date);
  return end !== null ? end : nowMs;
}

/**
 * True DOM over a property's full campaign history. Counts the CURRENT continuous
 * SALE campaign: stitch consecutive sale campaigns whose gap (prior end -> next
 * start) is within `windowDays`, then measure earliest-stitched-start -> now (or
 * the newest campaign's end if it is already off-market). Lease campaigns are
 * excluded from the number but counted in campaign_count.
 */
export function computeTrueDomFromCampaigns(
  events: CampaignEvent[],
  opts: { nowMs?: number; windowDays?: number; staleThresholdDays?: number } = {}
): CampaignTrueDom {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const staleDays = opts.staleThresholdDays ?? DEFAULT_STALE_DAYS;

  const campaign_count = new Set(events.map((e) => e.listing_key)).size;

  const sales: SaleNode[] = events
    .filter((e) => e.transaction_type === 'Sale')
    .map((e) => ({ e, startMs: parseTimestamp(e.entry_date), endMs: 0 }))
    .filter((n): n is { e: CampaignEvent; startMs: number; endMs: number } => n.startMs !== null)
    .map((n) => ({ ...n, endMs: resolveEndMs(n.e, nowMs) }))
    .sort((a, b) => b.startMs - a.startMs); // newest first

  if (sales.length === 0) {
    return { true_dom: 0, total_price_drop: 0, campaign_count, is_stale: false };
  }

  const newest = sales[0];
  const runEndMs = newest.e.status === 'Active' ? nowMs : newest.endMs;
  let earliestStartMs = newest.startMs;
  let originalListPrice = newest.e.original_list_price ?? newest.e.list_price ?? null;
  let nextStartMs = newest.startMs;

  for (let i = 1; i < sales.length; i++) {
    const prior = sales[i];
    const gapDays = Math.floor((nextStartMs - prior.endMs) / DAY_MS);
    if (gapDays > windowDays) break; // genuine separate selling effort
    earliestStartMs = prior.startMs;
    const priorOrig = prior.e.original_list_price ?? prior.e.list_price;
    if (priorOrig != null) originalListPrice = priorOrig;
    nextStartMs = prior.startMs;
  }

  const true_dom = Math.max(0, Math.floor((runEndMs - earliestStartMs) / DAY_MS));
  const currentList = newest.e.list_price ?? 0;
  const total_price_drop =
    originalListPrice != null && currentList > 0
      ? Math.max(0, originalListPrice - currentList)
      : 0;

  return { true_dom, total_price_drop, campaign_count, is_stale: true_dom > staleDays };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/campaignHistory/trueDom.test.ts`
Expected: PASS (all cases — note `true_dom` of 24 for 363 vs the broken `1`).

- [ ] **Step 5: Full verification + commit**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: all PASS.

```bash
git add src/lib/campaignHistory/trueDom.ts src/lib/campaignHistory/trueDom.test.ts
git commit -m "$(cat <<'EOF'
feat(true-dom): engine v2 — computeTrueDomFromCampaigns (start->next-start stitch)

Replaces the ModificationTimestamp end-proxy that collapsed relists to ~1 day.
Reproduces 363 Maria Antonia at true_dom=24 (was 1).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 done — what's next (separate plans)

- **Phase 2 (wiring):** ledger upsert/read helpers; replace the broken stitch in `scripts/worker/sync.ts`; `getListingDetail` read path (24h TTL, subject-always-merged, best-effort fallback, never overwrite a good `true_dom` with 0); one-time warm pass over active inventory + Typesense `TrueDom` reindex.
- **Phase 3 (UI):** `DOMTimelineChart` campaign-timeline mode (price-graph hero, off-market gaps, stitched-window shading, lease lane); `CampaignHistorySection` table; `gateCampaignHistory` + `gateVowDerived` extension.

These will each get their own plan after Phase 1 is verified, since they build on the exact signatures above.
```
