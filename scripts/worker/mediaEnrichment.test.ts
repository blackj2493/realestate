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
