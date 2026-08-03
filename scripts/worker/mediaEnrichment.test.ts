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

describe('fetchMediaForKeys — size-variant fallback', () => {
  /** Serves records filtered by the ImageSizeDescription pinned in the $filter. */
  function sizeAwareFetch(dataset: any[], onSize?: (size: string) => void) {
    return vi.fn().mockImplementation(async (url: string) => {
      const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
      const size = /ImageSizeDescription eq '([^']+)'/.exec(filter)?.[1] ?? '';
      onSize?.(size);
      const keys = [...filter.matchAll(/ResourceRecordKey eq '([^']+)'/g)].map((m) => m[1]);
      const rows = dataset.filter(
        (r) => r.ImageSizeDescription === size && keys.includes(r.ResourceRecordKey)
      );
      return fakeResponse({ value: rows });
    });
  }

  const photo = (key: string, size: string, i: number) => ({
    ResourceRecordKey: key,
    MediaURL: `https://cdn/${key}-${size}-${i}.jpg`,
    MediaObjectID: `${key}-${size}-${i}`,
    ImageSizeDescription: size,
    Order: i,
  });

  it('falls back to Large when a listing has no Medium variant', async () => {
    // The permanent false-empty: AMPRE has photos, just not at Medium.
    const dataset = [photo('K1', 'Large', 0), photo('K1', 'Large', 1)];
    vi.stubGlobal('fetch', sizeAwareFetch(dataset));

    const { media, failedKeys } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.get('K1')?.length).toBe(2);
    expect(media.get('K1')?.[0].MediaURL).toBe('https://cdn/K1-Large-0.jpg');
    expect(failedKeys.size).toBe(0);
  });

  it('walks Medium → Large → Largest → Thumbnail and stops at the first hit', async () => {
    const sizes: string[] = [];
    const dataset = [photo('K1', 'Largest', 0)];
    vi.stubGlobal('fetch', sizeAwareFetch(dataset, (s) => sizes.push(s)));

    const { media } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.get('K1')?.length).toBe(1);
    // Tried Medium, then Large, then Largest — and stopped: no Thumbnail request.
    expect(sizes).toEqual(['Medium', 'Large', 'Largest']);
  });

  it('never mixes sizes for one listing (no duplicate photos in media_urls)', async () => {
    // K1 has BOTH Medium and Large variants of the same 2 photos. Asking for every
    // size at once would list each photo twice — the Medium pass must win outright.
    const dataset = [
      photo('K1', 'Medium', 0),
      photo('K1', 'Medium', 1),
      photo('K1', 'Large', 0),
      photo('K1', 'Large', 1),
    ];
    const sizes: string[] = [];
    vi.stubGlobal('fetch', sizeAwareFetch(dataset, (s) => sizes.push(s)));

    const { media } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.get('K1')?.length).toBe(2);
    expect(media.get('K1')?.every((m) => m.MediaURL.includes('Medium'))).toBe(true);
    expect(sizes).toEqual(['Medium']); // no fallback request at all
  });

  it('only re-probes the keys that came back empty', async () => {
    // K1 has Medium, K2 only has Large. The fallback must carry K2 alone.
    const dataset = [photo('K1', 'Medium', 0), photo('K2', 'Large', 0)];
    const perSizeKeys: Record<string, string[]> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
        const size = /ImageSizeDescription eq '([^']+)'/.exec(filter)?.[1] ?? '';
        const keys = [...filter.matchAll(/ResourceRecordKey eq '([^']+)'/g)].map((m) => m[1]);
        perSizeKeys[size] = keys;
        return fakeResponse({
          value: dataset.filter(
            (r) => r.ImageSizeDescription === size && keys.includes(r.ResourceRecordKey)
          ),
        });
      })
    );

    const { media } = await fetchMediaForKeys(['K1', 'K2'], 'tok');
    expect(media.get('K1')?.length).toBe(1);
    expect(media.get('K2')?.length).toBe(1);
    expect(perSizeKeys.Medium).toEqual(['K1', 'K2']);
    expect(perSizeKeys.Large).toEqual(['K2']); // K1 is settled, not re-probed
  });

  it('does NOT run the fallback for a key whose primary fetch failed', async () => {
    // A failed fetch means "unknown", not "empty" — re-probing it at another size
    // during an outage just burns requests and can manufacture a false-empty.
    const sizes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
        sizes.push(/ImageSizeDescription eq '([^']+)'/.exec(filter)?.[1] ?? '');
        return fakeResponse('bad request', { ok: false, status: 400 });
      })
    );

    const { media, failedKeys } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.size).toBe(0);
    expect(failedKeys.has('K1')).toBe(true);
    expect(sizes).toEqual(['Medium']);
  });

  it('never requests LargestNoWatermark (§6.3(c))', async () => {
    const sizes: string[] = [];
    vi.stubGlobal('fetch', sizeAwareFetch([], (s) => sizes.push(s)));

    await fetchMediaForKeys(['K1'], 'tok');
    expect(sizes).toEqual(['Medium', 'Large', 'Largest', 'Thumbnail']);
    expect(sizes).not.toContain('LargestNoWatermark');
  });
});
