/**
 * Sign-in method hand-off across the OAuth redirect.
 *
 * WHY THIS EXISTS. `auth_signed_in` has to fire exactly once per sign-in and carry the
 * method that produced it, and neither is free:
 *
 *  - The EMAIL path establishes the session and then does a full `window.location.assign`
 *    to /welcome. Anything captured in the moment before that navigation races it.
 *  - The GOOGLE path leaves our origin entirely and comes back on a fresh document, so
 *    the component that knew the method is long gone by the time a session exists.
 *  - Supabase's `onAuthStateChange` sees the session on both paths, but it is also fired
 *    by token refreshes, tab focus and INITIAL_SESSION — firing there unguarded turns one
 *    sign-in into an unbounded count and the funnel's last step becomes meaningless.
 *
 * So the method is parked in sessionStorage when a sign-in STARTS and consumed once when
 * a session first appears. Presence of the flag is what makes a session "new" — a returning
 * user with a valid cookie has no flag and correctly fires nothing.
 *
 * sessionStorage, not localStorage: it dies with the tab, so an abandoned attempt cannot
 * attribute a sign-in that happens days later.
 */

const KEY = "pp_signin_method";

/** Record that a sign-in attempt just began. Safe to call repeatedly; last write wins. */
export function markSignInStarted(method: string): void {
  try {
    window.sessionStorage.setItem(KEY, method);
  } catch {
    // Private mode / disabled storage. The funnel loses the method on this browser;
    // the product must not care.
  }
}

/**
 * The method for a sign-in that is completing now, or null when this session was not
 * started in this tab (a returning user, a refreshed token). Clears on read, so the
 * completion can only be counted once.
 */
export function consumeSignInMethod(): string | null {
  try {
    const m = window.sessionStorage.getItem(KEY);
    if (m) window.sessionStorage.removeItem(KEY);
    return m;
  } catch {
    return null;
  }
}
