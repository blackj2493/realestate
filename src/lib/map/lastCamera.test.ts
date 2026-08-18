import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readLastCamera, writeLastCamera } from './lastCamera';

/**
 * vitest runs `environment: 'node'`, so there is no window. These install a minimal
 * localStorage on globalThis — enough to exercise the read/write/validate contract,
 * which is the part that decides whether the map opens somewhere sane.
 */
function installStorage(seed?: string) {
  const store = new Map<string, string>();
  if (seed !== undefined) store.set('pp_terminal_camera', seed);
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  return store;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('readLastCamera', () => {
  beforeEach(() => installStorage());

  it('returns null when nothing is stored', () => {
    expect(readLastCamera()).toBeNull();
  });

  it('round-trips a real camera', () => {
    writeLastCamera({ lat: 43.8361, lng: -79.5083, zoom: 12 });
    expect(readLastCamera()).toEqual({ lat: 43.8361, lng: -79.5083, zoom: 12 });
  });

  it('rejects 0,0 — the shape a half-initialised camera takes', () => {
    // Passes a naive isFinite check and lands in the Gulf of Guinea, which reads as a
    // broken app rather than a missing value. Must fall back to INITIAL_VIEW_STATE.
    installStorage(JSON.stringify({ lat: 0, lng: 0, zoom: 10 }));
    expect(readLastCamera()).toBeNull();
  });

  it('rejects out-of-range coordinates', () => {
    installStorage(JSON.stringify({ lat: 91, lng: -79, zoom: 10 }));
    expect(readLastCamera()).toBeNull();
    installStorage(JSON.stringify({ lat: 43, lng: 181, zoom: 10 }));
    expect(readLastCamera()).toBeNull();
  });

  it('rejects a zoom deck.gl would render as a blank tile', () => {
    installStorage(JSON.stringify({ lat: 43.65, lng: -79.38, zoom: 40 }));
    expect(readLastCamera()).toBeNull();
    installStorage(JSON.stringify({ lat: 43.65, lng: -79.38, zoom: 0 }));
    expect(readLastCamera()).toBeNull();
  });

  it('rejects malformed JSON rather than throwing', () => {
    installStorage('{not json');
    expect(readLastCamera()).toBeNull();
  });

  it('rejects a partial object', () => {
    installStorage(JSON.stringify({ lat: 43.65, lng: -79.38 }));
    expect(readLastCamera()).toBeNull();
  });

  it('is SSR-safe — no window, no throw', () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    expect(readLastCamera()).toBeNull();
    expect(() => writeLastCamera({ lat: 43.65, lng: -79.38, zoom: 11 })).not.toThrow();
  });
});

describe('writeLastCamera', () => {
  it('never persists a value read back as null — no silent bad restore', () => {
    installStorage();
    writeLastCamera({ lat: 0, lng: 0, zoom: 10 });
    expect(readLastCamera()).toBeNull();
  });

  it('survives a storage failure (private mode / quota)', () => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('QuotaExceededError'); },
      },
    };
    // This runs on every pan; a throw here would surface while dragging the map.
    expect(() => writeLastCamera({ lat: 43.65, lng: -79.38, zoom: 11 })).not.toThrow();
  });
});
