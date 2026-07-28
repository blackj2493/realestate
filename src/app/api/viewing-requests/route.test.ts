import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase BEFORE importing the route.
const insertSpy = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(() => ({
    from: vi.fn(() => ({ insert: insertSpy })),
  })),
}));

// The route now sends through the observable sendTransactionalEmail wrapper (and the lead
// follow-up), so mock at THAT boundary rather than the raw `resend` module. This keeps the
// route test about the route (validation, insert, status), and means a send failure doesn't
// route through the wrapper's getServiceRoleClient() failure-recording (which would
// otherwise reuse insertSpy and inflate the insert count).
const sendSpy = vi.fn().mockResolvedValue({ sent: true });
vi.mock('@/lib/alerts/sendEmail', () => ({
  sendTransactionalEmail: (...args: unknown[]) => sendSpy(...args),
}));
vi.mock('@/lib/alerts/leadFollowUpEmail', () => ({
  sendLeadFollowUp: vi.fn().mockResolvedValue({ sent: true }),
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
  sendSpy.mockReset();
  sendSpy.mockResolvedValue({ sent: true });
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

  it('email send failing → still returns 200 (email is best-effort)', async () => {
    // The wrapper is non-throwing; a failed send resolves { sent: false }. Even so, and even
    // if it threw, the lead capture (the insert) must stand and the route must return 200.
    sendSpy.mockResolvedValueOnce({ sent: false, error: 'SMTP down' });

    const res = await POST(makeReq({
      listingKey: 'W12632618',
      name: 'Jane Doe',
      email: 'jane@example.com',
    }) as never);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'notification:viewing-request' })
    );
  });
});
