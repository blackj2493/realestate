/**
 * Tests for GET /api/market/price-trend
 *
 * The heavy aggregation now lives in the region_price_trend RPC (migration 040); the
 * route is a gate + cache wrapper that maps the RPC's { points, summary } payload and
 * computes monthlyVelocity in Node. These tests cover:
 *   - MEDIUM-23: `%`/`_` wildcard injection via the `region` param → 400 (no DB call)
 *   - the RPC is called with the resolved scope and its points/summary are returned
 *   - monthlyVelocity is derived from the RPC points over the 6 settled months (2..7 back)
 *   - an RPC error surfaces as a 500 with an empty summary
 *
 * (The former MEDIUM-8 quoted-.or() and MEDIUM-10 pagination tests are retired: the RPC
 * takes the region as a bound parameter and aggregates server-side, so there is no
 * client-built .or() filter and no 1,000-row PostgREST pagination to guard.)
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

/** 'YYYY-MM' key for N months back from now, in UTC (matches computeTrend's monthKey). */
function monthKeyBack(n: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Mock service-role client whose .rpc() resolves to the given { data, error }. */
function supabaseRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  vi.mocked(getServiceRoleClient).mockReturnValue(
    { rpc } as unknown as ReturnType<typeof getServiceRoleClient>
  );
  return rpc;
}

function makePriceTrendRequest(region: string) {
  return new NextRequest(`http://localhost/api/market/price-trend?region=${region}`);
}

beforeEach(() => {
  vi.clearAllMocks();
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

  // ── RPC wiring: scope passed in, points/summary returned ────────────────────
  it('calls region_price_trend with the region and returns its points + summary', async () => {
    const rpc = supabaseRpc({
      data: {
        points: [{ month: '2026-01', medianPrice: 800000, medianPpsf: 500, sales: 10 }],
        summary: { soldToListPct: 99.1, pctOverAsking: 22, listPriceCoverage: 0.9, sales90: 120 },
      },
      error: null,
    });

    const res = await GET(makePriceTrendRequest('Brampton'));
    expect(res.status).toBe(200);

    expect(rpc).toHaveBeenCalledWith(
      'region_price_trend',
      expect.objectContaining({ p_region: 'Brampton', p_subtypes: null, p_months: 24 })
    );

    const body = await res.json();
    expect(body.region).toBe('Brampton');
    expect(body.points).toHaveLength(1);
    expect(body.summary.soldToListPct).toBe(99.1);
    expect(body.summary.sales90).toBe(120);
  });

  // ── basement param → p_basement (migration 043) ─────────────────────────────
  it('defaults p_basement to "any" and forwards a finished/unfinished constraint', async () => {
    const anyRpc = supabaseRpc({ data: { points: [], summary: {} }, error: null });
    await GET(makePriceTrendRequest('Brampton'));
    expect(anyRpc).toHaveBeenCalledWith(
      'region_price_trend',
      expect.objectContaining({ p_basement: 'any' })
    );

    const finRpc = supabaseRpc({ data: { points: [], summary: {} }, error: null });
    await GET(new NextRequest('http://localhost/api/market/price-trend?region=Brampton&basement=unfinished'));
    expect(finRpc).toHaveBeenCalledWith(
      'region_price_trend',
      expect.objectContaining({ p_basement: 'unfinished' })
    );
  });

  // ── monthlyVelocity is derived in Node from the 3 settled months (2..4 back) ──
  // Trailing-3 (migration 082) keeps the sales pace seasonally matched to the live active
  // snapshot that months-of-inventory divides; the old trailing-6 reached into the winter
  // trough and ~doubled months-of-supply vs the boards.
  it('computes monthlyVelocity from the 3 settled months (2..4), excluding the latest two AND months 5+', async () => {
    const points = [
      // Months 0 and 1 are still accruing — EXCLUDED.
      { month: monthKeyBack(0), medianPrice: 9, medianPpsf: 9, sales: 1000 },
      { month: monthKeyBack(1), medianPrice: 9, medianPpsf: 9, sales: 1000 },
      // Months 2..4 are the settled window — averaged. 3 × 12 / 3 = 12.
      ...[2, 3, 4].map((n) => ({ month: monthKeyBack(n), medianPrice: 800000, medianPpsf: 500, sales: 12 })),
      // Months 5..7 are now OUTSIDE the window — must NOT affect velocity.
      ...[5, 6, 7].map((n) => ({ month: monthKeyBack(n), medianPrice: 800000, medianPpsf: 500, sales: 1000 })),
    ];
    supabaseRpc({
      data: { points, summary: { soldToListPct: null, pctOverAsking: null, listPriceCoverage: 0, sales90: 0 } },
      error: null,
    });

    const res = await GET(makePriceTrendRequest('Brampton'));
    const body = await res.json();
    expect(body.summary.monthlyVelocity).toBe(12);
  });

  // ── RPC error → 500 with empty summary ──────────────────────────────────────
  it('returns 500 with an empty summary when the RPC errors', async () => {
    supabaseRpc({ data: null, error: { message: 'boom' } });

    const res = await GET(makePriceTrendRequest('Brampton'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('boom');
    expect(body.points).toEqual([]);
    expect(body.summary.sales90).toBe(0);
  });
});
