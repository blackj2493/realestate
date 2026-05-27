import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/client', () => ({
  getServiceRoleClient: vi.fn(),
}));

import { getServiceRoleClient } from '@/lib/supabase/client';
import { POST } from './route';

const mockGetClient = vi.mocked(getServiceRoleClient);

function makeClient(insertResult: { error: unknown } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn(() => ({ insert }));
  return { client: { from }, insert, from };
}

function post(bodyOrText: unknown): Promise<Response> {
  const body =
    typeof bodyOrText === 'string' ? bodyOrText : JSON.stringify(bodyOrText);
  return POST(
    new NextRequest('http://x/api/onboarding/apply', { method: 'POST', body })
  );
}

const VALID_APPLICATION = {
  applicantType: 'investor',
  fullName: 'Jane Smith',
  email: 'jane@example.com',
  entityName: 'Smith Holdings',
  objectives: ['cashflow', 'flip'],
  regions: ['GTA West'],
  capital: '500k-1m',
  assets: ['multiplex'],
  cadence: 'weekly',
  attestNotAgent: true,
  attestBonaFide: true,
  agreeTerms: true,
};

beforeEach(() => {
  mockGetClient.mockReset();
});

describe('POST /api/onboarding/apply — input handling', () => {
  it('400 when the body is not valid JSON', async () => {
    const res = await post('not-json');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: 'Invalid JSON body' });
  });

  it('happy path inserts the normalized row into terminal_applications', async () => {
    const { client, from, insert } = makeClient();
    mockGetClient.mockReturnValueOnce(client as never);

    const res = await post(VALID_APPLICATION);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    expect(from).toHaveBeenCalledWith('terminal_applications');
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0]).toMatchObject({
      applicant_type: 'investor',
      full_name: 'Jane Smith',
      email: 'jane@example.com',
      entity_name: 'Smith Holdings',
      objectives: ['cashflow', 'flip'],
      regions: ['GTA West'],
      capital: '500k-1m',
      assets: ['multiplex'],
      cadence: 'weekly',
      attest_not_agent: true,
      attest_bona_fide: true,
      agree_terms: true,
    });
  });

  it('coerces missing strings to null and missing arrays to []', async () => {
    const { client, insert } = makeClient();
    mockGetClient.mockReturnValueOnce(client as never);

    await post({}); // empty body
    const row = insert.mock.calls[0][0];
    expect(row.applicant_type).toBeNull();
    expect(row.full_name).toBeNull();
    expect(row.email).toBeNull();
    expect(row.objectives).toEqual([]);
    expect(row.regions).toEqual([]);
    expect(row.assets).toEqual([]);
  });

  it('coerces whitespace-only strings to null', async () => {
    const { client, insert } = makeClient();
    mockGetClient.mockReturnValueOnce(client as never);
    await post({ fullName: '   ', email: 'jane@example.com' });
    const row = insert.mock.calls[0][0];
    expect(row.full_name).toBeNull();
    expect(row.email).toBe('jane@example.com');
  });

  it('coerces a non-array `objectives` to [] (no string-splitting magic)', async () => {
    const { client, insert } = makeClient();
    mockGetClient.mockReturnValueOnce(client as never);
    await post({ objectives: 'cashflow,flip' });
    expect(insert.mock.calls[0][0].objectives).toEqual([]);
  });

  it('coerces truthy non-boolean attestations to true (defensive)', async () => {
    const { client, insert } = makeClient();
    mockGetClient.mockReturnValueOnce(client as never);
    await post({
      attestNotAgent: 'yes',
      attestBonaFide: 1,
      agreeTerms: { value: 'whatever' },
    });
    const row = insert.mock.calls[0][0];
    expect(row.attest_not_agent).toBe(true);
    expect(row.attest_bona_fide).toBe(true);
    expect(row.agree_terms).toBe(true);
  });
});

describe('POST /api/onboarding/apply — error paths', () => {
  it('returns 500 with the supabase error message when insert fails', async () => {
    const { client } = makeClient({ error: { message: 'duplicate key' } });
    mockGetClient.mockReturnValueOnce(client as never);
    const res = await post(VALID_APPLICATION);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('duplicate key');
  });

  it('returns 500 when getServiceRoleClient itself throws', async () => {
    mockGetClient.mockImplementationOnce(() => {
      throw new Error('missing service role key');
    });
    const res = await post(VALID_APPLICATION);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('missing service role key');
  });
});
