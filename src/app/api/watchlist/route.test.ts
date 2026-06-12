import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { GET, POST, DELETE } from './route';

const mockCreate = vi.mocked(createSupabaseServerClient);

/**
 * Returns a chainable mock Supabase client that mirrors the small subset of
 * the SDK the watchlist route actually uses.
 */
function makeClient(opts: {
  user: { id: string } | null;
  selectResult?: { data: unknown[] | null; error: unknown };
  upsertResult?: { error: unknown };
  deleteResult?: { error: unknown };
}) {
  const upsert = vi.fn().mockResolvedValue(opts.upsertResult ?? { error: null });
  const order = vi
    .fn()
    .mockResolvedValue(opts.selectResult ?? { data: [], error: null });
  const select = vi.fn(() => ({ order }));
  const deleteInnerEq = vi
    .fn()
    .mockResolvedValue(opts.deleteResult ?? { error: null });
  const deleteOuterEq = vi.fn(() => ({ eq: deleteInnerEq }));
  const del = vi.fn(() => ({ eq: deleteOuterEq }));
  const from = vi.fn(() => ({ select, upsert, delete: del }));

  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user } }) },
      from,
    },
    spies: { from, select, order, upsert, del, deleteOuterEq, deleteInnerEq },
  };
}

function req(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe('GET /api/watchlist', () => {
  it('401 when not signed in (anonymous = empty items)', async () => {
    const { client } = makeClient({ user: null });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ items: [], error: "unauthenticated" });
  });

  it('returns the user\'s rows mapped to the public WatchItem shape', async () => {
    const { client, spies } = makeClient({
      user: { id: 'user-1' },
      selectResult: {
        data: [
          {
            listing_key: 'W123',
            address: '40 Rampart Dr',
            city: 'Brampton',
            thumb: null,
            list_price: 800_000,
            last_known_status: 'Active',
            created_at: '2025-01-01',
          },
        ],
        error: null,
      },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(spies.from).toHaveBeenCalledWith('watchlist');
    expect(spies.order).toHaveBeenCalledWith('created_at', { ascending: false });
    const body = await res.json();
    expect(body.items[0]).toEqual({
      listing_key: 'W123',
      address: '40 Rampart Dr',
      city: 'Brampton',
      list_price: 800_000,
      status: 'Active',
    });
  });

  it('500 with the supabase error message when select fails', async () => {
    const { client } = makeClient({
      user: { id: 'user-1' },
      selectResult: { data: null, error: { message: 'rls denied' } },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('rls denied');
  });
});

describe('POST /api/watchlist', () => {
  it('401 when not signed in', async () => {
    const { client } = makeClient({ user: null });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await POST(req('http://x/api/watchlist', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('400 when listing_key is missing / blank', async () => {
    const { client } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await POST(
      req('http://x/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ listing_key: '   ' }),
      })
    );
    expect(res.status).toBe(400);
  });

  it('400 when the body is invalid JSON', async () => {
    const { client } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await POST(
      req('http://x/api/watchlist', { method: 'POST', body: 'not-json' })
    );
    expect(res.status).toBe(400);
  });

  it('upserts with user_id + onConflict on the happy path', async () => {
    const { client, spies } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await POST(
      req('http://x/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({
          listing_key: 'W123',
          address: '40 Rampart Dr',
          city: 'Brampton',
          list_price: 800_000,
          status: 'Active',
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(spies.upsert).toHaveBeenCalledTimes(1);
    const [row, options] = spies.upsert.mock.calls[0];
    expect(row).toMatchObject({
      user_id: 'user-1',
      listing_key: 'W123',
      address: '40 Rampart Dr',
      city: 'Brampton',
      list_price: 800_000,
      last_known_status: 'Active',
    });
    expect(options).toEqual({ onConflict: 'user_id,listing_key' });
  });

  it('coerces a non-numeric list_price to null', async () => {
    const { client, spies } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    await POST(
      req('http://x/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ listing_key: 'W123', list_price: 'abc' }),
      })
    );
    expect(spies.upsert.mock.calls[0][0].list_price).toBeNull();
  });
});

describe('DELETE /api/watchlist', () => {
  it('401 when not signed in', async () => {
    const { client } = makeClient({ user: null });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await DELETE(
      req('http://x/api/watchlist?listing_key=W123', { method: 'DELETE' })
    );
    expect(res.status).toBe(401);
  });

  it('400 when listing_key is missing', async () => {
    const { client } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await DELETE(req('http://x/api/watchlist', { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });

  it('scopes the delete by both user_id AND listing_key (defense in depth vs. RLS)', async () => {
    const { client, spies } = makeClient({ user: { id: 'user-1' } });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await DELETE(
      req('http://x/api/watchlist?listing_key=W123', { method: 'DELETE' })
    );
    expect(res.status).toBe(200);
    expect(spies.deleteOuterEq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(spies.deleteInnerEq).toHaveBeenCalledWith('listing_key', 'W123');
  });
});
