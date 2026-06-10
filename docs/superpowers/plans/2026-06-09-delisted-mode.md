# De-listed Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A gated "De-listed" layer on the /properties Terminal showing recently Terminated/Expired/Suspended listings (motivated-seller inventory), fed by a new VOW Query C with a 12-month Supabase archive and a 90-day Typesense window.

**Architecture:** Extend, don't duplicate — new `DealType` values in the existing `sold_listings` collection, a `dealType=delisted` extension on the existing `/api/market/activity/sold` route (auth gate inherited), a new slim `raw_vow_delisted` archive table, and a cursored Query C in the nightly sync. Bundled cleanup deletes the orphaned legacy `listings` Typesense collection (95k docs) to pay the RAM bill.

**Tech Stack:** Next.js (app router), Typesense, Supabase/Postgres, tsx workers, vitest (node-env, pure logic only — no jsdom).

**Spec:** `docs/superpowers/specs/2026-06-09-delisted-mode-design.md`

**Branch:** `feat/delisted-mode` (already cut from main with the spec committed).

**Repo conventions that bind every task:**
- Windows env: invoke npm/npx as `npm.cmd` / `npx.cmd`.
- Typesense strict schema: every declared field present with `?? 0` / `|| ''` fallbacks.
- Never spread payloads into Supabase upserts — field-by-field.
- Commit message trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Production writes (migration apply, Typesense schema alter, backfill `--apply`, collection delete) are **owner-gated** — pause and ask before running them.

---

## Phase 1 — Data

### Task 1: De-listed deal-type derivation (pure helper)

**Files:**
- Modify: `src/lib/sold/dealType.ts`
- Test: `src/lib/sold/dealType.delisted.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/sold/dealType.delisted.test.ts
import { describe, it, expect } from "vitest";
import {
  deriveDelistedDealType,
  isDelistedDealType,
  type DelistedDealType,
} from "./dealType";

describe("deriveDelistedDealType", () => {
  it("maps MlsStatus to the specific de-list reason", () => {
    expect(deriveDelistedDealType("Terminated")).toBe("terminated");
    expect(deriveDelistedDealType("Expired")).toBe("expired");
    expect(deriveDelistedDealType("Suspended")).toBe("suspended");
  });

  it("is case/whitespace tolerant", () => {
    expect(deriveDelistedDealType("  TERMINATED ")).toBe("terminated");
  });

  it("returns null for sold/leased/active/unknown statuses", () => {
    expect(deriveDelistedDealType("Sold")).toBeNull();
    expect(deriveDelistedDealType("Leased")).toBeNull();
    expect(deriveDelistedDealType("New")).toBeNull();
    expect(deriveDelistedDealType(null)).toBeNull();
    expect(deriveDelistedDealType(undefined)).toBeNull();
  });
});

describe("isDelistedDealType", () => {
  it("recognizes exactly the three de-list reasons", () => {
    const yes: DelistedDealType[] = ["terminated", "expired", "suspended"];
    for (const v of yes) expect(isDelistedDealType(v)).toBe(true);
    expect(isDelistedDealType("sold")).toBe(false);
    expect(isDelistedDealType("leased")).toBe(false);
    expect(isDelistedDealType(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/lib/sold/dealType.delisted.test.ts`
Expected: FAIL — `deriveDelistedDealType` is not exported.

- [ ] **Step 3: Implement — append to `src/lib/sold/dealType.ts`**

```typescript
/** De-list reasons — a listing that left the market WITHOUT a transaction. */
export type DelistedDealType = "terminated" | "expired" | "suspended";
/** Every comp kind the sold_listings collection can carry. */
export type CompDealType = DealType | DelistedDealType;

export const DELISTED_DEAL_TYPES: DelistedDealType[] = [
  "terminated",
  "expired",
  "suspended",
];

/**
 * Specific de-list reason from MlsStatus, or null when the status is not a
 * de-list signal (sold/leased/active/unknown). Substring match because boards
 * send variants ("Terminated", "Suspended (Temporarily)").
 */
export function deriveDelistedDealType(
  mlsStatus: string | null | undefined
): DelistedDealType | null {
  const mls = (mlsStatus ?? "").trim().toLowerCase();
  if (mls.includes("terminat")) return "terminated";
  if (mls.includes("expir")) return "expired";
  if (mls.includes("suspend")) return "suspended";
  return null;
}

export function isDelistedDealType(v: unknown): v is DelistedDealType {
  return v === "terminated" || v === "expired" || v === "suspended";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx.cmd vitest run src/lib/sold/dealType.delisted.test.ts`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/dealType.ts src/lib/sold/dealType.delisted.test.ts
git commit -m "feat(delisted): de-list reason derivation (terminated/expired/suspended)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 034 — `raw_vow_delisted` slim archive table

**Files:**
- Create: `supabase/migrations/034_raw_vow_delisted.sql`
- Create: `scripts/admin/applyMigration034.ts`

No TDD (DDL). Verification = apply-script output.

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/034_raw_vow_delisted.sql
--
-- Slim 12-month archive of de-listed (Terminated/Expired/Suspended) VOW
-- listings. Deliberately NO raw_payload JSONB — the full payload remains
-- fetchable from the feed forever; this table stores only what the De-listed
-- surface and future failure-rate analytics need (design spec 2026-06-09).
-- RLS is enabled with NO policies: service-role-only (VOW data must never be
-- anon-readable).

CREATE TABLE IF NOT EXISTS raw_vow_delisted (
  listing_key            TEXT PRIMARY KEY,
  mls_status             TEXT,
  standard_status        TEXT,
  transaction_type       TEXT,
  -- The de-list event date this row is windowed/sorted on (see delistedMapper
  -- precedence: status-specific date, else ModificationTimestamp date).
  delisted_date          DATE NOT NULL,
  expiration_date        DATE,
  listing_contract_date  DATE,
  list_price             NUMERIC,
  original_list_price    NUMERIC,
  days_on_market         INTEGER,
  unparsed_address       TEXT,
  city                   TEXT,
  city_region            TEXT,
  -- Parsed from the FULL address (parsePostal.ts), not the FSA-only field.
  postal_code            TEXT,
  property_sub_type      TEXT,
  bedrooms_above_grade   INTEGER,
  bathrooms_total_integer NUMERIC,
  parking_total          INTEGER,
  -- Mandatory brokerage display (CLAUDE.md section 4) on every surfaced card.
  list_office_name       TEXT,
  lat                    DOUBLE PRECISION,
  lng                    DOUBLE PRECISION,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_vow_delisted_date
  ON raw_vow_delisted (delisted_date DESC);
CREATE INDEX IF NOT EXISTS idx_raw_vow_delisted_city_date
  ON raw_vow_delisted (city, delisted_date DESC);

ALTER TABLE raw_vow_delisted ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Write the apply script**

```typescript
// scripts/admin/applyMigration034.ts
/**
 * Apply migration 034 (raw_vow_delisted slim archive) via the Session pooler.
 *
 * Requires DATABASE_URL = Supabase Session pooler string (CLAUDE.md section 12).
 * The direct host (db.<ref>.supabase.co) is IPv6-only from this env. Light DDL —
 * also safe to paste into the Supabase SQL editor if preferred.
 *
 * Run: npx tsx scripts/admin/applyMigration034.ts
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '.env'] });

const DATABASE_URL = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
if (!DATABASE_URL) {
  console.error('❌ No connection string found (set DATABASE_URL or DIRECT_DB_URL)');
  process.exit(1);
}

async function applyMigration() {
  console.log('\n🔧 Migration 034: raw_vow_delisted (slim de-listed archive)');
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 15000,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('   ✅ Connected to PostgreSQL');
    const sql = fs.readFileSync(
      path.join(__dirname, '../../supabase/migrations/034_raw_vow_delisted.sql'),
      'utf-8'
    );
    await client.query(sql);

    const { rows } = await client.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'raw_vow_delisted'`
    );
    if (rows.length === 0) throw new Error('table missing post-apply');
    if (!rows[0].relrowsecurity) throw new Error('RLS not enabled on raw_vow_delisted');
    console.log('✅ Migration 034 complete (table exists, RLS enabled).');
  } finally {
    await client.end();
  }
}

applyMigration().then(() => process.exit(0)).catch((e) => {
  console.error('❌ Migration failed:', e?.message || e);
  process.exit(1);
});
```

- [ ] **Step 3: Commit (apply happens in Task 7 — owner-gated)**

```bash
git add supabase/migrations/034_raw_vow_delisted.sql scripts/admin/applyMigration034.ts
git commit -m "feat(delisted): migration 034 — raw_vow_delisted slim archive table

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Typesense schema — three new optional fields + widened types

