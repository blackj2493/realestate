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

  // The Read — synthesized-verdict interactions (persona lens + "show me the evidence").
  'read_persona_switched': { listingId: string; persona: string };
  'read_evidence_clicked': { listingId: string; target: string };

  // Things to Know — the "worth asking" question sheet copied to the clipboard.
  'diligence_questions_copied': { listingId: string; count: number };

  // Watchlist / accounts.
  'watchlist_added': { listingId: string };
  'watchlist_removed': { listingId: string };

  // ── Signup funnel ────────────────────────────────────────────────────────────
  // Every step of the Velvet Rope, so a drop-off between two adjacent steps is a
  // number instead of a guess. Wired 2026-09-15: the two `auth_*` events below had
  // been DEFINED since this catalogue was written and were never once fired, which is
  // why "150 visitors, 0 signups" could not be narrowed past "something is wrong".
  //
  // The funnel, in order:
  //   auth_gate_viewed → auth_signin_started → auth_otp_sent → auth_signed_in
  //   → auth_terms_viewed → auth_signup_completed
  //
  // Google skips auth_otp_sent by design — comparing the two paths is half the point.
  /** Someone hit a locked VOW surface. Top of the funnel: every signup starts here. */
  'auth_gate_viewed': { surface: string; state: 'anonymous' | 'terms_pending' };
  'auth_signin_started': { method?: string };
  /** A one-time code was emailed. Never fires for OAuth. */
  'auth_otp_sent': { resend: boolean };
  /** `send` = could not email a code; `verify` = the code was wrong or expired. */
  'auth_otp_failed': { stage: 'send' | 'verify' };
  'auth_signed_in': { method?: string };
  /** The Terms screen rendered. Four required fields sit between here and completion. */
  'auth_terms_viewed': { firstRun: boolean };
  /** Submitted Terms with something missing — says WHICH gate turned them back. */
  'auth_terms_blocked': { reason: 'missing_confirmation' | 'missing_market' };
  /** Terms accepted and a market chosen. The account is now real and reachable. */
  'auth_signup_completed': { market: string };

  // Installable app (src/lib/pwa). `platform` is where the install would land;
  // `source` is which surface asked. Every event also carries the `pp_display_mode`
  // super property (standalone vs browser) set by ServiceWorkerRegister.
  'pwa_install_prompted': { platform: string; source: 'nudge' | 'menu' };
  'pwa_install_outcome': {
    platform: string;
    source: 'nudge' | 'menu';
    outcome: 'accepted' | 'dismissed' | 'snoozed';
  };
  'pwa_installed': { platform: string };
  'pwa_update_applied': { version?: string };
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

/** Attach properties to every later event from this browser (PostHog "super properties"). */
export function registerProperties(properties: Record<string, string | number | boolean>): void {
  if (!analyticsEnabled) return;
  try {
    posthog.register(properties);
  } catch {
    /* swallow */
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
