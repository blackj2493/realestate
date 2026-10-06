/**
 * Description search filters — the two universal filters behind "In the description".
 *
 *  - `descSignals` (string[] of descriptionSignals ids): a plain filter_by clause on the
 *    `description_signals` facet. Multiple signals are AND-ed: ticking "Separate entrance"
 *    and "Walk-out basement" means homes that have both, which is what a reader building a
 *    checklist expects.
 *  - `descWords` (string[] of terms): free text against the `SearchRemarks` field. Text
 *    search is Typesense's `q`, not filter_by, so `buildClause` returns null and callers
 *    that run the terminal query read `descriptionTextQuery()` instead.
 *
 * Both live in the universal-filter map (not MORE_FILTERS), so they reset, snapshot into
 * saved areas and reach the alerts worker with no extra plumbing, while never appearing as
 * generic chips in the filter bar: the Filters panel draws them in their own section.
 *
 * TERMS. A term is lower-cased words separated by single spaces ("separate entrance" is one
 * phrase term). A leading "-" marks "doesn't mention". Typesense applies an exclusion only
 * alongside something to match, so exclusions are held until at least one include term
 * exists — `descriptionTextQuery` returns null and the UI says so.
 */

import type { FilterDef, FilterValue, UniversalFilterState } from "./types";
import { SIGNAL_BY_ID, isDescriptionSignalId } from "@/lib/listings/descriptionSignals";

export const DESC_SIGNALS_KEY = "descSignals";
export const DESC_WORDS_KEY = "descWords";

/** Typesense field the words search, and the field highlights come back on. */
export const DESCRIPTION_TEXT_FIELD = "SearchRemarks";
/** Typesense facet the signals filter and count on. */
export const DESCRIPTION_SIGNAL_FIELD = "description_signals";

/** A handful of words, not an essay: the query must stay a filter, not a search engine. */
export const MAX_DESC_TERMS = 6;
const MAX_TERM_LEN = 40;

// ── Terms ──────────────────────────────────────────────────────────────────

export interface DescTerm {
  /** Lower-case words, single-spaced. More than one word is searched as a phrase. */
  text: string;
  exclude: boolean;
}

/** Strip quotes, lower-case, collapse whitespace. "" when nothing usable is left. */
export function normaliseTermText(raw: string): string {
  return raw
    .replace(/["“”`]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM_LEN)
    .trim();
}

export function parseTerm(stored: string): DescTerm {
  const exclude = stored.startsWith("-");
  return { text: exclude ? stored.slice(1) : stored, exclude };
}

export function encodeTerm(t: DescTerm): string {
  return `${t.exclude ? "-" : ""}${t.text}`;
}

/** The stored terms, parsed, skipping anything empty. */
export function descTerms(value: FilterValue | undefined): DescTerm[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .filter((v): v is string => typeof v === "string")
    .map(parseTerm)
    .filter((t) => t.text.length > 0);
}

/**
 * Add one typed term. The whole input is ONE term: the search-box row offers exactly what
 * was typed, so "separate entrance" becomes a phrase, not two loose words. A leading "-"
 * means exclude. A duplicate replaces its earlier self (so re-adding flips nothing silently).
 */
export function addTerm(value: FilterValue | undefined, raw: string): string[] {
  const trimmed = raw.trim();
  const exclude = trimmed.startsWith("-");
  const text = normaliseTermText(exclude ? trimmed.slice(1) : trimmed);
  const current = descTerms(value).filter((t) => t.text !== text);
  if (!text) return current.map(encodeTerm);
  return [...current, { text, exclude }].slice(-MAX_DESC_TERMS).map(encodeTerm);
}

export function removeTerm(value: FilterValue | undefined, text: string): string[] {
  return descTerms(value)
    .filter((t) => t.text !== text)
    .map(encodeTerm);
}

/** Flip one term between "mentions" and "doesn't mention". */
export function toggleTerm(value: FilterValue | undefined, text: string): string[] {
  return descTerms(value)
    .map((t) => (t.text === text ? { ...t, exclude: !t.exclude } : t))
    .map(encodeTerm);
}

const quoted = (text: string) => (text.includes(" ") ? `"${text}"` : text);

/**
 * The Typesense `q` for the active words, or null when there is nothing to search: no
 * terms, or only exclusions (see the header). Phrases are quoted; exclusions prefixed "-".
 */
export function descriptionTextQuery(values: UniversalFilterState): string | null {
  const terms = descTerms(values[DESC_WORDS_KEY]);
  if (!terms.some((t) => !t.exclude)) return null;
  return terms.map((t) => `${t.exclude ? "-" : ""}${quoted(t.text)}`).join(" ");
}

/** True when the reader has only "doesn't mention" words — the UI asks for one to look for. */
export function hasOnlyExclusions(values: UniversalFilterState): boolean {
  const terms = descTerms(values[DESC_WORDS_KEY]);
  return terms.length > 0 && terms.every((t) => t.exclude);
}

/**
 * Typesense parameters for a description text search, merged into the listing search when
 * `descriptionTextQuery` is non-null. Exact words, no prefix matching (a reader who typed
 * "pool" did not mean "pooled"), one typo allowed only on longer words, and every word
 * required — dropping words to find more results would show homes that don't say it.
 */
export const DESCRIPTION_SEARCH_PARAMS = {
  query_by: DESCRIPTION_TEXT_FIELD,
  prefix: false,
  num_typos: 1,
  min_len_1typo: 6,
  min_len_2typo: 100,
  drop_tokens_threshold: 0,
  typo_tokens_threshold: 0,
  highlight_fields: DESCRIPTION_TEXT_FIELD,
  highlight_affix_num_tokens: 8,
  snippet_threshold: 20,
  highlight_start_tag: "⟦",
  highlight_end_tag: "⟧",
} as const;

/** Snippet markers, split on by the result rows — never rendered as HTML. */
export const SNIPPET_OPEN = "⟦";
export const SNIPPET_CLOSE = "⟧";

/** A snippet split into plain and matched runs, ready to render as text nodes. */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  const re = new RegExp(`${SNIPPET_OPEN}([^${SNIPPET_CLOSE}]*)${SNIPPET_CLOSE}`, "g");
  let last = 0;
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false });
    out.push({ text: m[1], hit: true });
    last = m.index + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false });
  return out.filter((p) => p.text.length > 0);
}

