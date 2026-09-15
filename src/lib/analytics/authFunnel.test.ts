import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { markSignInStarted, consumeSignInMethod } from '@/lib/analytics/authFunnel';

/** Minimal sessionStorage stand-in — the test runner is `node`, which has none. */
function installStorage() {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
  vi.stubGlobal('window', { sessionStorage: store });
  return map;
}

describe('authFunnel', () => {
  beforeEach(() => installStorage());
  afterEach(() => vi.unstubAllGlobals());

  it('hands the method from the start of a sign-in to its completion', () => {
    markSignInStarted('google');
    expect(consumeSignInMethod()).toBe('google');
  });

  it('yields the method exactly once, so one sign-in cannot be counted twice', () => {
    // onAuthStateChange also fires on token refresh, tab focus and INITIAL_SESSION. If a
    // second read returned the method, a single sign-in would inflate without bound and
    // the funnel's last step would be meaningless.
    markSignInStarted('email');
    expect(consumeSignInMethod()).toBe('email');
    expect(consumeSignInMethod()).toBeNull();
    expect(consumeSignInMethod()).toBeNull();
  });

  it('returns null when no sign-in was started in this tab', () => {
    // A returning user arriving with a live cookie. They are not a new sign-in and must
    // not be counted as one.
    expect(consumeSignInMethod()).toBeNull();
  });

  it('keeps the latest method when an attempt is restarted', () => {
    // Started with email, changed their mind and used Google. The completion belongs to
    // Google — attributing it to email would mis-score both paths at once.
    markSignInStarted('email');
    markSignInStarted('google');
    expect(consumeSignInMethod()).toBe('google');
  });

  it('never throws when storage is unavailable', () => {
    // Private mode, disabled site data, or a locked-down browser. Analytics losing the
    // method is acceptable; analytics throwing into the sign-in path is not.
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('SecurityError: storage is disabled');
      },
    });
    expect(() => markSignInStarted('email')).not.toThrow();
    expect(consumeSignInMethod()).toBeNull();
  });
});
