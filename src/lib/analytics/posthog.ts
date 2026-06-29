/**
 * PostHog analytics — typed event helper.
 *
 * The frontend's behavioural-analytics surface. `posthog-js` is initialised once in
 * `src/components/analytics/PostHogProvider.tsx`; this module wraps the global client
 * with a small, typed API for the "money-moment" events that power our funnels
 * (onboarding, filter usage, the listing calculator, watchlist adds).
 *
 * COMPLIANCE (CLAUDE.md §4): do NOT pass raw IDX/VOW Listing Information — addresses,
 * sold prices, broker remarks — into event properties. Capture *interactions* and
 * coarse, non-identifying parameters (e.g. a price BUCKET, a city slug, a listing id
 * for join-back), never the listing payload itself. Analytics is not an LLM, but the
 * board agreements still restrict where licensed data may flow.
 */

import posthog from 'posthog-js';

/** Public key + host. Empty key ⇒ analytics is a no-op (local dev without a key). */
export const POSTHOG_KEY = (process.env.NEXT_PUBLIC_POSTHOG_KEY || '').trim();
/** Proxied ingest path (see next.config.mjs rewrites). Falls back to US cloud. */
export const POSTHOG_HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST || '/ingest').trim();

/** Whether analytics is configured at all. Used to short-circuit every call. */
export const analyticsEnabled = POSTHOG_KEY.length > 0;

/**
 * Typed event catalogue. Keep this the single source of truth for event names and
 * their property shapes so funnels/dashboards stay stable. Add new events here rather
 * than calling `posthog.capture` with ad-hoc strings.
 */
export type AnalyticsEvents = {
  // Onboarding — the 3-step "Velvet Rope" (CLAUDE.md §3A).
  'onboarding_started': { source?: string };
  'onboarding_step_completed': { step: 1 | 2 | 3; strategy?: string };
  'onboarding_completed': { strategy?: string };

  // Terminal — filter / slider usage on the command center (CLAUDE.md §3B).
  'filter_applied': { filter: string; value?: string | number | boolean };
  'map_metric_changed': { metric: 'yield' | 'dom' | 'price_compression' | string };
  'search_performed': { resultCount?: number };

  // Listing page — the 70/30 financial calculator (CLAUDE.md §3C).
  'listing_viewed': { listingId: string };
  'calculator_adjusted': {
    listingId: string;
    field: 'down_payment' | 'mortgage_rate' | 'amortization' | string;
  };

  // Watchlist / accounts.
  'watchlist_added': { listingId: string };
  'watchlist_removed': { listingId: string };
  'auth_signin_started': { method?: string };
  'auth_signed_in': { method?: string };
};

/** Capture a typed product event. No-ops when analytics is unconfigured. */
export function track<E extends keyof AnalyticsEvents>(
  event: E,
  properties?: AnalyticsEvents[E],
): void {
  if (!analyticsEnabled) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Never let analytics throw into product code.
  }
}

/** Associate the current anonymous session with a known user (call on sign-in). */
export function identifyUser(userId: string, properties?: Record<string, unknown>): void {
  if (!analyticsEnabled || !userId) return;
  try {
    posthog.identify(userId, properties);
  } catch {
    /* swallow */
  }
}

/** Detach the user on sign-out so the next session starts anonymous. */
export function resetUser(): void {
  if (!analyticsEnabled) return;
  try {
    posthog.reset();
  } catch {
    /* swallow */
  }
}