/**
 * A place string as a filter_by clause, for when description words take over `q`.
 *
 * The terminal's place search is a text query over City / CityRegion. Typesense has one
 * `q` per search, so while words are active the place moves into filter_by as a token match
 * on the same two fields. A trailing province (", ON") is dropped — the feed's City values
 * never carry one. null for an empty place.
 */
export function locationFilterClause(location: string | null | undefined): string | null {
  const place = (location ?? "")
    .replace(/,\s*(on|ontario|canada)\s*$/i, "")
    .replace(/`/g, "")
    .trim();
  if (!place || place === "*") return null;
  return `(City:\`${place}\` || CityRegion:\`${place}\`)`;
}

/** Any description filter that changes the result set: a signal, or a word to look for. */
export function isDescriptionFilterActive(values: UniversalFilterState): boolean {
  return signalIds(values[DESC_SIGNALS_KEY]).length > 0 || descriptionTextQuery(values) !== null;
}

// ── Labels ─────────────────────────────────────────────────────────────────

export function termLabel(t: DescTerm): string {
  return t.exclude ? `Not “${t.text}”` : `Mentions “${t.text}”`;
}

export function signalIds(value: FilterValue | undefined): string[] {
  return Array.isArray(value) ? (value as unknown[]).filter(isDescriptionSignalId) : [];
}

// ── Filter definitions ─────────────────────────────────────────────────────

export const DESC_SIGNALS_FILTER: FilterDef = {
  key: DESC_SIGNALS_KEY,
  label: "Description signals",
  category: "Property",
  control: "enum",
  defaultPinned: false,
  defaultValue: [],
  facetField: DESCRIPTION_SIGNAL_FIELD,
  isActive: (v) => signalIds(v).length > 0,
  buildClause: (v) => {
    const ids = signalIds(v);
    if (!ids.length) return null;
    return ids.map((id) => `${DESCRIPTION_SIGNAL_FIELD}:=\`${id}\``).join(" && ");
  },
  chipLabel: (v) => {
    const ids = signalIds(v);
    return ids.length ? ids.map((id) => SIGNAL_BY_ID[id as keyof typeof SIGNAL_BY_ID].label).join(" · ") : "Description signals";
  },
};

export const DESC_WORDS_FILTER: FilterDef = {
  key: DESC_WORDS_KEY,
  label: "Description words",
  category: "Property",
  control: "enum",
  defaultPinned: false,
  defaultValue: [],
  // Active only when it actually changes the query — an exclusion-only list does not.
  isActive: (v) => descTerms(v).some((t) => !t.exclude),
  // Text search runs through `q` (descriptionTextQuery), never filter_by.
  buildClause: () => null,
  chipLabel: (v) => {
    const terms = descTerms(v);
    return terms.length ? terms.map(termLabel).join(" · ") : "Description words";
  },
};

export const DESCRIPTION_FILTERS: FilterDef[] = [DESC_SIGNALS_FILTER, DESC_WORDS_FILTER];
