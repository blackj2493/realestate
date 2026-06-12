/**
 * Tests for GET /api/market/price-trend
 *
 * Covers three audit findings consolidated into this route:
 *   MEDIUM-23: `%`/`_` wildcard injection via the `region` param → 400
 *   MEDIUM-8:  multi-word regions produce unquoted .or() values → PostgREST parse failure
 *   MEDIUM-10: .limit(20000) silently capped at 1,000 by PostgREST → pagination via .range()
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── mocks must be hoisted before the module under test is imported ────────────

vi.mock('@/lib/auth/requireConsumer', () => ({
  getConsumer: vi.fn().mockResolvedValue({ isConsumer: true }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

vi.mock('@/lib/dashboard/propertyTypes', () => ({
  variantsForKeys: vi.fn().mockReturnValue([]),
  parseTypeKeys: vi.fn().mockReturnValue([]),
}));

vi.mock('next/cache', () => ({
  // In test env unstable_cache must be a pass-through so the async fn actually runs.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import { GET } from './route';

// ── stub helpers ─────────────────────────────────────────────────────────────

/** Row shape the route bucketing keeps: valid date ≤24 months ago, price >0. */
function makeRow(i: number) {
  // Spread 2,500 rows evenly across the last 20 months so every row survives the
  // 24-month cutoff filter inside computeTrend.
  const d = new Date();
  d.setMonth(d.getMonth() - (i % 20)); // 0..19 months ago
  return {
    close_price: 700000 + i,
    list_price: 690000 + i,
    purchase_contract_date: d.toISOString(),
    building_area_total: 1200,
  };
}

/** Captured .or() call argument(s) — set by the stub. */
let capturedOrArg = '';

/**
 * Chainable Supabase stub that records the `.or()` argument and returns slices of
 * `dataset` via `.range(from, to)` to simulate PostgREST pagination.
 */
function supabaseReturningSlices(dataset: ReturnType<typeof makeRow>[]) {
  let rangeFrom = 0;
  let rangeTo = 0;

  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'gte', 'in', 'order']) {
    q[m] = vi.fn(() => q);
  }
  q.or = vi.fn((arg: string) => {
    capturedOrArg = arg;
    return q;
  });
  q.range = vi.fn((f: number, t: number) => {
    rangeFrom = f;
    rangeTo = t;
    return q;
  });
  // Thenable — resolves with the slice PostgREST would return for this page.
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      resolve({ data: dataset.slice(rangeFrom, rangeTo + 1), error: null })
    );

  return q as unknown as ReturnType<typeof getServiceRoleClient> & {
    or: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
  };
}

// ── utilities ─────────────────────────────────────────────────────────────────

function makePriceTrendRequest(region: string) {
  return new NextRequest(
    `http://localhost/api/market/price-trend?region=${region}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedOrArg = '';
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/market/price-trend', () => {
  // ── MEDIUM-23: wildcard injection guard ─────────────────────────────────────
  it('MEDIUM-23: returns 400 when region contains a % wildcard (no DB call)', async () => {
    const res = await GET(makePriceTrendRequest('%25'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid region/i);
    // The Supabase client must never have been obtained.
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });

  // ── MEDIUM-8: quoted .or() values for multi-word regions ────────────────────
  it('MEDIUM-8: double-quotes multi-word region values in the .or() call', async () => {
    const stub = supabaseReturningSlices([]);
    vi.mocked(getServiceRoleClient).mockReturnValue(stub);

    const region = 'Vales of Castlemore North';
    const res = await GET(makePriceTrendRequest(encodeURIComponent(region)));
    expect(res.status).toBe(200);

    // PostgREST needs the values double-quoted when they contain spaces.
    expect(capturedOrArg).toContain(`city.ilike."${region}"`);
    expect(capturedOrArg).toContain(`city_region.ilike."${region}"`);
  });

  // ── MEDIUM-10: paginate past PostgREST 1k cap ───────────────────────────────
  it('MEDIUM-10: paginates with .range() and collects all rows from a 2,500-row dataset', async () => {
    const dataset = Array.from({ length: 2500 }, (_, i) => makeRow(i));
    const stub = supabaseReturningSlices(dataset);
    vi.mocked(getServiceRoleClient).mockReturnValue(stub);

    const res = await GET(makePriceTrendRequest('Brampton'));
    expect(res.status).toBe(200);

    // The builder loop must have called .range() at least 3 times (pages 0-999, 1000-1999, 2000-2999).
    expect(stub.range).toHaveBeenCalledTimes(3);

    // All 2,500 rows fed into the monthly buckets — total sales across all returned
    // TrendPoints must equal the dataset length (every row has a valid date/price).
    const body: { points: { sales: number }[] } = await res.json();
    const totalSales = body.points.reduce((sum, p) => sum + p.sales, 0);
    expect(totalSales).toBe(2500);
  });
});
