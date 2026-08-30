import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable stub, PROXIED not enumerated — see loadCohortTree.test.ts for why a
// hard-coded method list reddens main the day a query gains one.
const lookupResult: { data: unknown } = { data: null };
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    const base: Record<string, unknown> = {
      maybeSingle: vi.fn(() => Promise.resolve(lookupResult)),
      single: vi.fn(() => Promise.resolve(lookupResult)),
    };
    const q: Record<string, unknown> = new Proxy(base, {
      get(t, prop) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop);
        if (prop in t) return t[prop];
        spies[prop] ??= vi.fn(() => q);
        return spies[prop];
      },
    });
    return q;
  },
}));

import { resolveRatioPrice, MIN_PLAUSIBLE_SALE_PRICE } from './ratioPriceCalculator';

const ask = (listPrice: number, propertySubType = 'Detached', cityRegion = 'Willowdale East') =>
  resolveRatioPrice({ listPrice, propertySubType, cityRegion });

beforeEach(() => { lookupResult.data = null; });

describe('resolveRatioPrice — a ratio needs a credible denominator', () => {
  it('passes a normal ask straight through, with no lookup and no discovery flag', async () => {
    expect(await ask(1_688_000)).toEqual({ calculation_price: 1_688_000, is_price_discovery: false });
  });

  it('REFUSES to divide by a $1 bidding-war placeholder', async () => {
    // C13591550 published cap_rate_est 19,768,692% because this returned the $1.
    // 0 routes the caller into financialMetrics' zero-price guard, which publishes
    // the 0 sentinel across every ratio metric — no number at all.
    expect(await ask(1)).toEqual({ calculation_price: 0, is_price_discovery: false });
  });

  it('substitutes a regional average when there IS one', async () => {
    lookupResult.data = { avg_sale_price: 1_250_000 };
    expect(await ask(1)).toEqual({ calculation_price: 1_250_000, is_price_discovery: true });
  });

  it('rejects a substitute that fails the same bar it is replacing', async () => {
    // A bad row in the lookup table must not reintroduce the fault it exists to fix.
    lookupResult.data = { avg_sale_price: 500 };
    expect(await ask(1)).toEqual({ calculation_price: 0, is_price_discovery: false });
  });

  it('does not care about the sub-type — the old allowlist missed 161 of 222 cases', async () => {
    // MobileTrailer (76) and Vacant Land (72) are not Detached/Semi-Detached, so the
    // previous guard never ran on them.
    for (const t of ['Condo Apartment', 'MobileTrailer', 'Vacant Land', 'Att/Row/Townhouse']) {
      expect(await ask(1, t)).toEqual({ calculation_price: 0, is_price_discovery: false });
    }
  });

  it('never flags discovery when it did not actually discover anything', async () => {
    // The old code returned is_price_discovery: true alongside the untouched $1 —
    // the flag asserted a substitution that had failed.
    const r = await ask(1, 'Detached', '');
    expect(r.is_price_discovery).toBe(false);
    expect(r.calculation_price).toBe(0);
  });

  it('keeps genuinely cheap stock — the floor is low and hard, not a market judgement', async () => {
    // 539 active listings sit under $50k (northern Ontario, mobile homes on leased
    // land). Blanking their cap rates would be a different bug.
    expect(await ask(MIN_PLAUSIBLE_SALE_PRICE)).toEqual({
      calculation_price: MIN_PLAUSIBLE_SALE_PRICE, is_price_discovery: false,
    });
    expect((await ask(115_000, 'Condo Townhouse')).calculation_price).toBe(115_000);
  });
});
