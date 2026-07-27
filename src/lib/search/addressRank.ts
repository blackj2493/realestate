/**
 * Address-suggestion ranking.
 *
 * Typesense returns typo-tolerant, multi-field matches for a typed address, so for
 * a query like "16 Elm Grove Ave" it can float loosely-related rows — "16 Steel
 * Street, Barrie" (right house number, wrong street) or "4861 Half Moon Grove"
 * (shares only the word "Grove") — above the row the user actually typed. Both
 * suggestion sources (federatedSuggest for the terminal, suggestSearch for the
 * header bar) collect Typesense hits in raw relevance order, so those lookalikes
 * land above the fold.
 *
 * scoreAddressSuggestion() re-scores each candidate label against the typed string
 * so the closest street-number + street-name match ranks first. It is pure and
 * deterministic (unit-tested); the score is a relative signal within one query's
 * candidate set, not an absolute scale.
 */

/** Lowercase, punctuation → spaces, collapse runs, trim. "16 Elm Grove Ave, Toronto" → "16 elm grove ave toronto". */
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Longest run of query tokens appearing consecutively, in order, in the label. */
function longestConsecutiveRun(qt: string[], lt: string[]): number {
  let best = 0;
  for (let i = 0; i < qt.length; i++) {
    for (let j = 0; j < lt.length; j++) {
      let k = 0;
      while (i + k < qt.length && j + k < lt.length && qt[i + k] === lt[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/**
 * Higher = closer to the typed address. Only the relative order within one
 * query's candidate set is meaningful.
 */
export function scoreAddressSuggestion(query: string, label: string): number {
  const q = normalize(query);
  const l = normalize(label);
  if (!q || !l) return 0;
  const qt = q.split(" ");
  const lt = l.split(" ");
  let score = 0;

  // The whole typed string is a prefix of the label — the strongest signal.
  if (l.startsWith(q)) score += 1000;

  // Leading street number: a matching civic number is a strong signal; an
  // explicitly different one almost always means a different property.
  const qNum = /^\d+$/.test(qt[0]) ? qt[0] : null;
  const lNum = /^\d+$/.test(lt[0]) ? lt[0] : null;
  if (qNum) {
    if (lNum === qNum) score += 300;
    else if (lNum) score -= 200;
    else score -= 50;
  }

  // Coverage of the remaining (street-name) tokens, with partial credit for
  // prefixes ("grov" → "grove") and a penalty for typed tokens that are absent.
  const lSet = new Set(lt);
  for (const t of qt) {
    if (t === qNum) continue;
    if (lSet.has(t)) score += 40;
    else if (lt.some((x) => x.startsWith(t) || t.startsWith(x))) score += 20;
    else score -= 10;
  }

  // Reward the street name surviving intact (typed tokens in order, back to back).
  score += longestConsecutiveRun(qt, lt) * 60;

  // Tie-breaker: fewer extra tokens = a tighter match.
  score -= Math.max(0, lt.length - qt.length);

  return score;
}

/**
 * Stable-sort address candidates by closeness to the typed query (best first).
 * Ties preserve the input (Typesense) order via the index fallback.
 */
export function rankAddressSuggestions<T>(query: string, candidates: T[], labelOf: (c: T) => string): T[] {
  return candidates
    .map((c, i) => ({ c, i, s: scoreAddressSuggestion(query, labelOf(c)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
