/**
 * parseMetrics — dev-only, zero-backend telemetry for the NL parser's miss-rate.
 *
 * Records each COMMITTED search (the meaningful "the user actually ran this" moment)
 * with the words the parser couldn't map, into a capped localStorage ring buffer.
 * Read it back any time with:
 *   JSON.parse(localStorage.getItem("pp_search_parses"))
 * and tally with parseMissRate(). No network, no PII beyond the query the user typed.
 * Gated by the caller (LocationSearchV2) on SEARCH_DEBUG so it never runs in prod.
 */

const KEY = "pp_search_parses";
const CAP = 300;

export interface ParseRecord {
  q: string;
  /** Number of chips the parser produced. */
  chips: number;
  /** Words the parser couldn't map ("" when it read everything). */
  unmatched: string;
}

export function recordParse(rec: ParseRecord): void {
  if (rec.unmatched) {
    // eslint-disable-next-line no-console
    console.debug("[search-parse-miss]", JSON.stringify(rec.q), "→ unmatched:", rec.unmatched);
  }
  if (typeof window === "undefined") return;
  try {
    const log: Array<ParseRecord & { at: number }> = JSON.parse(localStorage.getItem(KEY) || "[]");
    log.push({ ...rec, at: Date.now() });
    while (log.length > CAP) log.shift();
    localStorage.setItem(KEY, JSON.stringify(log));
  } catch {
    /* storage disabled / quota exceeded — telemetry is best-effort */
  }
}

/** Session tally for the dev overlay: how many committed searches left words unmatched. */
export function parseMissRate(): { total: number; misses: number } {
  if (typeof window === "undefined") return { total: 0, misses: 0 };
  try {
    const log: ParseRecord[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    return { total: log.length, misses: log.filter((r) => r.unmatched).length };
  } catch {
    return { total: 0, misses: 0 };
  }
}
