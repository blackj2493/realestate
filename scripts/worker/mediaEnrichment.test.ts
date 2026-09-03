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
      // The cover-thumb pass rides the same chunk loop but is NOT part of the
      // size-variant ladder, so it must not show up in the ladder these tests
      // assert on. It is the request that bounds Order — nothing else does.
      const orderCap = /Order lt (\d+)/.exec(filter)?.[1];
      if (!orderCap) onSize?.(size);
      const keys = [...filter.matchAll(/ResourceRecordKey eq '([^']+)'/g)].map((m) => m[1]);
      const rows = dataset.filter(
        (r) =>
          r.ImageSizeDescription === size &&
          keys.includes(r.ResourceRecordKey) &&
          (orderCap === undefined || (r.Order ?? Infinity) < Number(orderCap))
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
        // Ignore the cover-thumb request (the only one that bounds Order): it is
        // a separate, best-effort pass, not a rung on the fallback ladder this
        // test guards. It fires for every chunk by design, failure included.
        if (!/Order lt \d+/.test(filter)) {
          sizes.push(/ImageSizeDescription eq '([^']+)'/.exec(filter)?.[1] ?? '');
        }
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

describe('fetchMediaForKeys — cover thumb (the 240px card image)', () => {
  /**
   * The ledger card is 144x112 but renders `primaryImageUrl`, the 960x960 'Medium'
   * variant — a median 155 KB, and the LCP element on /properties. The size is inside
   * the imgproxy signature so the URL cannot be shrunk; the small image only exists as
   * a separate 'Thumbnail' URL. These tests pin the three properties that make fetching
   * it safe to run inside the daily sync.
   */
  function coverFetch(rows: any[], opts: { thumbFails?: boolean } = {}) {
    return vi.fn().mockImplementation(async (url: string) => {
      const filter = decodeURIComponent(new URL(url).searchParams.get('$filter') ?? '');
      const isThumbPass = /Order lt \d+/.test(filter);
      if (isThumbPass && opts.thumbFails) {
        // 400, not 500: fetchWithRetry backs off on 5xx and would outrun the timeout.
        return fakeResponse('boom', { ok: false, status: 400 });
      }
      const size = /ImageSizeDescription eq '([^']+)'/.exec(filter)?.[1] ?? '';
      const cap = /Order lt (\d+)/.exec(filter)?.[1];
      return fakeResponse({
        value: rows.filter(
          (r) =>
            r.ImageSizeDescription === size &&
            (cap === undefined || (r.Order ?? Infinity) < Number(cap))
        ),
      });
    });
  }

  const rec = (size: string, order: number, id = `${size}-${order}`) => ({
    ResourceRecordKey: 'K1',
    MediaURL: `https://cdn/K1-${size}-${order}.jpg`,
    MediaObjectID: id,
    ImageSizeDescription: size,
    Order: order,
  });

  it('returns the LOWEST-Order Thumbnail as the cover, not whichever arrived first', async () => {
    // AMPRE returns several rows inside the Order window; the cover is the one
    // selectPrimaryImage would pick, which is the lowest Order.
    vi.stubGlobal(
      'fetch',
      coverFetch([rec('Medium', 0), rec('Thumbnail', 1), rec('Thumbnail', 0)])
    );

    const { thumbs } = await fetchMediaForKeys(['K1'], 'tok');
    expect(thumbs.get('K1')).toBe('https://cdn/K1-Thumbnail-0.jpg');
  });

  it('keeps the Thumbnail OUT of the media array, so the gallery never shows a 240px photo', async () => {
    // media[] feeds collectMediaUrls → media_urls → the gallery. A Thumbnail leaking
    // in would show the cover twice, the second time at a quarter of the resolution.
    vi.stubGlobal(
      'fetch',
      coverFetch([rec('Medium', 0), rec('Medium', 1), rec('Thumbnail', 0)])
    );

    const { media, thumbs } = await fetchMediaForKeys(['K1'], 'tok');
    const urls = (media.get('K1') ?? []).map((m) => m.MediaURL);
    expect(urls).toEqual(['https://cdn/K1-Medium-0.jpg', 'https://cdn/K1-Medium-1.jpg']);
    expect(urls).not.toContain(thumbs.get('K1'));
  });

  it('a failed thumb pass costs bytes, never correctness — media survives and the key is not failed', async () => {
    // The whole point of a separate pass: no thumb means the card falls back to
    // primaryImageUrl. Marking the key failed would instead strand a listing that
    // has perfectly good photos.
    vi.stubGlobal('fetch', coverFetch([rec('Medium', 0)], { thumbFails: true }));

    const { media, failedKeys, thumbs } = await fetchMediaForKeys(['K1'], 'tok');
    expect(media.get('K1')?.length).toBe(1);
    expect(failedKeys.has('K1')).toBe(false);
    expect(thumbs.has('K1')).toBe(false);
  });
});

describe('fetchCoverThumbs — $skip paging (the 5,901-document truncation)', () => {
  /**
   * AMPRE caps every /Media response at 100 records and sends no nextLink. The Order
   * window does not make one page enough: ~7 rows per listing satisfy `Order lt 2`
   * (AMPRE repeats an Order across MediaObjectIDs), so a 25-key chunk clears the cap.
   * Rows come back ordered by ResourceRecordKey, so truncation drops whole listings off
   * the TAIL — and a short read is indistinguishable from "no thumbnail exists".
   *
   * The first version of this pass did not page, and left 5,901 of 97,491 documents
   * without a thumb. This pins the fix: the LAST key in an over-long chunk must resolve.
   */
  it('resolves the last listing in a chunk whose rows overflow one page', async () => {
    const keys = Array.from({ length: 25 }, (_, i) => `K${String(i).padStart(2, '0')}`);
    // 7 qualifying rows each = 175 rows across 25 keys → two pages.
    const all = keys.flatMap((k) =>
      Array.from({ length: 7 }, (_, j) => ({
        ResourceRecordKey: k,
        MediaURL: `https://cdn/${k}-thumb-${j}.jpg`,
        ImageSizeDescription: 'Thumbnail',
        Order: j === 0 ? 0 : 1,
      }))
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url);
        const skip = Number(u.searchParams.get('$skip') ?? 0);
        const top = Number(u.searchParams.get('$top') ?? 100);
        return fakeResponse({ value: all.slice(skip, skip + top) });
      })
    );

    const { thumbs } = await fetchMediaForKeys(keys, 'tok');
    // Every key, not just the ones that fit on page one.
    expect(thumbs.size).toBe(25);
    expect(thumbs.get('K24')).toBe('https://cdn/K24-thumb-0.jpg');
    // Still the lowest Order, not merely the last row seen.
    expect(thumbs.get('K00')).toBe('https://cdn/K00-thumb-0.jpg');
  });
});
