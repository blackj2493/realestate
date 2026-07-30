/**
 * permitDetail — turn ONE municipal building-permit feature's raw attributes into a
 * short, human line for the `major_construction` "Things to Know" flag:
 *
 *   "12-unit new build · ~$4.2M · issued Mar 2026"
 *
 * WHY a normalizer and not a field read: every city names the same concept differently
 * (Waterloo WORKDESC/CONTRVALUE/UNITS, Mississauga SCOPE/EST_CON_VALUE/RES_UNITS,
 * Kitchener PERMIT_TYPE/CONSTRUCTION_VALUE, Oakville Worktype/Construction_Value/
 * Dwelling_Units_Created, Burlington WORKDESC/CONSTRUCTVALUE/RESUNITS, Toronto
 * PERMIT_TYPE/DWELLING_UNITS_CREATED with the value REDACTED). geo_features.attrs keeps
 * every source field verbatim (loadGeoData pulls outFields=*), so this module resolves
 * each concept through an ordered candidate-key list, case- and separator-insensitively
 * (CLAUDE.md §6: expect nulls, wrong types, missing fields — every clause is optional and
 * the whole line degrades to null).
 *
 * DELIBERATELY OMITTED — the permit's street ADDRESS and its free-text DESCRIPTION. The
 * flag reports a neighbouring property's construction; distance plus scale is the useful
 * signal, and naming the exact address (or echoing prose that may contain one) is more
 * exposure of a third party's property than this feature needs.
 *
 * COMPLIANCE: municipal open data (NOT TRREB IDX/VOW), and a hardcoded field map +
 * regex rules — deterministic, no LLM (CLAUDE.md §4).
 */

type Attrs = Record<string, unknown>;

/** "Dwelling_Units_Created" / "DWELLING_UNITS_CREATED" → "dwellingunitscreated". */
function normKey(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** First present, non-empty value among `keys` (matched separator-/case-insensitively). */
function pick(attrs: Attrs, keys: string[]): unknown {
  const index = new Map<string, unknown>();
  for (const [k, v] of Object.entries(attrs)) {
    const nk = normKey(k);
    if (!index.has(nk)) index.set(nk, v);
  }
  for (const cand of keys) {
    const v = index.get(normKey(cand));
    if (v != null && !(typeof v === "string" && v.trim() === "")) return v;
  }
  return undefined;
}

/** Ordered so the most SPECIFIC work descriptor wins over the generic permit bucket. */
const TYPE_KEYS = [
  "SCOPE", // Mississauga
  "WORKDESC", // Waterloo, Burlington
  "WORKTYPE", // Oakville (Worktype)
  "WORK_TYPE",
  "PERMIT_TYPE", // Kitchener, Toronto
  "PERMITDESC", // Waterloo
  "STRUCTURE_TYPE", // Toronto
  "SUBTYPE", // Oakville
];
const UNIT_KEYS = [
  "DWELLING_UNITS_CREATED", // Toronto, Oakville
  "RES_UNITS", // Mississauga
  "RESUNITS", // Burlington
  "UNITS_CREATED",
  "UNITS", // Waterloo
];
const VALUE_KEYS = [
  "CONSTRUCTION_VALUE", // Kitchener, Oakville
  "EST_CON_VALUE", // Mississauga
  "CONSTRUCTVALUE", // Burlington
  "CONTRVALUE", // Waterloo
  "EST_CONST_COST", // Toronto (redacted in the feed — kept for the day it isn't)
  "CONSTRUCTION_COST",
];
const DATE_KEYS = [
  "ISSUED_DATE", // Toronto
  "ISSUE_DATE", // Mississauga
  "ISSUEDATE", // Oakville, Burlington
  "PERMIT_ISSUED_DATE",
  "ISSUE_YEAR", // Waterloo, Kitchener (year only)
  "ISSUEYEAR",
];

/** Loose numeric read: handles 4200000, "4200000", "$4,200,000", "12 ". */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ── work type ────────────────────────────────────────────────────────────────
/** "New Const." → "new const" · "NonResidentialAddition" → "non residential addition". */
function cleanType(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // split camelCase source codes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Ordered rules — first match wins, so "Residential Demolition" reads as a demolition. */
const TYPE_RULES: Array<[RegExp, string]> = [
  [/demoli|^demo\b/, "demolition"],
  [/foundation/, "foundation-only build"],
  [/addition|alteration/, "major addition"],
  [/multi/, "multi-residential build"],
  [/\bnew\b/, "new build"],
  [/non residential/, "non-residential build"],
  [/industrial/, "industrial build"],
  [/commercial/, "commercial build"],
  [/institutional|^ici\b/, "institutional build"],
  [/residential/, "residential build"],
];

/** Raw city work code → a consistent, lowercase phrase ("new build", "major addition"). */
export function permitTypeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = cleanType(raw);
  if (!t || /^(unknown|n a|none|other)$/.test(t)) return null;
  for (const [re, label] of TYPE_RULES) if (re.test(t)) return label;
  return t.length <= 40 ? t : null; // unrecognized but plausible → show the city's own words
}

// ── construction value ───────────────────────────────────────────────────────
/** 4_200_000 → "~$4.2M" · 850_000 → "~$850K". Sub-$50k and absurd values are dropped. */
export function formatPermitValue(raw: unknown): string | null {
  const n = toNumber(raw);
  if (n == null || n < 50_000 || n > 100_000_000_000) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // 1 decimal below $10M ("~$4.2M"), whole millions above ("~$42M") — trailing .0 stripped.
    const s = m >= 10 ? String(Math.round(m)) : m.toFixed(1).replace(/\.0$/, "");
    return `~$${s}M`;
  }
  return `~$${Math.round(n / 1000)}K`;
}

