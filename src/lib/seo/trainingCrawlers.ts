/**
 * Bulk AI-TRAINING crawlers (not the AI search agents). Shared by robots.ts (Crawl-delay)
 * and middleware.ts (shed on the Typesense-heavy pages). Pure and Edge-safe.
 *
 * 2026-11-24: ClaudeBot made 269K requests in 12 hours (GPTBot 45K, meta-webindexer 32K),
 * mostly to /address/... Each anonymous render ran 6-8 Typesense searches; the cluster ran
 * out of burst CPU and search took ~1 s (later 13 s on /health) for real users. A robots.txt
 * change takes up to a day to reach a crawler, so the middleware sheds them at once.
 *
 * The AI search/assistant agents (Claude-SearchBot, Claude-User, OAI-SearchBot,
 * ChatGPT-User, PerplexityBot) are NOT here: they fetch pages to cite them in answers.
 */
export const SLOWED_CRAWLERS = ["ClaudeBot", "GPTBot", "meta-webindexer", "meta-externalagent"];

const UA_RE = new RegExp(`\\b(${SLOWED_CRAWLERS.join("|")})\\b`, "i");

/** Pages whose every render runs Typesense searches: the sold/off-market address tree and
 *  the listing detail pages (/properties/{id}, /property/{prov}/{city}/{slug}). */
const HEAVY_RE = /^\/(address\/|properties\/[^/]+\/?$|property\/[^/]+\/[^/]+\/[^/]+\/?$)/;

/** Seconds a shed crawler is told to wait (Retry-After). */
export const SHED_RETRY_AFTER_S = 3600;

export function isTrainingCrawler(userAgent: string | null | undefined): boolean {
  return !!userAgent && UA_RE.test(userAgent);
}

/** True when this request should get a 503 + Retry-After instead of a render. */
export function shouldShedCrawler(pathname: string, userAgent: string | null | undefined): boolean {
  return HEAVY_RE.test(pathname) && isTrainingCrawler(userAgent);
}
