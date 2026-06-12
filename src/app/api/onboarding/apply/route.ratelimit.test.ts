/**
 * 429-path coverage for POST /api/onboarding/apply (audit LOW-30).
 *
 * Unlike route.test.ts (which mocks @/lib/rateLimit away to test route logic),
 * this file uses the REAL limiter. The limiter is module-level state, so each
 * test gets a fresh module via vi.resetModules() + dynamic import.
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
  return new NextRequest('http://x/api/onboarding/apply', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'Jane Smith', email: 'jane@example.com' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/onboarding/apply — per-IP rate limit (5/min)', () => {
  it('allows the first 5 requests, 429s the 6th with a Retry-After header', async () => {
    const { POST } = await freshRoute();

    for (let i = 1; i <= 5; i++) {
      const res = await POST(makeReq());
      expect(res.status, `request #${i} should pass the gate`).toBe(200);
    }

    const res6 = await POST(makeReq());
    expect(res6.status).toBe(429);
    expect(Number(res6.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect(await res6.json()).toEqual({ ok: false, error: 'Too many requests' });
  });

  it('a fresh module (fresh window) starts allowing again', async () => {
    const { POST } = await freshRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
  });
});
