import { describe, it, expect, vi } from 'vitest';
import { buildCohortTree } from '@/lib/avm/cohorts';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

// Chainable query stub: every builder method returns itself; awaiting it
// resolves to the given payload (minimal then-only thenable; supabase-js
// builders are awaited, never .catch()-chained here).
function queryResolving(payload: { data: unknown; error: unknown }) {
  const q: Record<string, unknown> = {};
  // 'eq' joined the chain when the audit reads were pinned to the community rung
  // (migration 130 / PR #450). A stub missing a builder method fails as a TypeError
  // deep inside the module, which reads like a logic bug rather than a stub gap.
  for (const m of ['from', 'select', 'eq', 'order', 'range', 'rpc']) {
    q[m] = vi.fn(() => q);
  }
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(payload));
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
