import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase BEFORE importing the route.
const insertSpy = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: insertSpy })),
  })),
}));

// Mock resend so Resend can be imported at the top level in the route.
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({
    emails: { send: vi.fn().mockResolvedValue({}) },
  })),
}));

import { POST } from './route';

let _ipCounter = 0;
function makeReq(body: unknown): Request {
  // Use a unique IP per test so the in-process rate-limiter never trips across tests.
  const ip = `10.0.0.${++_ipCounter}`;
  return new Request('http://localhost/api/viewing-requests', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  insertSpy.mockReset();
  insertSpy.mockResolvedValue({ error: null });
});

describe('POST /api/viewing-requests', () => {
  it('valid body → 200 { success: true } and insert called with correct row', async () => {
    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
    }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const row = insertSpy.mock.calls[0][0];
    expect(row).toMatchObject({
      listing_key: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
    });
  });

  it('non-viewing intent tags the stored message (no schema change)', async () => {
    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
      intent: 'price_opinion',
      message: 'is 899k fair?',
    }) as never);

    expect(res.status).toBe(200);
    const row = insertSpy.mock.calls[0][0];
    expect(row.message).toBe('[Price second-opinion] is 899k fair?');
  });

  it('viewing intent (default) leaves the message untagged', async () => {
    await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'morning please',
    }) as never);
    expect(insertSpy.mock.calls[0][0].message).toBe('morning please');
  });

  it('invalid listingKey (wrong pattern) → 400, no insert', async () => {
    const res = await POST(makeReq({
      listingKey: 'invalid-key-123',
      name: 'Jane Doe',
      email: 'jane@example.com',
    }) as never);

    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('invalid email → 400, no insert', async () => {
    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'not-an-email',
    }) as never);

    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('message over 2000 chars → 400, no insert', async () => {
    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'x'.repeat(2001),
    }) as never);

    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('Resend throwing → still returns 200 (email is best-effort)', async () => {
    const { Resend } = await import('resend');
    vi.mocked(Resend).mockImplementationOnce(() => ({
      emails: {
        send: vi.fn().mockRejectedValue(new Error('SMTP down')),
      },
    }));

    // Set the env var so the email branch is entered.
    process.env.RESEND_API_KEY = 'test-key';
    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
    }) as never);
    delete process.env.RESEND_API_KEY;

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
