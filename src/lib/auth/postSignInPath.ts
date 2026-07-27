/**
 * Where to send a user immediately after a successful sign-in.
 *
 * We ALWAYS funnel through /welcome, the one-time VOW Terms acceptance gate. It is
 * idempotent: a user who has already accepted the current Terms (or when
 * VOW_ENFORCE_TERMS is off) is redirected straight on to `next`, while a first-time
 * consumer is asked to accept before landing on `next`.
 *
 * This closes the gap where signing in from a SOFT-gated surface — e.g. a listing
 * page's blurred Deal Score / AVM teaser, which links to /login?next=<that listing> —
 * returned the user to that page WITHOUT ever routing them through /welcome. Only the
 * hard gates (/dashboard, /analytics, requireConsumer APIs) push to /welcome, so such
 * users never accepted Terms, `isConsumer` stayed false, and the VOW cards stayed
 * locked indefinitely even though they were signed in.
 *
 * When there is NO destination we deliberately emit a BARE `/welcome` rather than
 * defaulting to `?next=/dashboard`. That preserves the distinction between "the user
 * had a specific destination" and "the user just signed in", which is the signal
 * /welcome uses to route a first-ever account into the map terminal instead of an
 * empty dashboard. Collapsing the two here would make every signup look intentional.
 *
 * The returned value is a relative path, safe for both client navigation
 * (window.location.assign) and server redirects (`${origin}${path}`).
 */
export function postSignInPath(next: string | null | undefined): string {
  // Open-redirect guard: only honor relative, single-slash paths. Anything else
  // (absent, absolute, protocol-relative) counts as "no destination".
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  if (!dest) return "/welcome";
  // Already pointed at /welcome? Don't double-wrap (avoids a self-referential next loop).
  if (dest === "/welcome" || dest.startsWith("/welcome?") || dest.startsWith("/welcome/")) {
    return dest;
  }
  return `/welcome?next=${encodeURIComponent(dest)}`;
}
