/**
 * 429-path coverage for POST /api/share (audit LOW-31).
 *
 * Uses the REAL rate limiter (no @/lib/rateLimit mock). The limiter is
 * module-level state, so each test gets a fresh module via vi.resetModules()
 * + dynamic import. NOTE: the route validates the body with zod BEFORE the
 * gate, so every request here carries a valid body — a 400 would never reach
 * the limiter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

// Fresh route module (= fresh rate-limit window) with a happy-path supabase mock.
async function freshRoute() {
  vi.resetModules();
  const supa = await import('@/lib/supabase/client');
  vi.mocked(supa.getServiceRoleClient).mockReturnValue({
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  } as never);
  return import('./route');
}

function makeReq(): NextRequest {
  // No IP headers → clientIpFrom resolves every request to the same 'unknown'
  // bucket, which is exactly what we want for window-exhaustion tests.
  return new NextRequest('http://x/api/share', {
    method: 'POST',
    body: JSON.stringify({ listingKeys: ['W1234567'] }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/share — per-IP rate limit (10/min)', () => {
  it('allows the first 10 requests, 429s the 11th with a Retry-After header', async () => {
    const { POST } = await freshRoute();

    for (let i = 1; i <= 10; i++) {
      const res = await POST(makeReq());
      expect(res.status, `request #${i} should pass the gate`).toBe(200);
    }

    const res11 = await POST(makeReq());
    expect(res11.status).toBe(429);
    expect(Number(res11.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(await res11.json()).toEqual({ error: 'Too many requests' });
  });

  it('a fresh module (fresh window) starts allowing again', async () => {
    const { POST } = await freshRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
  });
});