**Files:**
- Modify: `src/lib/typesense/soldListingsSchema.ts`
- Create: `scripts/admin/addDelistedFields.ts`

No test (schema constants); the compiler + Task 4 tests exercise the interface.

- [ ] **Step 1: Add fields to the schema constant** — in `soldListingsSchema.ts`, append to the `fields` array after the `DealType` entry:

```typescript
    // ─── De-listed comps (design spec 2026-06-09) ─────────────────────────────
    // DealType additionally carries 'terminated' | 'expired' | 'suspended' for
    // de-listed rows; PurchaseContractDate then holds the DE-LIST event date
    // (the field is "the event date the row is windowed/sorted on").
    // How long the failed campaign survived — the card's "survived N days".
    { name: 'DaysOnMarket', type: 'int32' as const, facet: false, optional: true, sort: true },
    // 'For Sale' | 'For Lease' — keeps terminated lease listings out of the
    // sale-lead view. Optional: legacy sold docs simply omit it.
    { name: 'TransactionType', type: 'string' as const, facet: true, optional: true },
    // Original ask of the failed campaign — powers the "cut N% during campaign"
    // delta (ListPrice carries the FINAL ask for de-listed rows).
    { name: 'OriginalListPrice', type: 'int32' as const, facet: false, optional: true, sort: true },
```

- [ ] **Step 2: Widen the document interface** — in the same file, change the `DealType` line of `SoldListingDocument` and add the new fields:

```typescript
  /** 'sold' | 'leased' | de-list reason — derived at index time. */
  DealType?: 'sold' | 'leased' | 'terminated' | 'expired' | 'suspended';
  /** Days the campaign survived before the de-list event (de-listed rows). */
  DaysOnMarket?: number;
  /** 'For Sale' | 'For Lease' — present on de-listed rows. */
  TransactionType?: string;
  /** Original ask of a failed campaign (de-listed rows). */
  OriginalListPrice?: number;
```

Also update the `PurchaseContractDate` comment in the interface to: `/** Event date (sold-firm date, or de-list date for de-listed rows) as epoch ms. */`

- [ ] **Step 3: Write the live schema-alter script**

```typescript
// scripts/admin/addDelistedFields.ts
/**
 * Add the de-listed fields (DaysOnMarket, TransactionType, OriginalListPrice)
 * to the LIVE sold_listings collection. Idempotent: skips fields that already
 * exist. Dry-run prints the live field list; --apply performs the alter.
 *
 * Run:  npx tsx scripts/admin/addDelistedFields.ts            (dry-run)
 *       npx tsx scripts/admin/addDelistedFields.ts --apply
 */
import 'dotenv/config';
import Typesense from 'typesense';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';

const NEW_FIELDS = [
  { name: 'DaysOnMarket', type: 'int32' as const, facet: false, optional: true, sort: true },
  { name: 'TransactionType', type: 'string' as const, facet: true, optional: true },
  { name: 'OriginalListPrice', type: 'int32' as const, facet: false, optional: true, sort: true },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Typesense.Client({
    nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });
  const live = await client.collections(SOLD_LISTINGS_COLLECTION).retrieve();
  const existing = new Set(live.fields!.map((f: any) => f.name));
  console.log(`Live fields: ${[...existing].join(', ')}`);
  const toAdd = NEW_FIELDS.filter((f) => !existing.has(f.name));
  if (toAdd.length === 0) return console.log('✅ Nothing to add.');
  console.log(`Will add: ${toAdd.map((f) => f.name).join(', ')}`);
  if (!apply) return console.log('Dry-run. Re-run with --apply.');
  await client.collections(SOLD_LISTINGS_COLLECTION).update({ fields: toAdd as any });
  console.log('✅ Fields added.');
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```

- [ ] **Step 4: Typecheck, then commit (live alter happens in Task 7)**

Run: `npx.cmd tsc --noEmit` — Expected: exit 0.

```bash
git add src/lib/typesense/soldListingsSchema.ts scripts/admin/addDelistedFields.ts
git commit -m "feat(delisted): sold_listings schema — DaysOnMarket, TransactionType, OriginalListPrice

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `delistedMapper.ts` — pure extract + document mapping

**Files:**
- Create: `scripts/worker/delistedMapper.ts` (PURE — no env/supabase/typesense imports, so vitest loads it safely)
- Test: `scripts/worker/delistedMapper.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/worker/delistedMapper.test.ts
import { describe, it, expect } from 'vitest';
import {
  delistedEventDate,
  extractDelistedRecord,
  toDelistedDocument,
  type DelistedRecord,
} from './delistedMapper';

const NOW = new Date('2026-06-09T12:00:00Z').getTime();

describe('delistedEventDate', () => {
  it('prefers the status-specific date field', () => {
    expect(
      delistedEventDate(
        { MlsStatus: 'Terminated', TerminatedDate: '2026-05-22', ModificationTimestamp: '2026-05-23T10:00:00Z' },
        NOW
      )
    ).toBe('2026-05-22');
    expect(
      delistedEventDate(
        { MlsStatus: 'Expired', ExpirationDate: '2026-04-30', ModificationTimestamp: '2026-05-01T05:15:22Z' },
        NOW
      )
    ).toBe('2026-04-30');
    expect(
      delistedEventDate(
        { MlsStatus: 'Suspended', SuspendedDate: '2026-04-07', ModificationTimestamp: '2026-04-07T22:52:33Z' },
        NOW
      )
    ).toBe('2026-04-07');
  });

  it('falls back to the ModificationTimestamp date when the specific field is missing', () => {
    expect(
      delistedEventDate({ MlsStatus: 'Terminated', ModificationTimestamp: '2026-06-03T17:21:00Z' }, NOW)
    ).toBe('2026-06-03');
  });

  it('rejects a FUTURE specific date (e.g. Suspended rows carry a future ExpirationDate) in favour of the mod date', () => {
    expect(
      delistedEventDate(
        { MlsStatus: 'Suspended', SuspendedDate: '2026-12-31', ModificationTimestamp: '2026-04-21T18:58:39Z' },
        NOW
      )
    ).toBe('2026-04-21');
  });

  it('returns null when nothing parses', () => {
    expect(delistedEventDate({ MlsStatus: 'Terminated' }, NOW)).toBeNull();
  });
});

const RAW_TERMINATED = {
  ListingKey: 'X12886256',
  MlsStatus: 'Terminated',
  StandardStatus: 'Active Under Contract',
  TransactionType: 'For Sale',
  TerminatedDate: '2026-05-22',
  ExpirationDate: '2026-08-31',
  ModificationTimestamp: '2026-05-22T20:29:14Z',
  ListingContractDate: '2026-03-01',
  ListPrice: 899000,
  OriginalListPrice: 949000,
  DaysOnMarket: 47,
  UnparsedAddress: '19 Hossie Terrace, Stratford, ON N5A 8B6',
  City: 'Stratford',
  CityRegion: 'Downtown',
  PostalCode: 'N5A',
  PropertySubType: 'Detached',
  BedroomsAboveGrade: 3,
  BathroomsTotalInteger: 2.5,
  ParkingTotal: 4,
  ListOfficeName: 'Acme Realty',
};

describe('extractDelistedRecord', () => {
  it('maps a terminated raw listing to a slim record', () => {
    const r = extractDelistedRecord(RAW_TERMINATED, NOW)!;
    expect(r).not.toBeNull();
    expect(r.listing_key).toBe('X12886256');
    expect(r.mls_status).toBe('Terminated');
    expect(r.deal_type).toBe('terminated');
    expect(r.delisted_date).toBe('2026-05-22');
    expect(r.list_price).toBe(899000);
    expect(r.original_list_price).toBe(949000);
    expect(r.days_on_market).toBe(47);
    expect(r.transaction_type).toBe('For Sale');
    expect(r.list_office_name).toBe('Acme Realty');
    // Full postal parsed from the address, not the FSA-only PostalCode field.
    expect(r.postal_code).toBe('N5A 8B6');
  });

  it('returns null for non-delisted statuses and for missing event dates', () => {
    expect(extractDelistedRecord({ ...RAW_TERMINATED, MlsStatus: 'Sold' }, NOW)).toBeNull();
    expect(
      extractDelistedRecord(
        { ...RAW_TERMINATED, TerminatedDate: undefined, ModificationTimestamp: undefined },
        NOW
      )
    ).toBeNull();
  });
});

