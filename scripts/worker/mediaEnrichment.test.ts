import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMediaForKeys } from './mediaEnrichment';

// Minimal Response stand-in for the global fetch the helper calls.
type FakeOpts = { ok?: boolean; status?: number };
function fakeResponse(body: unknown, { ok = true, status = 200 }: FakeOpts = {}) {
  return {
    ok,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchMediaForKeys — fetch-failure vs genuine-empty (#2)', () => {
  it('flags keys from a FAILED chunk as failedKeys (not as empty)', async () => {
    // HTTP 400 → fetchWithRetry returns failure immediately (no 5xx retry/sleep).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse('bad request', { ok: false, status: 400 })));
    const { media, failedKeys } = await fetchMediaForKeys(['K1', 'K2'], 'tok');
    expect(media.size).toBe(0);
    expect(failedKeys.has('K1')).toBe(true);
    expect(failedKeys.has('K2')).toBe(true);
  });

  it('a SUCCESSFUL fetch returning zero records → genuine empty (NOT failed)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ value: [] })));
    const { media, failedKeys } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.has('K1')).toBe(false); // absent → caller writes media: []
    expect(failedKeys.has('K1')).toBe(false);
  });

  it('a key that returns media is never flagged failed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        fakeResponse({
          value: [
            {
              ResourceRecordKey: 'K1',
              MediaURL: 'https://cdn/p.jpg',
              MediaObjectID: 'o1',
              ImageSizeDescription: 'Medium',
              Order: 0,
            },
          ],
        })
      )
    );
    const { media, failedKeys } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.get('K1')?.length).toBe(1);
    expect(failedKeys.has('K1')).toBe(false);
  });

  it('no keys → no fetch, empty result', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const { media, failedKeys } = await fetchMediaForKeys([], 'tok');
    expect(media.size).toBe(0);
    expect(failedKeys.size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('fetchMediaForKeys — pagination beyond the 100-record page cap', () => {
  // AMPRE's /Media returns at most 100 records per request and does NOT emit an
  // @odata.nextLink, so the helper must page explicitly with $skip. A mock that
  // honours $top/$skip but never returns a nextLink (faithful to AMPRE) proves
  // the regression: a 25-key OR chunk ordered by ResourceRecordKey whose total
  // media exceeds 100 records silently drops every listing sorted after the cut.
  function pagedFetch(dataset: any[]) {
    return vi.fn().mockImplementation(async (url: string) => {
      const u = new URL(url);
      const top = Number(u.searchParams.get('$top') ?? '100');
      const skip = Number(u.searchParams.get('$skip') ?? '0');
      return fakeResponse({ '@odata.count': dataset.length, value: dataset.slice(skip, skip + top) });
    });
  }

  it('recovers a key whose records fall AFTER the first 100-record page', async () => {
    // K1 has 100 Medium photos, K2 has 50 — ordered K1… then K2…, total 150.
    // K2 begins at record index 100, i.e. entirely on page 2 ($skip=100).
    const dataset: any[] = [];
    for (let i = 0; i < 100; i++)
      dataset.push({ ResourceRecordKey: 'K1', MediaURL: `https://cdn/k1-${i}.jpg`, MediaObjectID: `k1o${i}`, ImageSizeDescription: 'Medium', Order: i });
    for (let i = 0; i < 50; i++)
      dataset.push({ ResourceRecordKey: 'K2', MediaURL: `https://cdn/k2-${i}.jpg`, MediaObjectID: `k2o${i}`, ImageSizeDescription: 'Medium', Order: i });

    vi.stubGlobal('fetch', pagedFetch(dataset));
    const { media, failedKeys } = await fetchMediaForKeys(['K1', 'K2'], 'tok');

    expect(media.get('K1')?.length).toBe(100);
    expect(media.get('K2')?.length).toBe(50); // dropped entirely before the $skip fix
    expect(failedKeys.size).toBe(0);
  });
});
