/**
 * Search-health alert policy — pure, deterministic. Decides when browser-reported
 * Typesense search failures stop being "one bad connection" and become an ACTIONABLE
 * problem worth an ops email (owner decision 2026-07-20).
 *
 * Actionable means SUSTAINED or WIDESPREAD, not a blip:
 *   - burst:  ≥ BURST_MIN failures in the last hour across ≥ BURST_MIN_SESSIONS
 *             distinct browser sessions (two sessions rules out one user's Wi-Fi), OR
 *   - grind:  ≥ GRIND_MIN failures in the last 24h (slow drip that adds up).
 * A COOLDOWN suppresses repeat emails while the same episode is ongoing.
 */

export const BURST_WINDOW_MS = 60 * 60 * 1000;
export const BURST_MIN = 12;
export const BURST_MIN_SESSIONS = 2;
export const GRIND_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GRIND_MIN = 40;
export const ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export interface SearchHealthSnapshot {
  /** Failure events in the last hour. */
  hourCount: number;
  /** Distinct session_ids among the last hour's failures. */
  hourSessions: number;
  /** Failure events in the last 24h. */
  dayCount: number;
  /** When the last alert email was sent (epoch ms), or null if never. */
  lastAlertAtMs: number | null;
  nowMs: number;
}

export interface SearchHealthDecision {
  alert: boolean;
  /** Which rule tripped — goes into the email subject. */
  reason?: 'burst' | 'grind';
}

export function evaluateSearchHealth(s: SearchHealthSnapshot): SearchHealthDecision {
  if (s.lastAlertAtMs !== null && s.nowMs - s.lastAlertAtMs < ALERT_COOLDOWN_MS) {
    return { alert: false };
  }
  if (s.hourCount >= BURST_MIN && s.hourSessions >= BURST_MIN_SESSIONS) {
    return { alert: true, reason: 'burst' };
  }
  if (s.dayCount >= GRIND_MIN) {
    return { alert: true, reason: 'grind' };
  }
  return { alert: false };
}

/** Failure kinds the beacon may report (anything else is rejected at the route). */
export const REPORTABLE_KINDS = ['timeout', 'network', 'http_error'] as const;
export type ReportableKind = (typeof REPORTABLE_KINDS)[number];

/**
 * Crawlers and headless renderers that run the page's JS. They abort third-party requests
 * after a few seconds, so a crawl of listing pages reports one fast "Network Error" per
 * page, each from a fresh session (2026-10-25: 129 listing pages in 13h tripped the burst
 * rule while the cluster was healthy). Their failures say nothing about real users.
 */
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|inspectiontool|mediapartners|facebookexternalhit|bingpreview|python|curl|wget|httpclient|phantomjs|puppeteer|playwright/i;

/** True when a request's User-Agent is a crawler/headless client — or is missing. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return true;
  return BOT_UA.test(ua);
}

/** Classify a caught search error into a reportable kind. */
export function classifySearchError(err: unknown): ReportableKind {
  const msg = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase();
  if (msg.includes('timeout') || msg.includes('econnaborted') || msg.includes('aborted')) return 'timeout';
  if (
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('econnre')
  ) {
    return 'network';
  }
  return 'http_error';
}
