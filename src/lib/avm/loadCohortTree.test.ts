import { describe, it, expect, vi } from 'vitest';
import { buildCohortTree } from '@/lib/avm/cohorts';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

/**
 * Chainable query stub: ANY builder method returns the stub; awaiting it resolves to
 * the given payload (a minimal then-only thenable — supabase-js builders are awaited,
 * never .catch()-chained here).
 *
 * THE METHOD LIST USED TO BE HARD-CODED, and that is what broke this file. #450 added
 * `.eq('cohort_rung', 'community')` to fetchAllAudit; `eq` was not in the list, so the
 * chain returned undefined and every test here failed with
 * "supabase.from(...).select(...).eq is not a function" — a red main, in a file whose
 * subject (does a timeout degrade gracefully?) had not changed at all.
 *
 * A stub that enumerates the methods it supports asserts something nobody meant to
 * assert: that production code will never call a different one. So it proxies instead,
 * and memoises a vi.fn() per name so call assertions still work.
 */
function queryResolving(payload: { data: unknown; error: unknown }) {
  const spies: Record<string, ReturnType<typeof vi.fn>> = {};
  const base: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(payload)),
  };
  const q: Record<string, unknown> = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return Reflect.get(target, prop);
      if (prop in target) return target[prop];
      spies[prop] ??= vi.fn(() => q);
      return spies[prop];
    },
  });
  return q;
}

const TIMEOUT_ERROR = Object.assign(new Error('canceling statement due to statement timeout'), {
  code: '57014',
});

// Fresh module per test: loadCohortTree.ts holds a module-level cache.
async function freshModule(payload: { data: unknown; error: unknown }) {
  vi.resetModules();
  const supa = await import('@/lib/supabase/client');
  vi.mocked(supa.getServiceRoleClient).mockReturnValue(
    queryResolving(payload) as unknown as ReturnType<typeof supa.getServiceRoleClient>
  );
  return import('./loadCohortTree');
}

describe('loadCohortTreeSafe — public-page resilience (audit CRITICAL-5)', () => {
  it('resolves to an empty tree instead of throwing when Supabase times out (57014)', async () => {
    const mod = await freshModule({ data: null, error: TIMEOUT_ERROR });
    const tree = await mod.loadCohortTreeSafe();
    expect(tree).toEqual(buildCohortTree([], []));
  });

  it('keeps loadCohortTree (unsafe) throwing for the gated API route', async () => {
    const mod = await freshModule({ data: null, error: TIMEOUT_ERROR });
    await expect(mod.loadCohortTree()).rejects.toMatchObject({ code: '57014' });
  });

  it('serves the stale cached tree when a refresh fails after a prior success', async () => {
    vi.useFakeTimers();
    try {
      // First load succeeds with one audit row + matching pair.
      const row = {
        city_region: 'Vales of Castlemore North',
        property_sub_type: 'Detached',
        model_accuracy_score: 0.8,
        total_sales_analyzed: 50,
      };
      const pair = { city: 'Brampton', city_region: 'Vales of Castlemore North' };
      vi.resetModules();
      const supa = await import('@/lib/supabase/client');
      const good = queryResolving({ data: [row, pair], error: null });
      vi.mocked(supa.getServiceRoleClient).mockReturnValue(
        good as unknown as ReturnType<typeof supa.getServiceRoleClient>
      );
      const mod = await import('./loadCohortTree');
      const first = await mod.loadCohortTreeSafe();
      expect(Object.keys(first).length).toBeGreaterThan(0);

      // Expire the 1h TTL, then make the DB fail — the stale tree must survive.
      vi.advanceTimersByTime(61 * 60 * 1000);
      vi.mocked(supa.getServiceRoleClient).mockReturnValue(
        queryResolving({ data: null, error: TIMEOUT_ERROR }) as unknown as ReturnType<
          typeof supa.getServiceRoleClient
        >
      );
      // The refresh now retries once on a transient 57014 before giving up;
      // flush the backoff timer so the retry resolves under fake timers.
      const secondPromise = mod.loadCohortTreeSafe();
      await vi.runAllTimersAsync();
      const second = await secondPromise;
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
