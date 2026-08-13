/**
 * distressSignals — decide whether a listing carries a real distress signal.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The previous rule (transformer.ts `calculateDerivedMetrics`) was a six-word regex plus two
 * non-text branches, and it flagged 13,976 of 73,550 actives — 19% of the market — as
 * DISTRESSED. Measured 2026-08-12, by listing age:
 *
 *     0-30d  5.4%  |  30-90d  6.8%  |  90-180d  47.2%  |  180-365d  99.6%  |  365d+  99.8%
 *
 * In the oldest bucket only 8.5% contained any keyword, so the flag was overwhelmingly driven
 * by its `calculatedDOM > 90` branch: DISTRESSED had become an AGE badge. Three defects
 * followed, and this module exists to fix all three:
 *
 *  1. CATEGORY ERROR. One red word covered a seller under legal pressure, a property needing
 *     work, and a listing that had merely been sitting. Those warrant different reactions, so
 *     they are detected separately here (forcedSale / needsWork) and reported separately.
 *
 *  2. THE ACCURATE BADGE WAS SUPPRESSED. `IsStale` uses the SAME 90-day threshold, and
 *     getAlphaFlag ranks DISTRESSED above STALE — so on 12,291 listings a correct amber STALE
 *     was hidden behind an incorrect red DISTRESSED. Time-on-market is therefore NOT a distress
 *     signal here; it is STALE's job, computed from the same data and already honest about it.
 *     Price cuts are likewise left to `TotalPriceDrop` and the price_drop dashboard board.
 *
 *  3. WORD-BOUNDARY FALSE POSITIVES. Bare `estate` matched "real estate" (present in 2.3% of
 *     older listings) and bare `contractor` matched ordinary renovation talk. Reported on
 *     C13649002 (17 Squirewood Road) — a well-kept bungalow flagged DISTRESSED.
 *
 * WHAT IS DELIBERATELY NOT A SIGNAL
 *  • "as-is" / "as-is, where-is" — a warranty disclaimer about what the seller will stand
 *    behind (often just the appliances), not a claim about motivation or condition. It is the
 *    single phrase that flagged 17 Squirewood. It belongs as a CORROBORATING vector alongside
 *    a real signal, not as a trigger on its own.
 *  • "Schedule B/C" — a standard TRREB attachment reference, not a distress convention.
 *  • "motivated seller" / "must sell" / "priced to sell" — agent puffery written to create
 *    urgency. Not a fact about the seller's position.
 *  • Bare "contractor" / "renovator" — these need their "special"/"dream" partner to mean
 *    anything; alone they usually describe work already done.
 *
 * Both callers (the ETL transformer and scripts/admin/recompute-distress-flag.ts) import THIS
 * function. The rule must never be re-implemented at a call site: the nightly sync only
 * re-transforms the ModificationTimestamp delta, so a rule that exists in two places would
 * leave most of the index frozen on whichever copy last touched it.
 */

/** A named pattern, so a match can explain itself rather than just flipping a boolean. */
interface Signal {
  label: string;
  pattern: RegExp;
}

/** Seller is under legal or financial pressure — the genuinely rare, genuinely valuable case. */
const FORCED_SALE: Signal[] = [
  { label: "Power of Sale", pattern: /\bpower\s+of\s+sale\b/ },
  { label: "Foreclosure", pattern: /\bforeclos(ure|ed|ing)\b/ },
  { label: "Bank Owned", pattern: /\bbank[\s-]?owned\b/ },
  { label: "Court-Ordered Sale", pattern: /\bcourt[\s-]?ordered\b/ },
  // "receiver" alone is a home-theatre component in an inclusions list; only the legal
  // noun form counts.
  { label: "Receivership", pattern: /\breceivership\b/ },
  { label: "Probate", pattern: /\bprobate\b/ },
  { label: "Estate Sale", pattern: /\bestate\s+sale\b/ },
  { label: "Estate Sale", pattern: /\bsale\s+of\s+(the\s+)?estate\b/ },
  { label: "Estate Sale", pattern: /\bestate\s+of\s+the\s+late\b/ },
  { label: "Estate Sale", pattern: /\bexecutor('?s)?\b/ },
];

/** The property itself needs substantial work — a different claim, and a different buyer. */
const NEEDS_WORK: Signal[] = [
  { label: "Handyman Special", pattern: /\bhandy\s?m(a|e)n('?s)?\b/ },
  { label: "Fixer-Upper", pattern: /\bfixer[\s-]?upper\b/ },
  { label: "Contractor Special", pattern: /\bcontractor('?s)?\s+(special|dream|delight)\b/ },
  { label: "Renovator Special", pattern: /\brenovator('?s)?\s+(special|dream|delight)\b/ },
  { label: "Needs Work", pattern: /\bneeds?\s+(work|updating|renovating|renovation|tlc|repairs?)\b/ },
  { label: "Needs Work", pattern: /\btlc\b/ },
  { label: "Teardown", pattern: /\btear[\s-]?down\b/ },
  { label: "Teardown", pattern: /\bdemolition\b/ },
  { label: "Gut Renovation", pattern: /\bgut\s+(reno\w*|job)\b/ },
  { label: "Value in the Land", pattern: /\bvalue\s+(is\s+)?in\s+(the\s+)?land\b/ },
];

export interface DistressSignals {
  /** The indexed boolean: either kind of real signal is present. */
  isDistressed: boolean;
  /** Seller under legal/financial pressure (power of sale, probate, estate sale, …). */
  forcedSale: boolean;
  /** Property needs substantial work (TLC, handyman, teardown, …). */
  needsWork: boolean;
  /** Distinct labels that matched, most-severe kind first. Auditable, and the seed for the
   *  two-badge split (FORCED SALE / NEEDS WORK) that supersedes the single red word. */
  matched: string[];
}

const EMPTY: DistressSignals = { isDistressed: false, forcedSale: false, needsWork: false, matched: [] };

function collect(text: string, signals: Signal[]): string[] {
  const hits: string[] = [];
  for (const { label, pattern } of signals) {
    // Patterns are non-global on purpose: `.test()` on a /g regex advances lastIndex and
    // returns alternating results across calls.
    if (pattern.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

/**
 * Detect distress signals in a listing's public remarks.
 *
 * Time on market and price history are NOT inputs — see the header for why.
 */
export function detectDistress(publicRemarks: string | null | undefined): DistressSignals {
  if (typeof publicRemarks !== "string" || publicRemarks.trim() === "") return { ...EMPTY };

  // Remove "real estate" before anything reads the word "estate". This one substitution
  // retires the dominant false positive of the old rule; every estate pattern below can then
  // match plainly without each needing its own lookbehind.
  const text = publicRemarks.toLowerCase().replace(/\breal\s+estate\b/g, " ");

  const forced = collect(text, FORCED_SALE);
  const work = collect(text, NEEDS_WORK);

  return {
    isDistressed: forced.length > 0 || work.length > 0,
    forcedSale: forced.length > 0,
    needsWork: work.length > 0,
    matched: [...forced, ...work],
  };
}