// ── issue date ───────────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

/**
 * "2026-03-14" → "Mar 2026" · 1773100800000 (ArcGIS epoch ms) → "Mar 2026" · 2024 → "2024".
 * Formatted manually (no Intl/Date locale) so SSR output can never drift with TZ.
 */
export function formatPermitIssued(raw: unknown): string | null {
  const n = toNumber(raw);
  // A bare year (Waterloo/Kitchener ISSUE_YEAR) — no month to show.
  if (n != null && n >= MIN_YEAR && n <= MAX_YEAR) return String(Math.round(n));
  // ArcGIS date fields arrive as epoch MILLISECONDS in JSON.
  if (n != null && n > 1e11) {
    const d = new Date(n);
    const y = d.getUTCFullYear();
    if (y < MIN_YEAR || y > MAX_YEAR) return null;
    return `${MONTHS[d.getUTCMonth()]} ${y}`;
  }
  if (typeof raw === "string") {
    const m = /^(\d{4})-(\d{2})/.exec(raw.trim());
    if (m) {
      const y = Number(m[1]);
      const mi = Number(m[2]) - 1;
      if (y < MIN_YEAR || y > MAX_YEAR || mi < 0 || mi > 11) return null;
      return `${MONTHS[mi]} ${y}`;
    }
  }
  return null;
}

/**
 * The flag's sub-line: scale first (that's what a neighbour actually feels), then cost,
 * then vintage. Returns null when the source carries nothing worth adding — the flag then
 * renders exactly as it does today (title + distance only).
 *
 *   Toronto (value redacted): "12-unit new build · issued Mar 2026"
 *   Waterloo:                 "major addition · ~$1.2M · issued 2025"
 */
export function permitDetailLine(attrs: unknown): string | null {
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const a = attrs as Attrs;

  const type = permitTypeLabel(pick(a, TYPE_KEYS));
  const unitsRaw = toNumber(pick(a, UNIT_KEYS));
  // A single unit is just "a house" — it adds nothing over the work type. 2+ is the scale signal.
  const units = unitsRaw != null && unitsRaw >= 2 && unitsRaw <= 10_000 ? Math.round(unitsRaw) : null;
  const value = formatPermitValue(pick(a, VALUE_KEYS));
  const issued = formatPermitIssued(pick(a, DATE_KEYS));

  const parts: string[] = [];
  if (units != null) parts.push(`${units}-unit ${type ?? "development"}`);
  else if (type) parts.push(type);
  if (value) parts.push(value);
  if (issued) parts.push(`issued ${issued}`);

  if (!parts.length) return null;
  // Sentence-case the lead clause ("12-unit new build" stays as-is; "major addition" → "Major addition").
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return parts.join(" · ");
}