describe('toDelistedDocument', () => {
  const record: DelistedRecord = extractDelistedRecord(RAW_TERMINATED, NOW)!;

  it('builds a strict-schema sold_listings doc with DealType = reason and ClosePrice 0', () => {
    const doc = toDelistedDocument(record)!;
    expect(doc.id).toBe('X12886256');
    expect(doc.DealType).toBe('terminated');
    expect(doc.ClosePrice).toBe(0);
    expect(doc.ListPrice).toBe(899000);
    expect(doc.OriginalListPrice).toBe(949000);
    expect(doc.DaysOnMarket).toBe(47);
    expect(doc.TransactionType).toBe('For Sale');
    expect(doc.PurchaseContractDate).toBe(new Date('2026-05-22').getTime());
    // Strict-schema required fields all present with fallbacks:
    expect(doc.BuildingAreaTotal).toBe(0);
    expect(doc.LotWidth).toBe(0);
    expect(doc.BasementTier).toBe(0);
  });

  it('returns null without a listing key', () => {
    expect(toDelistedDocument({ ...record, listing_key: '' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx.cmd vitest run scripts/worker/delistedMapper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `scripts/worker/delistedMapper.ts`**

```typescript
/**
 * Pure mapping layer for de-listed (Terminated/Expired/Suspended) VOW records —
 * kept free of env/IO imports so vitest loads it directly. IO (cursor, upserts,
 * feed fetch, CLI) lives in delistedIndexer.ts.
 *
 * Design spec: docs/superpowers/specs/2026-06-09-delisted-mode-design.md
 */
import {
  deriveDelistedDealType,
  type DelistedDealType,
} from '../../src/lib/sold/dealType';
import type { SoldListingDocument } from '../../src/lib/typesense/soldListingsSchema';
import { parsePostalFromAddress } from './parsePostal';

function toInt(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function toFloat(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** YYYY-MM-DD from a date-ish string; null when unparseable. */
function isoDateOrNull(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null;
  const ms = new Date(v).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Raw VOW fields the event-date precedence reads. */
export interface DelistedDateFields {
  MlsStatus?: string | null;
  TerminatedDate?: string | null;
  SuspendedDate?: string | null;
  ExpirationDate?: string | null;
  ModificationTimestamp?: string | null;
}

/**
 * The de-list EVENT date (YYYY-MM-DD): the status-specific date field when
 * present and not in the future (Suspended rows often carry a future
 * ExpirationDate), else the ModificationTimestamp date, else null (caller
 * skips the record — a row without an event date can never be windowed).
 */
export function delistedEventDate(
  raw: DelistedDateFields,
  nowMs: number
): string | null {
  const reason = deriveDelistedDealType(raw.MlsStatus);
  const specific =
    reason === 'terminated'
      ? raw.TerminatedDate
      : reason === 'suspended'
        ? raw.SuspendedDate
        : reason === 'expired'
          ? raw.ExpirationDate
          : null;
  // Allow 1 day of clock skew before calling a date "future".
  const maxMs = nowMs + 86_400_000;
  for (const candidate of [specific, raw.ModificationTimestamp]) {
    const d = isoDateOrNull(candidate ?? null);
    if (d && new Date(d).getTime() <= maxMs) return d;
  }
  return null;
}

/** Slim raw_vow_delisted row + the derived deal_type (not a table column). */
export interface DelistedRecord {
  listing_key: string;
  mls_status: string | null;
  standard_status: string | null;
  transaction_type: string | null;
  delisted_date: string; // YYYY-MM-DD, NOT NULL by construction
  expiration_date: string | null;
  listing_contract_date: string | null;
  list_price: number | null;
  original_list_price: number | null;
  days_on_market: number | null;
  unparsed_address: string | null;
  city: string | null;
  city_region: string | null;
  postal_code: string | null;
  property_sub_type: string | null;
  bedrooms_above_grade: number | null;
  bathrooms_total_integer: number | null;
  parking_total: number | null;
  list_office_name: string | null;
  /** Derived reason — used for the Typesense doc; not a table column. */
  deal_type: DelistedDealType;
}

/**
 * Raw VOW listing → slim archive record. Null when the status is not a
 * de-list signal or no event date can be established.
 */
export function extractDelistedRecord(
  raw: any,
  nowMs: number
): DelistedRecord | null {
  const dealType = deriveDelistedDealType(raw?.MlsStatus);
  if (!dealType) return null;
  const listingKey = raw.ListingKey || raw.ListingId || '';
  if (!listingKey) return null;
  const eventDate = delistedEventDate(raw, nowMs);
  if (!eventDate) return null;

  const address =
    raw.UnparsedAddress ||
    [raw.StreetNumber, raw.StreetName, raw.UnitNumber].filter(Boolean).join(' ') ||
    null;

  return {
    listing_key: listingKey,
    mls_status: raw.MlsStatus || null,
    standard_status: raw.StandardStatus || null,
    transaction_type: raw.TransactionType || null,
    delisted_date: eventDate,
    expiration_date: isoDateOrNull(raw.ExpirationDate),
    listing_contract_date: isoDateOrNull(raw.ListingContractDate),
    list_price: numOrNull(raw.ListPrice),
    original_list_price: numOrNull(raw.OriginalListPrice),
    days_on_market: numOrNull(raw.DaysOnMarket),
    unparsed_address: address,
    city: raw.City || null,
    city_region: raw.CityRegion || null,
    // VOW postal_code is frequently FSA-only; the full postal is in the address
    // (sold-blob lesson — parsePostal.ts). Prefer it; fall back to the column.
    postal_code: parsePostalFromAddress(address) ?? (raw.PostalCode || null),
    property_sub_type: raw.PropertySubType || raw.PropertyType || null,
    bedrooms_above_grade: numOrNull(raw.BedroomsAboveGrade),
    bathrooms_total_integer: numOrNull(raw.BathroomsTotalInteger),
    parking_total: numOrNull(raw.ParkingTotal),
    list_office_name: raw.ListOfficeName || null,
    deal_type: dealType,
  };
}

/**
 * Slim record → strict-schema sold_listings doc. DealType carries the de-list
 * reason; PurchaseContractDate (the window/sort slot) carries the DE-LIST date;
 * ClosePrice is 0 (no transaction — the route's price floor is sold/leased-only).
 * Geocoding (location/NearbySchools) is attached by the indexer, not here,
 * to keep this module IO-free.
 */
export function toDelistedDocument(r: DelistedRecord): SoldListingDocument | null {
  if (!r.listing_key) return null;
  const ms = new Date(r.delisted_date).getTime();
  if (!Number.isFinite(ms)) return null;
  return {
    id: r.listing_key,
    ClosePrice: 0,
    ListPrice: toInt(r.list_price),
    City: r.city ?? '',
    CityRegion: r.city_region ?? '',
    UnparsedAddress: r.unparsed_address ?? '',
    PropertySubType: r.property_sub_type ?? '',
    BedroomsTotal: toInt(r.bedrooms_above_grade),
    BathroomsTotalInteger: toFloat(r.bathrooms_total_integer),
    BuildingAreaTotal: 0,
    ParkingTotal: toInt(r.parking_total),
    LotWidth: 0,
    BasementTier: 0,
    ListOfficeName: r.list_office_name ?? '',
    PurchaseContractDate: ms,
    DealType: r.deal_type,
    DaysOnMarket: toInt(r.days_on_market),
    TransactionType: r.transaction_type ?? '',
    OriginalListPrice: toInt(r.original_list_price),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx.cmd vitest run scripts/worker/delistedMapper.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/worker/delistedMapper.ts scripts/worker/delistedMapper.test.ts
git commit -m "feat(delisted): pure mapper — event-date precedence, slim record, strict-schema doc

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `delistedIndexer.ts` — cursor, feed fetch, upsert, index, prune, backfill CLI

**Files:**
- Create: `scripts/worker/delistedIndexer.ts`

IO module — the pure logic it composes was tested in Task 4. Verified by typecheck here and live in Task 7.

- [ ] **Step 1: Implement `scripts/worker/delistedIndexer.ts`**

```typescript
/**
 * De-listed (Terminated/Expired/Suspended) VOW listings → Supabase archive +
 * Typesense window. Query C of the sync (design spec 2026-06-09).
 *
 *  - Cursored on ModificationTimestamp (FILTERABLE on these statuses, unlike
 *    Query B's date fields) with $orderby asc — the cursor advances per page,
 *    so there is no deep-$skip and any run is resumable.
 *  - Own sync_state row (id='delisted') so a Query C failure NEVER moves the
 *    master cursor, and vice versa. Failed runs keep the previous cursor.
 *  - Routes: every record → raw_vow_delisted upsert (12-month slim archive);
 *    records with a de-list date inside DELISTED_WINDOW_DAYS → sold_listings
 *    doc upsert. No media fetches (v1 cards are photo-less).
 *  - Stale-active cleanup: every batch's keys are deleted from `properties`
 *    (a terminated listing's For Sale doc is frozen stale — same bug class as
 *    the sold purge, PR #19).
 *
 * CLI:
 *   npx tsx scripts/worker/delistedIndexer.ts backfill   (seed cursor 12mo back, run to caught-up)
 *   npx tsx scripts/worker/delistedIndexer.ts delta      (one capped run, as the nightly does)
 *   npx tsx scripts/worker/delistedIndexer.ts prune      (prune the 90d window only)
 */
import 'dotenv/config';
import { getServiceRoleClient } from '../../src/lib/supabase/client';
import { getSoldAdminClient, importSoldBatch } from './soldIndexer';
import { SOLD_LISTINGS_COLLECTION } from '../../src/lib/typesense/soldListingsSchema';
import type { SoldListingDocument } from '../../src/lib/typesense/soldListingsSchema';
import { extractDelistedRecord, toDelistedDocument, type DelistedRecord } from './delistedMapper';
import { buildIdDeleteFilters } from './staleSearchDocs';
import { resolveLocation } from './resolveLocation';
import { assignSchools } from '../../src/lib/schools/nearestSchools';

export const DELISTED_WINDOW_DAYS = 90;
export const DELISTED_ARCHIVE_MONTHS = 12;
const API_BASE_URL = 'https://query.ampre.ca/odata';
const PAGE_DELAY_MS = 1000;
/** Nightly page cap: ~900 new records/day needs ~9 pages; 50 gives catch-up slack. */
const DELTA_MAX_PAGES = 50;
const CURSOR_ROW_ID = 'delisted';

const STATUS_FILTER =
  "(MlsStatus eq 'Terminated' or MlsStatus eq 'Expired' or MlsStatus eq 'Suspended')";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── sync_state cursor (own row — never the 'master' row) ─────────────────────
export async function readDelistedCursor(defaultIso: string): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from('sync_state')
    .select('last_sync_timestamp')
    .eq('id', CURSOR_ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`read delisted cursor: ${error.message}`);
  if (!data) {
    const { error: insErr } = await supabase
      .from('sync_state')
      .insert({ id: CURSOR_ROW_ID, last_sync_timestamp: defaultIso, status: 'idle' });
    if (insErr) throw new Error(`init delisted cursor: ${insErr.message}`);
    return defaultIso;
  }
  return data.last_sync_timestamp;
}

export async function updateDelistedCursor(timestamp: string, status: 'completed' | 'failed'): Promise<void> {
  const supabase = getServiceRoleClient();
  const { error } = await supabase
    .from('sync_state')
    .update({ last_sync_timestamp: timestamp, status, updated_at: new Date().toISOString() })
    .eq('id', CURSOR_ROW_ID);
  if (error) throw new Error(`update delisted cursor: ${error.message}`);
}

// ── feed fetch (cursor paging, no $skip) ─────────────────────────────────────
async function fetchDelistedPage(cursorIso: string): Promise<any[]> {
  const token = process.env.PROPTX_VOW_TOKEN;
  if (!token) throw new Error('PROPTX_VOW_TOKEN environment variable is not set');
  const filter = `${STATUS_FILTER} and ModificationTimestamp gt ${cursorIso}`;
  const url =
    `${API_BASE_URL}/Property?$filter=${encodeURIComponent(filter)}` +
    `&$orderby=${encodeURIComponent('ModificationTimestamp asc')}&$top=100`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const data: any = await res.json();
      return data.value ?? [];
    }
    if (attempt >= 3) throw new Error(`Query C fetch failed: HTTP ${res.status}`);
    await sleep(attempt * 2000);
  }
}

// ── Supabase upsert (field-by-field per CLAUDE.md section 6, batched) ────────
export async function upsertDelistedRecords(records: DelistedRecord[]): Promise<void> {
  if (records.length === 0) return;
  const supabase = getServiceRoleClient();
  const rows = records.map((r) => ({
    listing_key: r.listing_key,
    mls_status: r.mls_status,
    standard_status: r.standard_status,
    transaction_type: r.transaction_type,
    delisted_date: r.delisted_date,
    expiration_date: r.expiration_date,
    listing_contract_date: r.listing_contract_date,
    list_price: r.list_price,
    original_list_price: r.original_list_price,
    days_on_market: r.days_on_market,
    unparsed_address: r.unparsed_address,
    city: r.city,
    city_region: r.city_region,
    postal_code: r.postal_code,
    property_sub_type: r.property_sub_type,
    bedrooms_above_grade: r.bedrooms_above_grade,
    bathrooms_total_integer: r.bathrooms_total_integer,
    parking_total: r.parking_total,
    list_office_name: r.list_office_name,
    lat: null as number | null,
    lng: null as number | null,
    updated_at: new Date().toISOString(),
  }));
  // Geocode (postal Tier-1 only, same policy as soldIndexer — drop fallbacks).
  for (let i = 0; i < rows.length; i++) {
    const geo = resolveLocation(records[i].postal_code, null, null, records[i].city);
    if (!geo.needsGeocoding) {
      rows[i].lat = geo.location[0];
      rows[i].lng = geo.location[1];
    }
  }
  const { error } = await supabase
    .from('raw_vow_delisted')
    .upsert(rows, { onConflict: 'listing_key' });
  if (error) throw new Error(`raw_vow_delisted upsert: ${error.message}`);
}

/** Doc + geo for the bounded window; null when outside the window. */
function toWindowedDoc(r: DelistedRecord, windowCutoffMs: number): SoldListingDocument | null {
  const eventMs = new Date(r.delisted_date).getTime();
  if (!Number.isFinite(eventMs) || eventMs < windowCutoffMs) return null;
  const doc = toDelistedDocument(r);
  if (!doc) return null;
  const geo = resolveLocation(r.postal_code, null, null, r.city);
  if (!geo.needsGeocoding) {
    doc.location = geo.location;
    const schools = assignSchools(geo.location);
    if (schools.NearbySchools.length > 0) doc.NearbySchools = schools.NearbySchools;
  }
  return doc;
}

/** Prune de-listed docs beyond their 90-day window (sold/leased keep 180d via pruneOldSold). */
export async function pruneOldDelisted(days = DELISTED_WINDOW_DAYS): Promise<void> {
  const cutoff = Date.now() - days * 86_400_000;
  try {
    const res: any = await getSoldAdminClient()
      .collections(SOLD_LISTINGS_COLLECTION)
      .documents()
      .delete({
        filter_by: `DealType:=[terminated,expired,suspended] && PurchaseContractDate:<${cutoff}`,
      });
    console.log(`   🧹 Pruned ${res?.num_deleted ?? 0} de-listed docs older than ${days}d`);
  } catch (err: any) {
    console.warn(`   ⚠️  De-listed prune failed (non-fatal): ${err.message}`);
  }
}

export interface DelistedSyncResult {
  records: number;
  pages: number;
  indexed: number;
  caughtUp: boolean;
}

/**
 * Catch up from the cursor, up to maxPages. Used by BOTH the nightly sync
 * (capped) and the backfill CLI (loops until caughtUp). The cursor only
 * advances after each page fully persists — a crash re-runs the page (upserts
 * make that safe).
 */
export async function runDelistedSync(maxPages = DELTA_MAX_PAGES): Promise<DelistedSyncResult> {
  const defaultIso = new Date(Date.now() - 48 * 3600_000).toISOString();
  let cursor = await readDelistedCursor(defaultIso);
  console.log(`   📖 De-listed cursor: ${cursor}`);
  const windowCutoff = Date.now() - DELISTED_WINDOW_DAYS * 86_400_000;
  const result: DelistedSyncResult = { records: 0, pages: 0, indexed: 0, caughtUp: false };

  try {
    while (result.pages < maxPages) {
      const listings = await fetchDelistedPage(cursor);
      if (listings.length === 0) {
        result.caughtUp = true;
        break;
      }
      const nowMs = Date.now();
      const records = listings
        .map((l) => extractDelistedRecord(l, nowMs))
        .filter((r): r is DelistedRecord => r !== null);

      await upsertDelistedRecords(records);

      const docs = records
        .map((r) => toWindowedDoc(r, windowCutoff))
        .filter((d): d is SoldListingDocument => d !== null);
      if (docs.length > 0) {
        const { success, failed } = await importSoldBatch(getSoldAdminClient(), docs);
        result.indexed += success;
        if (failed > 0) console.warn(`   ⚠️  ${failed} de-listed docs failed to index`);
      }

      // These listings left Active — their For Sale docs are frozen stale.
      const keys = records.map((r) => r.listing_key);
      if (keys.length > 0) {
        try {
          const ts = getSoldAdminClient();
          for (const filter of buildIdDeleteFilters(keys)) {
            await ts.collections('properties').documents().delete({ filter_by: filter } as any);
          }
        } catch (err: any) {
          console.warn(`   ⚠️  Stale-active delete failed (non-fatal): ${err.message}`);
        }
      }

      // Advance the cursor to the last record's ModificationTimestamp.
      const lastMod = listings[listings.length - 1]?.ModificationTimestamp;
      if (!lastMod || lastMod === cursor) {
        // Defensive: a page that can't advance the cursor would loop forever.
        result.caughtUp = listings.length < 100;
        break;
      }
      cursor = lastMod;
      result.records += listings.length;
      result.pages++;
      console.log(
        `   📄 De-listed page ${result.pages}: +${listings.length} (cursor → ${cursor})`
      );
      if (listings.length < 100) {
        result.caughtUp = true;
        break;
      }
      await sleep(PAGE_DELAY_MS);
    }
    await updateDelistedCursor(cursor, 'completed');
  } catch (err: any) {
    console.error(`   ❌ De-listed sync failed: ${err?.message || err}`);
    // Cursor intentionally NOT advanced past the last fully-persisted page.
    await updateDelistedCursor(cursor, 'failed').catch(() => {});
    throw err;
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /delistedIndexer\.(ts|js)$/.test(process.argv[1]);

if (invokedDirectly) {
  (async () => {
    const mode = process.argv[2] || 'delta';
    if (mode === 'backfill') {
      // Seed the cursor 12 months back ONLY when it's still at its default
      // (never clobber an in-progress catch-up — backfill is resumable).
      const archiveStart = new Date(
        Date.now() - DELISTED_ARCHIVE_MONTHS * 30.44 * 86_400_000
      ).toISOString();
      const current = await readDelistedCursor(archiveStart);
      console.log(`🌱 De-listed backfill from cursor ${current}`);
      let total = 0;
      for (;;) {
        const r = await runDelistedSync(200);
        total += r.records;
        console.log(`   …${total} records so far (caughtUp=${r.caughtUp})`);
        if (r.caughtUp) break;
      }
      await pruneOldDelisted();
      console.log(`✅ Backfill complete: ${total} records archived.`);
      process.exit(0);
    }
    if (mode === 'delta') {
      const r = await runDelistedSync();
      await pruneOldDelisted();
      console.log(`✅ Delta complete: ${r.records} records, ${r.indexed} indexed, caughtUp=${r.caughtUp}`);
      process.exit(0);
    }
    if (mode === 'prune') {
      await pruneOldDelisted();
      process.exit(0);
    }
    console.error(`Unknown mode "${mode}". Use: backfill | delta | prune`);
    process.exit(1);
  })().catch((err) => {
    console.error('❌ delistedIndexer failed:', err?.message || err);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Typecheck + full test suite**

Run: `npx.cmd tsc --noEmit` — Expected: exit 0.
Run: `npm.cmd test` — Expected: all green (no regressions).

- [ ] **Step 3: Commit**

```bash
git add scripts/worker/delistedIndexer.ts
git commit -m "feat(delisted): indexer — cursored Query C engine, archive upsert, 90d window, prune, backfill CLI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire Query C into the nightly sync

**Files:**
- Modify: `scripts/worker/ingester.ts` (after the Query B2 block, ~line 1209, before "Finalize")

- [ ] **Step 1: Add the import** near the other worker imports at the top of `ingester.ts`:

```typescript
import { runDelistedSync, pruneOldDelisted } from './delistedIndexer';
```

- [ ] **Step 2: Add the Query C block** in `runDeltaSync()`, directly after the `Query B2 Complete` log line and BEFORE the `─── Finalize ───` comment:

```typescript
    // ─── Query C: De-listed Sync (Terminated/Expired/Suspended) ─────────────
    // Own cursor (sync_state id='delisted') and own try/catch: a Query C
    // failure must never fail the A/B sync or move the master cursor.
    console.log('\n════════════════════════════════════════════════');
    console.log('  QUERY C: De-listed Listings Sync');
    console.log('════════════════════════════════════════════════\n');
    try {
      const delisted = await runDelistedSync();
      await pruneOldDelisted();
      console.log(
        `\n✅ Query C Complete: ${delisted.records} de-listed records, ${delisted.indexed} indexed, caughtUp=${delisted.caughtUp}`
      );
    } catch (err: any) {
      console.warn(`\n⚠️  Query C failed (non-fatal for the A/B sync): ${err?.message || err}`);
      result.errors.push(`delisted sync: ${err?.message || err}`);
    }
```

- [ ] **Step 3: Typecheck + tests, then commit**

Run: `npx.cmd tsc --noEmit` then `npm.cmd test` — Expected: green.

```bash
git add scripts/worker/ingester.ts
git commit -m "feat(delisted): Query C in the nightly sync — isolated cursor, non-fatal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Apply migration + schema alter + run backfill (OWNER-GATED)

All three steps are production writes — **stop and get owner approval before each `--apply`/run**.

- [ ] **Step 1: Apply migration 034**

Run: `npx.cmd tsx scripts/admin/applyMigration034.ts`
Expected: `✅ Migration 034 complete (table exists, RLS enabled).`
(If `DATABASE_URL` is missing, set it to the Session pooler string per CLAUDE.md §12.)

- [ ] **Step 2: Alter the live sold_listings schema**

Run dry-run first: `npx.cmd tsx scripts/admin/addDelistedFields.ts`
Then: `npx.cmd tsx scripts/admin/addDelistedFields.ts --apply`
Expected: `✅ Fields added.`

- [ ] **Step 3: Run the 12-month backfill** (~3.3k feed pages — hours; run locally, resumable, safe to interrupt and re-run)

Run: `npx.cmd tsx scripts/worker/delistedIndexer.ts backfill`
Expected: progress pages, final `✅ Backfill complete: ~300k+ records archived.`

- [ ] **Step 4: Spot-verify**

Run a quick probe (inline tsx) confirming: `raw_vow_delisted` row count > 250k; `sold_listings` now contains `DealType:=terminated` docs only with `PurchaseContractDate` within 90d; total sold_listings docs ≈ 44k + ~80k.

---

## Phase 2 — Surface

### Task 8: Sold route — extract a pure filter module + `dealType=delisted`

**Files:**
- Create: `src/app/api/market/activity/sold/soldFilter.ts` (pure — moved from route.ts)
- Modify: `src/app/api/market/activity/sold/route.ts`
- Modify: `src/app/api/market/activity/sold/soldMapper.ts`
- Test: `src/app/api/market/activity/sold/soldFilter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/api/market/activity/sold/soldFilter.test.ts
import { describe, it, expect } from "vitest";
import { buildSoldFilter, type SoldParams } from "./soldFilter";

const base: SoldParams = {
  area: { kind: "region", region: "Mississauga" },
  windowDays: 90,
  typeKeys: [],
  minBeds: 0,
  minBaths: 0,
  minGarage: 0,
  basementFinished: false,
  minFrontage: 0,
  limit: 100,
  dealType: "sold",
};

describe("buildSoldFilter — dealType branches", () => {
  it("sold keeps the exact DealType + price floor", () => {
    const f = buildSoldFilter(base);
    expect(f).toContain("DealType:=sold");
    expect(f).toContain("ClosePrice:>=1");
  });

  it("delisted expands to the three reasons, drops the price floor, and pins For Sale", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted" });
    expect(f).toContain("DealType:=[terminated,expired,suspended]");
    expect(f).not.toContain("ClosePrice:>=1");
    expect(f).toContain("TransactionType:=`For Sale`");
  });

  it("delisted keeps the window + area clauses", () => {
    const f = buildSoldFilter({ ...base, dealType: "delisted" });
    expect(f).toContain("PurchaseContractDate:>=");
    expect(f).toContain("City:=`Mississauga`");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run src/app/api/market/activity/sold/soldFilter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `soldFilter.ts`** — move `SoldArea`, `SoldParams`, `buildAreaClause`, `buildSoldFilter`, `parsePolygonParam` out of `route.ts` VERBATIM (they are already pure), with these changes:

```typescript
// src/app/api/market/activity/sold/soldFilter.ts
/** Pure filter builders for the sold/delisted comp route — kept out of
 *  route.ts so node-env tests don't load next/server. */

const DAY_MS = 86_400_000;

export type SoldArea =
  | { kind: "region"; region: string }
  | { kind: "polygon"; polygon: [number, number][] }
  | { kind: "school"; schoolKey: string };

export interface SoldParams {
  area: SoldArea;
  windowDays: number;
  typeKeys: string[];
  minBeds: number;
  minBaths: number;
  minGarage: number;
  basementFinished: boolean;
  minFrontage: number;
  limit: number;
  dealType: "sold" | "leased" | "delisted";
}

// buildAreaClause and parsePolygonParam: moved UNCHANGED from route.ts —
// copy their existing bodies here verbatim and export both.

/** variantsForKeys is injected by the route (it imports dashboard code). */
export function buildSoldFilter(
  p: SoldParams,
  variantsForKeysFn?: (keys: string[]) => string[]
): string {
  const cutoffMs = Math.floor(Date.now() - p.windowDays * DAY_MS);
  const clauses: string[] = [
    buildAreaClause(p.area),
    `PurchaseContractDate:>=${cutoffMs}`,
    `PurchaseContractDate:<=${Date.now()}`,
  ];

  if (p.dealType === "delisted") {
    // De-listed rows: DealType carries the reason; there is no transaction so
    // no price floor; terminated LEASE listings are not sale leads.
    clauses.push(`DealType:=[terminated,expired,suspended]`);
    clauses.push(`TransactionType:=\`For Sale\``);
  } else {
    clauses.push(`DealType:=${p.dealType}`);
    clauses.push(`ClosePrice:>=1`);
  }

  const variants = variantsForKeysFn ? variantsForKeysFn(p.typeKeys) : [];
  if (variants.length > 0) {
    const ors = variants.map((v) => `PropertySubType:=\`${v.replace(/`/g, "")}\``);
    clauses.push(`(${ors.join(" || ")})`);
  }
  if (p.minBeds > 0) clauses.push(`BedroomsTotal:>=${p.minBeds}`);
  if (p.minBaths > 0) clauses.push(`BathroomsTotalInteger:>=${p.minBaths}`);
  if (p.minGarage > 0) clauses.push(`ParkingTotal:>=${p.minGarage}`);
  if (p.basementFinished) clauses.push(`BasementTier:<=5`);
  if (p.minFrontage > 0) clauses.push(`LotWidth:>=${p.minFrontage}`);

  return clauses.join(" && ");
}
```

NOTE for the implementer: in the test above no `variantsForKeysFn` is passed — the `typeKeys: []` default path. The route passes `(keys) => variantsForKeys(keys)`.

- [ ] **Step 4: Update `route.ts`** — delete the moved code, import from `./soldFilter`, and make three changes:

```typescript
import { buildSoldFilter, parsePolygonParam, type SoldArea, type SoldParams } from "./soldFilter";
```

(a) `computeSold` passes the variants function:

```typescript
      filter_by: buildSoldFilter(p, (keys) => variantsForKeys(keys)),
```

(b) dealType parsing + per-type window cap in `GET` (replace the existing `const dealType = ...` line and `windowDays` entry):

```typescript
  const dealTypeRaw = sp.get("dealType");
  const dealType: SoldParams["dealType"] =
    dealTypeRaw === "leased" ? "leased" : dealTypeRaw === "delisted" ? "delisted" : "sold";
  // De-listed window is capped at its Typesense retention (90d).
  const maxWindow = dealType === "delisted" ? 90 : MAX_WINDOW_DAYS;
  ...
    windowDays: Math.min(num("windowDays", 1), maxWindow),
```

(c) `pickArea` continues to use the local `parsePolygonParam` import.

- [ ] **Step 5: Extend `soldMapper.ts`** — widen `dealType` and add the two new passthrough fields:

```typescript
  /** 'sold' | 'leased' | de-list reason — real-values deal type from the index. */
  dealType: "sold" | "leased" | "terminated" | "expired" | "suspended";
  /** Days the campaign survived (de-listed rows). */
  daysOnMarket: number | null;
  /** Original ask of a failed campaign (de-listed rows). */
  originalListPrice: number | null;
```

and in `mapSoldDoc`:

```typescript
    dealType: (["leased", "terminated", "expired", "suspended"] as const).find(
      (v) => d.DealType === v
    ) ?? "sold",
    daysOnMarket: posOrNull(d.DaysOnMarket),
    originalListPrice: posOrNull(d.OriginalListPrice),
```

- [ ] **Step 6: Run tests + typecheck**

Run: `npx.cmd vitest run src/app/api/market/activity/sold/soldFilter.test.ts` — Expected: PASS.
Run: `npx.cmd tsc --noEmit && npm.cmd test` — Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/market/activity/sold/
git commit -m "feat(delisted): sold route — pure soldFilter module + dealType=delisted (reasons expansion, no price floor, For Sale pin, 90d cap)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Layers, fetch, adapter, ListingDocument

**Files:**
- Modify: `src/lib/sold/layers.ts`
- Modify: `src/lib/sold/fetchSoldComps.ts`
- Modify: `src/lib/sold/adapter.ts`
- Modify: `src/lib/sold/config.ts`
- Modify: `src/lib/typesense/client.ts` (ListingDocument fields ~line 184-197)
- Test: `src/lib/sold/delisted.layers.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/sold/delisted.layers.test.ts
import { describe, it, expect } from "vitest";
import { toggleLayer, queryPlan, type LayerKey } from "./layers";
import { clampWindowDays, DELISTED_DISPLAY_MAX_DAYS } from "./config";
import { soldToListingDocument } from "./adapter";
import type { SoldListing } from "@/app/api/market/activity/sold/soldMapper";

describe("delisted layer", () => {
  it("is toggleable and independent of forSale/forRent exclusivity", () => {
    const layers = toggleLayer(new Set<LayerKey>(["forSale"]), "delisted");
    expect(layers.has("delisted")).toBe(true);
    expect(layers.has("forSale")).toBe(true);
  });

  it("queryPlan emits a 'delisted' comp kind", () => {
    const plan = queryPlan(new Set<LayerKey>(["delisted"]));
    expect(plan.comps).toEqual(["delisted"]);
    expect(plan.active).toBeNull();
  });
});

describe("per-kind window clamp", () => {
  it("delisted clamps to 90, sold keeps 180", () => {
    expect(DELISTED_DISPLAY_MAX_DAYS).toBe(90);
    expect(clampWindowDays(180, "delisted")).toBe(90);
    expect(clampWindowDays(180, "sold")).toBe(180);
    expect(clampWindowDays(30, "delisted")).toBe(30);
  });
});

describe("adapter — delisted comp", () => {
  const s: SoldListing = {
    id: "X1",
    address: "19 Hossie Terrace",
    closePrice: 0,
    listPrice: 899000,
    soldDate: "2026-05-22T00:00:00.000Z",
    propertySubType: "Detached",
    beds: 3,
    baths: 2.5,
    sqft: null,
    brokerage: "Acme Realty",
    city: "Stratford",
    primaryImageUrl: null,
    lat: 43.37,
    lng: -80.98,
    dealType: "terminated",
    daysOnMarket: 47,
    originalListPrice: 949000,
  };

  it("carries last ask as ListPrice, original ask, reason compKind, DelistedDate, DaysOnMarket", () => {
    const doc = soldToListingDocument(s);
    expect(doc.compKind).toBe("terminated");
    expect(doc.ListPrice).toBe(899000);
    expect(doc.OriginalListPrice).toBe(949000);
    expect(doc.DelistedDate).toBe("2026-05-22T00:00:00.000Z");
    expect(doc.DaysOnMarket).toBe(47);
    expect(doc.SoldDate).toBeUndefined();
    expect(doc.IsSoldComp).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx.cmd vitest run src/lib/sold/delisted.layers.test.ts`
Expected: FAIL — `"delisted"` not assignable to LayerKey / DELISTED_DISPLAY_MAX_DAYS not exported.

- [ ] **Step 3: Implement**

`layers.ts` — widen the key set and the plan:

```typescript
export type LayerKey = "forSale" | "sold" | "leased" | "delisted" | "forRent";
export const LAYER_KEYS: LayerKey[] = ["forSale", "sold", "leased", "delisted", "forRent"];

export type CompKind = "sold" | "leased" | "delisted";

export interface LayerQueryPlan {
  active: { enabled: true; sale: boolean; rent: boolean } | null;
  comps: CompKind[];
}

export function queryPlan(layers: Set<LayerKey>): LayerQueryPlan {
  const sale = layers.has("forSale");
  const rent = layers.has("forRent");
  const comps: CompKind[] = [];
  if (layers.has("sold")) comps.push("sold");
  if (layers.has("leased")) comps.push("leased");
  if (layers.has("delisted")) comps.push("delisted");
  return { active: sale || rent ? { enabled: true, sale, rent } : null, comps };
}
```

(`toggleLayer` and `transactionModeForLayers` need no change — delisted is an independent comp overlay like sold/leased.)

`config.ts` — add the cap and a per-kind clamp (keep the old 1-arg behaviour as the default):

```typescript
/** De-listed comps live in a 90-day Typesense window (design spec 2026-06-09). */
export const DELISTED_DISPLAY_MAX_DAYS = 90;

/** Clamp a requested window to [1, cap]; the cap depends on the comp kind. */
export function clampWindowDays(days: number, kind: "sold" | "leased" | "delisted" = "sold"): number {
  const cap = kind === "delisted" ? DELISTED_DISPLAY_MAX_DAYS : SOLD_DISPLAY_MAX_DAYS;
  if (!Number.isFinite(days)) return cap;
  return Math.min(cap, Math.max(1, Math.floor(days)));
}
```

`fetchSoldComps.ts` — widen the types and clamp per kind:

```typescript
  dealType: "sold" | "leased" | "delisted";
```

(in `SoldQueryArgs`), in `buildSoldQuery` change the windowDays line to:

```typescript
  p.set("windowDays", String(clampWindowDays(windowDays, dealType)));
```

and in `fetchSoldComps` widen `kinds?: Array<"sold" | "leased" | "delisted">`.

`src/lib/typesense/client.ts` — in the sold-comp overlay block of `ListingDocument` (~line 186-194), widen `compKind` and add two fields:

```typescript
  /** Comp layer for an adapted VOW comp; absent for active docs. */
  compKind?: "sold" | "leased" | "terminated" | "expired" | "suspended";
  /** De-list event date as ISO string — de-listed comps only. */
  DelistedDate?: string;
```

(`DaysOnMarket?: number` already exists at ~line 184 — reuse it.)

`adapter.ts` — branch on de-listed kinds:

```typescript
import { isDelistedDealType } from "./dealType";

export function soldToListingDocument(s: SoldListing): ListingDocument {
  const hasCoords = s.lat != null && s.lng != null;
  const delisted = isDelistedDealType(s.dealType);
  return {
    id: s.id,
    // De-listed: the LAST ASK (the price the market rejected) — there is no
    // close price. Sold/leased: the close price, as before.
    ListPrice: delisted ? (s.listPrice ?? 0) : s.closePrice,
    OriginalListPrice: delisted ? (s.originalListPrice ?? undefined) : (s.listPrice ?? undefined),
    UnparsedAddress: s.address || undefined,
    City: s.city ?? undefined,
    PropertySubType: s.propertySubType ?? undefined,
    BedroomsTotal: s.beds ?? undefined,
    BathroomsTotalInteger: s.baths ?? undefined,
    BuildingAreaTotal: s.sqft ?? undefined,
    ListOfficeName: s.brokerage ?? undefined,
    primaryImageUrl: s.primaryImageUrl ?? undefined,
    thumbnailUrl: s.primaryImageUrl ?? undefined,
    location: hasCoords ? [s.lat as number, s.lng as number] : [0, 0],
    IsSoldComp: true,
    compKind: s.dealType,
    SoldDate: s.dealType === "sold" ? (s.soldDate ?? undefined) : undefined,
    LeasedDate: s.dealType === "leased" ? (s.soldDate ?? undefined) : undefined,
    DelistedDate: delisted ? (s.soldDate ?? undefined) : undefined,
    DaysOnMarket: delisted ? (s.daysOnMarket ?? undefined) : undefined,
    isDistressed: false,
    hasSecondarySuitePotential: false,
  };
}
```

- [ ] **Step 4: Run tests + typecheck + full suite**

Run: `npx.cmd vitest run src/lib/sold/delisted.layers.test.ts` — Expected: PASS.
Run: `npx.cmd tsc --noEmit && npm.cmd test` — Expected: green. (The compiler will surface every `Array<"sold" | "leased">` site that needs the widened type — fix each by importing `CompKind` from layers.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/sold/ src/lib/typesense/client.ts
git commit -m "feat(delisted): layer plumbing — LayerKey, queryPlan, per-kind window clamp, adapter mapping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: UI — chip, status badge, card, map marker, window dropdown, lock message

**Files:**
- Modify: `src/components/CommandCenter/LayerChips.tsx`
- Modify: `src/lib/listings/layerStatus.ts`
- Modify: `src/components/CommandCenter/ListingCardBody.tsx`
- Modify: `src/components/Map/AlphaMap.tsx` (~line 547)
- Modify: `src/components/CommandCenter/SoldWindowDropdown.tsx`
- Modify: `src/app/properties/page.tsx` (~line 269)
- Test: `src/lib/listings/layerStatus.delisted.test.ts`

- [ ] **Step 1: Write the failing test (layerStatus is the pure piece)**

```typescript
// src/lib/listings/layerStatus.delisted.test.ts
import { describe, it, expect } from "vitest";
import { layerStatus, LAYER_TONE_CLASS } from "./layerStatus";
import type { ListingDocument } from "@/lib/typesense/client";

describe("layerStatus — de-listed comps", () => {
  it("labels each reason, all in the delisted (amber) tone", () => {
    for (const [kind, label] of [
      ["terminated", "TERMINATED"],
      ["expired", "EXPIRED"],
      ["suspended", "SUSPENDED"],
    ] as const) {
      const s = layerStatus({ id: "x", compKind: kind } as ListingDocument);
      expect(s.label).toBe(label);
      expect(s.tone).toBe("delisted");
    }
    expect(LAYER_TONE_CLASS.delisted).toContain("amber");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx.cmd vitest run src/lib/listings/layerStatus.delisted.test.ts`
Expected: FAIL — tone "delisted" missing.

- [ ] **Step 3: Implement**

`layerStatus.ts`:

```typescript
export type LayerTone = "sale" | "sold" | "leased" | "delisted" | "rent";
export interface LayerStatus { label: string; tone: LayerTone; }

export function layerStatus(doc: ListingDocument): LayerStatus {
  if (doc.compKind === "sold") return { label: "SOLD", tone: "sold" };
  if (doc.compKind === "leased") return { label: "LEASED", tone: "leased" };
  if (doc.compKind === "terminated") return { label: "TERMINATED", tone: "delisted" };
  if (doc.compKind === "expired") return { label: "EXPIRED", tone: "delisted" };
  if (doc.compKind === "suspended") return { label: "SUSPENDED", tone: "delisted" };
  if (doc.TransactionType && /lease/i.test(doc.TransactionType)) return { label: "FOR RENT", tone: "rent" };
  return { label: "FOR SALE", tone: "sale" };
}

export const LAYER_TONE_CLASS: Record<LayerTone, string> = {
  sale: "bg-emerald-500/15 text-emerald-300",
  sold: "bg-rose-500/15 text-rose-300",
  leased: "bg-violet-500/15 text-violet-300",
  delisted: "bg-amber-500/15 text-amber-300",
  rent: "bg-teal-500/15 text-teal-300",
};
```

`LayerChips.tsx` — add to META (order follows LAYER_KEYS automatically):

```typescript
  delisted: { label: "De-listed", on: "bg-amber-500/15 text-amber-300" },
```

`ListingCardBody.tsx` — in the comp branch (`if (doc.compKind || doc.IsSoldComp)`), replace the `isLeased`/`onIso`/`delta` lines with:

```typescript
    const status = layerStatus(doc);
    const isLeased = doc.compKind === "leased";
    const isDelisted =
      doc.compKind === "terminated" || doc.compKind === "expired" || doc.compKind === "suspended";
    const delta = isDelisted ? null : soldVsAsk(doc.ListPrice, doc.OriginalListPrice ?? null);
    // De-listed: ListPrice = final ask, OriginalListPrice = original ask → the
    // cut the seller made during the failed campaign.
    const askCut =
      isDelisted && doc.OriginalListPrice && doc.ListPrice && doc.OriginalListPrice > doc.ListPrice
        ? Math.round(((doc.OriginalListPrice - doc.ListPrice) / doc.OriginalListPrice) * 100)
        : null;
    const onIso = isLeased ? doc.LeasedDate : isDelisted ? doc.DelistedDate : doc.SoldDate;
```

then, inside the returned JSX of the comp branch:
- in the top badge row, after the `{on && ...}` span, add the survived chip:

```tsx
          {isDelisted && (doc.DaysOnMarket ?? 0) > 0 && (
            <span className="text-slate-500">· survived {doc.DaysOnMarket}d</span>
          )}
```

- after the existing `{delta && (...)}` block, add the de-listed ask-cut line:

```tsx
        {isDelisted && (
          <p className="mt-0.5 font-mono text-xs font-semibold text-amber-300">
            {askCut !== null
              ? `Cut ${askCut}% during campaign (from $${(doc.OriginalListPrice ?? 0).toLocaleString()})`
              : "Last ask — did not sell"}
          </p>
        )}
```

`AlphaMap.tsx` (~line 548) — after the leased line in `getBackgroundColor`, add:

```typescript
        if (
          listing.compKind === "terminated" ||
          listing.compKind === "expired" ||
          listing.compKind === "suspended"
        )
          return [245, 158, 11, 230]; // amber — de-listed
```

`SoldWindowDropdown.tsx` — cap options when the De-listed layer is lit:

```typescript
import { SOLD_WINDOW_OPTIONS, DELISTED_DISPLAY_MAX_DAYS } from "@/lib/sold/config";
...
export default function SoldWindowDropdown() {
  const { soldWindowDays, setSoldWindowDays } = useCommandCenterStore();
  const activeLayers = useCommandCenterStore((s) => s.activeLayers);
  // De-listed comps live in a 90-day index window — hide the longer options
  // while that layer is lit (fetch clamps per kind regardless; see config.ts).
  const cap = activeLayers.has("delisted") ? DELISTED_DISPLAY_MAX_DAYS : Infinity;
  const options = SOLD_WINDOW_OPTIONS.filter((d) => d <= cap);
  const value = Math.min(soldWindowDays, options[options.length - 1]);
  return (
    <label className={`flex shrink-0 items-center gap-1.5 ${LABEL} text-slate-400`}>
      <span className="sr-only">Comp window</span>
      <select
        value={value}
        onChange={(e) => setSoldWindowDays(Number(e.target.value))}
        className="border border-slate-800 bg-slate-900 px-2 py-1.5 text-cyan-300 focus:border-cyan-500/50 focus:outline-none"
      >
        {options.map((d) => (
          <option key={d} value={d}>{fmt(d)}</option>
        ))}
      </select>
    </label>
  );
}
```

`src/app/properties/page.tsx` (~line 269) — generalize the lock message (sold-only wording is wrong when the De-listed layer is gated):

```typescript
  const soldLockMsg = `${totalCount.toLocaleString()} gated market record${totalCount === 1 ? "" : "s"} — sign in to view`;
```

Also confirm (no code change expected): the FilterBar condition that shows `SoldWindowDropdown` (`activeLayers.has("sold") || activeLayers.has("leased")` at `src/components/CommandCenter/FilterBar.tsx:101`) must extend to `|| activeLayers.has("delisted")` — make that edit too.

- [ ] **Step 4: Run tests + typecheck + full suite + build**

Run: `npx.cmd vitest run src/lib/listings/layerStatus.delisted.test.ts` — Expected: PASS.
Run: `npx.cmd tsc --noEmit && npm.cmd test && npm.cmd run build` — Expected: green build.

- [ ] **Step 5: Manual smoke (after Task 7's backfill has run)**

Run `npm.cmd run dev`, open /properties signed-in, light the De-listed chip: amber markers + cards with TERMINATED/EXPIRED badges, last-ask prices, survived-days; window dropdown capped at 90; anonymous (incognito) shows the gate overlay with the count teaser.

- [ ] **Step 6: Commit**

```bash
git add src/components/ src/lib/listings/ src/app/properties/page.tsx
git commit -m "feat(delisted): Terminal UI — De-listed chip, amber markers, reason cards, capped window, generalized gate copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 3 — Cleanup (pays the RAM bill)

### Task 11: Delete the orphaned legacy `listings` collection + dead metrics stack

**Files:**
- Create: `scripts/admin/deleteLegacyListingsCollection.ts`
- Delete: `src/services/metrics/ETLPipeline.js`, `src/services/metrics/test-flipper.js`, `src/services/metrics/test-edge-cases.js` (verify the folder holds nothing else live first)

- [ ] **Step 1: Verify the stack is dead**

Run: `npx.cmd tsx -e "1"` is not needed — use grep:
`rg -l "services/metrics" src scripts --glob !src/services/metrics/**`
Expected: NO matches (the only importers are the files being deleted). If anything matches, STOP and reassess.

- [ ] **Step 2: Write the guarded deletion script**

```typescript
// scripts/admin/deleteLegacyListingsCollection.ts
/**
 * Delete the ORPHANED legacy `listings` Typesense collection (~95k docs).
 * Its only consumer was the dead src/services/metrics stack (removed in the
 * same commit). Frees more RAM than the De-listed window consumes — the
 * "net $0" of the De-listed design (spec 2026-06-09).
 *
 * Run:  npx tsx scripts/admin/deleteLegacyListingsCollection.ts          (dry-run)
 *       npx tsx scripts/admin/deleteLegacyListingsCollection.ts --apply
 */
import 'dotenv/config';
import Typesense from 'typesense';

async function main() {
  const apply = process.argv.includes('--apply');
  const client = new Typesense.Client({
    nodes: [{ host: '9uyapwh6e5qmvl34p-1.a1.typesense.net', port: 443, protocol: 'https' }],
    apiKey: process.env.TYPESENSE_ADMIN_API_KEY!,
    connectionTimeoutSeconds: 60,
  });
  const c: any = await client.collections('listings').retrieve();
  console.log(`Collection "listings": ${c.num_documents} docs, ${c.fields?.length} fields, created ${c.created_at}`);
  if (!apply) return console.log('Dry-run. Re-run with --apply to DELETE the collection.');
  await client.collections('listings').delete();
  console.log('✅ Deleted.');
}

main().catch((e) => { console.error('❌', e?.message || e); process.exit(1); });
```

- [ ] **Step 3: Delete the dead files, verify, commit**

```bash
git rm src/services/metrics/ETLPipeline.js src/services/metrics/test-flipper.js src/services/metrics/test-edge-cases.js
```

Run: `npx.cmd tsc --noEmit && npm.cmd test && npm.cmd run build` — Expected: green (these are .js files outside the TS build, but build confirms nothing imports them).

```bash
git add scripts/admin/deleteLegacyListingsCollection.ts
git commit -m "chore(cleanup): remove dead src/services/metrics stack + guarded delete script for the orphaned legacy listings collection

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Run the deletion (OWNER-GATED — production delete)**

Dry-run: `npx.cmd tsx scripts/admin/deleteLegacyListingsCollection.ts`
Then with approval: `npx.cmd tsx scripts/admin/deleteLegacyListingsCollection.ts --apply`
Expected: `✅ Deleted.` (frees ~95k docs of RAM).

---

### Task 12: Final verification + PR

- [ ] **Step 1: Full gate**

Run: `npx.cmd tsc --noEmit && npm.cmd run lint && npm.cmd test && npm.cmd run build`
Expected: all green, lint 0 errors.

- [ ] **Step 2: Live verification checklist**

1. `sold_listings` contains de-listed docs ≤90d only; sold/leased unaffected (probe counts by DealType).
2. `/api/market/activity/sold?region=Mississauga&windowDays=90&dealType=delisted&limit=5` — signed-out: `{count, listings: [], locked: true}`; signed-in: rows with reason dealTypes.
3. Terminal: De-listed chip works alone and combined with For Sale; markers amber; brokerage shown on every card (§4).
4. Nightly: next `ingester.ts sync` log shows "QUERY C" complete and the master cursor untouched by C's outcome.

- [ ] **Step 3: PR**

```bash
gh pr create --title "feat: De-listed mode — gated Terminal layer for terminated/expired/suspended listings" --body "Implements docs/superpowers/specs/2026-06-09-delisted-mode-design.md ..."
```

---

## Self-review notes (already applied)

- Spec §5.4 listed two added Typesense fields; this plan adds **three** (also `OriginalListPrice`) — required for the spec's own §5.6 ask-cut delta, which is otherwise unimplementable. Spec amended at execution time.
- `DaysOnMarket` already exists on `ListingDocument` (client.ts:184) — reused, not redeclared.
- The route's `variantsForKeys` stays in route.ts (it imports dashboard code); `buildSoldFilter` takes it as an optional function parameter so the filter module stays pure/testable.
- Geocoding for de-listed rows resolves from the parsed-full-postal (sold-blob lesson) via `resolveLocation`, both for Supabase lat/lng and the Typesense geopoint.
- Query C cursor lives in a separate `sync_state` row (`id='delisted'`) — the master row's semantics and the §12 cursor caveat are untouched.
