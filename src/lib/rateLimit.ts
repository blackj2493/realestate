import type { NextRequest } from 'next/server';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-process rate limiter for API routes that proxy paid upstreams
 * (Mapbox geocode/isochrone — audit HIGH-17). Per-instance memory: counters
 * reset on deploy/restart and are NOT shared across instances. That is an
 * accepted trade-off for the current single-instance Railway deploy — move to
 * Upstash/Redis if the app ever scales horizontally.
 */
export function makeRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string, nowMs: number = Date.now()): { allowed: boolean; retryAfterSec: number } {
      const b = buckets.get(key);
      if (!b || nowMs >= b.resetAt) {
        // Opportunistic GC so the map can't grow unbounded across windows.
        if (buckets.size > 10_000) {
          for (const [k, v] of buckets) if (nowMs >= v.resetAt) buckets.delete(k);
        }
        buckets.set(key, { count: 1, resetAt: nowMs + opts.windowMs });
        return { allowed: true, retryAfterSec: 0 };
      }
      b.count += 1;
      if (b.count > opts.max) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - nowMs) / 1000)) };
      }
      return { allowed: true, retryAfterSec: 0 };
    },
  };
}

/**
 * Client key for rate limiting: first hop of x-forwarded-for, else x-real-ip,
 * else a shared bucket. KNOWN LIMITATION: the leftmost XFF entry is
 * client-controllable, so a determined attacker can rotate spoofed values to
 * dodge per-IP limits — this raises the cost of casual quota-burn loops, it is
 * not a hard security boundary. Revisit (rightmost-trusted hop or proxy-set
 * header) if the trust topology changes or abuse is observed.
 */
export function clientIpFrom(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
