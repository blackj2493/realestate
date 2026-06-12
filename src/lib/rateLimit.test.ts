import { describe, it, expect } from 'vitest';
import { makeRateLimiter } from './rateLimit';

describe('makeRateLimiter — fixed window per key (audit HIGH-17)', () => {
  it('allows up to max requests in a window, then rejects with a Retry-After', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 3 });
    const t0 = 1_000_000;
    expect(rl.check('1.2.3.4', t0).allowed).toBe(true);
    expect(rl.check('1.2.3.4', t0 + 1).allowed).toBe(true);
    expect(rl.check('1.2.3.4', t0 + 2).allowed).toBe(true);
    const fourth = rl.check('1.2.3.4', t0 + 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSec).toBeGreaterThan(0);
    expect(fourth.retryAfterSec).toBeLessThanOrEqual(60);
  });

  it('tracks keys independently', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 1 });
    const t0 = 5_000;
    expect(rl.check('a', t0).allowed).toBe(true);
    expect(rl.check('b', t0).allowed).toBe(true);
    expect(rl.check('a', t0 + 1).allowed).toBe(false);
  });

  it('resets after the window elapses', () => {
    const rl = makeRateLimiter({ windowMs: 60_000, max: 1 });
    const t0 = 0;
    expect(rl.check('k', t0).allowed).toBe(true);
    expect(rl.check('k', t0 + 59_999).allowed).toBe(false);
    expect(rl.check('k', t0 + 60_000).allowed).toBe(true);
  });
});
