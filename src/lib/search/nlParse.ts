/**
 * parseNlQuery — turn a human sentence into editable filter chips.
 *
 * "3 bed under 800k near top schools in hamilton with a finished basement"
 *   → [ Hamilton · 3+ Beds · ≤ $800K · School ≥ 8.0 · Finished basement ]
 *
 * Deterministic + pure (no store / network) so it unit-tests cleanly and runs
 * instantly with no API key. The component maps the chips onto the Zustand store
 * (applyChips in chipApply.ts); an LLM parser can later replace this behind the
 * same ParsedQuery contract.
 *
 * Property-type and basement values are the EXACT live Typesense spellings (from
 * fundamentals.ts / the MORE_FILTERS registry) so chips drive the real query.
 */

import type { ChipKind, ParsedChip, ParsedQuery } from "./types";
import { RESIDENTIAL_TYPE_OPTIONS } from "@/lib/filters/fundamentals";
import { CITY_NAMES, CITIES } from "@/lib/cities";

const fmtMoney = (n: number): string =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}K`
      : `$${n}`;

/** Parse a money token ("800k", "$1.2m", "800,000", "800") into dollars. */
function parseMoney(raw: string): number | null {
  const m = raw.replace(/[\s,$]/g, "").match(/^([\d.]+)(k|m|million|thousand)?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  const unit = (m[2] || "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  else if (unit === "m" || unit === "million") n *= 1_000_000;
  // A bare small number in a price context means thousands ("under 800" = $800k).
  else if (n < 10_000) n *= 1_000;
  return Math.round(n);
}

const MONEY = String.raw`\$?[\d.,]+\s*(?:k|m|million|thousand)?`;
// Like MONEY but a unit (k/m/…) or leading $ is REQUIRED — used for the number-THEN-
// keyword price patterns ("800k or less") so a bare bed digit ("3+ beds") can never
// be misread as a price.
const MONEY_STRICT = String.raw`\$?[\d.,]+\s*(?:k|m|million|thousand)|\$[\d.,]+`;

const chip = (kind: ChipKind, label: string, value: ParsedChip["value"]): ParsedChip => ({
  id: `${kind}:${Array.isArray(value) ? value.join(",") : value}`,
  kind,
  label,
  value,
});

// Property-type synonyms → exact PropertySubType value (from RESIDENTIAL_TYPE_OPTIONS).
// Each pattern tolerates a trailing plural ("townhouse(s)", "condo(s)", "duplex(es)")
// — the old `\b` sat directly after the singular noun, so the boundary failed before
// the "s" and "townhouses" silently matched nothing. Order is priority order; the
// matcher below CONSUMES each hit so a compound ("condo townhouse") resolves once.
const TYPE_SYNONYMS: Array<{ re: RegExp; value: string; label: string }> = [
  { re: /\bsemi[-\s]?detached(?:e?s)?\b|\bsemis?\b/, value: "Semi-Detached ", label: "Semi-Detached" },
  { re: /\b(?:stacked\s+town(?:house|home)?s?|condo\s*town(?:house|home)?s?)\b/, value: "Condo Townhouse", label: "Condo Townhouse" },
  { re: /\b(?:town\s?house|town\s?home|row\s?house|row)s?\b/, value: "Att/Row/Townhouse", label: "Townhouse" },
  { re: /\b(?:condos?|apartments?|apts?|lofts?)\b/, value: "Condo Apartment", label: "Condo Apt" },
  { re: /(?<!semi[-\s])\bdetached\b|\bsingle\s?family\b/, value: "Detached", label: "Detached" },
  { re: /\bduplex(?:es)?\b/, value: "Duplex", label: "Duplex" },
  { re: /\b(?:multiplex|triplex|fourplex|multi[-\s]?plex)(?:es)?\b/, value: "Multiplex", label: "Multiplex" },
  { re: /\blinks?\b/, value: "Link", label: "Link" },
  { re: /\b(?:vacant\s?land|empty\s?lots?|building\s?lots?)\b/, value: "Vacant Land", label: "Vacant Land" },
];

// Ordered: the combined "finished + walk-out" (an exact live BasementType value) must
// match before plain "finished" / "walk-out", and the matcher below consumes each hit.
const BASEMENT_SYNONYMS: Array<{ re: RegExp; value: string; label: string }> = [
  {
    re: /\bfinished\s+(?:basement\s+)?with\s+walk\s?-?\s?out\b|\bfinished\s+walk\s?-?\s?out\b/,
    value: "Finished with Walk-Out",
    label: "Finished + walk-out",
  },
  { re: /\bfinished\s+(?:basement|bsmt)\b/, value: "Finished", label: "Finished basement" },
  { re: /\b(?:walk\s?-?\s?out|walkout|walk\s?-?\s?up|walkup)\b/, value: "Walk-Out", label: "Walk-out basement" },
  { re: /\b(?:separate|side|private)\s+entrance\b/, value: "Separate Entrance", label: "Separate entrance" },
  { re: /\bunfinished\s+(?:basement|bsmt)\b/, value: "Unfinished", label: "Unfinished basement" },
  {
    re: /\bbasement\s+(?:apartment|apt|suite)\b|\b(?:in-?law|nanny|income|rental)\s+suite\b/,
    value: "Apartment",
    label: "Basement apartment",
  },
];

/** Longest known city / community name appearing as a word-bounded substring. */
function detectPlace(q: string): string | null {
  let best: string | null = null;
  const consider = (name: string) => {
    if (name.length < 4) return; // avoid 1–3 char false hits
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(q) && (!best || name.length > best.length)) best = name;
  };
  for (const name of CITY_NAMES) consider(name);
  for (const c of CITIES) for (const r of c.regions ?? []) consider(r);
  return best;
}

// Spelled-out + multiplier number-words → digits ("two"/"double" → 2), but ONLY when
// they directly precede a countable unit, so "one of a kind" never becomes "1 of a kind".
const NUMWORD: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  single: 1, double: 2, triple: 3, quad: 4,
};
const NUMWORD_RE = new RegExp(
  String.raw`\b(one|two|three|four|five|six|seven|eight|nine|ten|single|double|triple|quad)\s+(?=(?:car|cars|bed|beds|bedroom|bedrooms|bath|baths|bathroom|bathrooms|washroom|washrooms|parking|garage|garages|space|spaces|spot|spots)\b)`,
  "gi"
);
function normalizeNumberWords(s: string): string {
  return s.replace(NUMWORD_RE, (_m, w: string) => `${NUMWORD[w.toLowerCase()]} `);
}

// Connectives / generic real-estate filler that don't count as "missed intent" when
// they survive matching. Anything else left over is surfaced as `unmatched`.
const STOPWORDS = new Set([
  "in", "on", "at", "near", "around", "within", "with", "without", "and", "or", "a", "an", "the", "of",
  "for", "to", "that", "this", "my", "me", "i", "we", "our", "you", "your", "is", "are", "be", "am",
  "want", "wants", "wanting", "looking", "look", "need", "needs", "show", "find", "get", "got", "like",
  "would", "could", "should", "please", "somewhere", "something", "anywhere", "area", "areas", "place",
  "places", "home", "homes", "house", "houses", "property", "properties", "listing", "listings", "real",
  "estate", "buy", "buying", "rent", "renting", "sale", "located", "close", "by", "new",
  "car", "cars", "parking", "garage", "spot", "spots", "space", "spaces", "storey", "story", "level",
  "basement", "bsmt",
]);

/** Distinct, meaningful words left after every recognised span was blanked out. */
function computeUnmatched(residual: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of residual.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (tok.length < 2 || /^\d+$/.test(tok) || STOPWORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out.join(" ");
}

export function parseNlQuery(raw: string): ParsedQuery {
  const original = raw.trim();
  // Normalise number-words BEFORE matching so "double car garage" / "three bed" parse.
  const q = normalizeNumberWords(` ${original.toLowerCase()} `);
  const chips: ParsedChip[] = [];
  const seen = new Set<ChipKind>();
  // Working copy we blank as spans are recognised; whatever real words survive become
  // `unmatched` — the honest "we read N of your words" signal and the miss-rate metric.
  let residual = q;
  const consume = (t?: string | null) => {
    if (t) residual = residual.replace(t, " ");
  };

  const add = (c: ParsedChip, matched?: string) => {
    consume(matched);
    if (seen.has(c.kind) && c.kind !== "homeType" && c.kind !== "basement") return;
    seen.add(c.kind);
    chips.push(c);
  };

  // ── Price ── keyword-anchored, or unit-required AFTER the number ("800k or less"),
  // so a bare bed/bath digit is never grabbed.
  const between =
    q.match(new RegExp(`\\b(?:between|from)\\s+(${MONEY})\\s+(?:and|to|-|–)\\s+(${MONEY})`, "i")) ||
    q.match(new RegExp(`(${MONEY})\\s*(?:-|–|to)\\s*(${MONEY})`, "i"));
  if (between) {
    const lo = parseMoney(between[1]);
    const hi = parseMoney(between[2]);
    consume(between[0]);
    if (lo != null) add(chip("priceMin", `≥ ${fmtMoney(lo)}`, lo));
    if (hi != null) add(chip("priceMax", `≤ ${fmtMoney(hi)}`, hi));
  } else {
    const maxM =
      q.match(new RegExp(`\\b(?:under|below|less than|up to|max|maximum|cheaper than|no more than|<=?)\\s+(${MONEY})`, "i")) ||
      q.match(new RegExp(`(${MONEY_STRICT})\\s*(?:or|and)?\\s*(?:less|under|below)\\b`, "i"));
    if (maxM) {
      const n = parseMoney(maxM[1]);
      if (n != null) add(chip("priceMax", `≤ ${fmtMoney(n)}`, n), maxM[0]);
    }
    const minM =
      q.match(new RegExp(`\\b(?:over|above|more than|at least|min|minimum|starting at|from|north of|>=?)\\s+(${MONEY})`, "i")) ||
      q.match(new RegExp(`(${MONEY_STRICT})\\s*(?:\\+|or more|or over|and up|and over|plus)\\b`, "i"));
    if (minM) {
      const n = parseMoney(minM[1]);
      if (n != null) add(chip("priceMin", `≥ ${fmtMoney(n)}`, n), minM[0]);
    }
  }

  // ── Beds / baths ── (washroom = Canadian usage for bathroom)
  const beds = q.match(/\b(\d+)\s*\+?\s*(?:bed(?:room)?s?|bd|br)\b/i);
  if (beds) add(chip("beds", `${beds[1]}+ Beds`, parseInt(beds[1], 10)), beds[0]);
  const baths = q.match(/\b(\d+)\s*\+?\s*(?:bath(?:room)?s?|washrooms?|ba)\b/i);
  if (baths) add(chip("baths", `${baths[1]}+ Baths`, parseInt(baths[1], 10)), baths[0]);

  // ── Property type (multi) ── priority order, CONSUMING each hit so a compound like
  // "condo townhouse" resolves to Condo Townhouse alone, not also Townhouse + Condo.
  const typeValues: string[] = [];
  const typeLabels: string[] = [];
  let typeStr = q;
  for (const t of TYPE_SYNONYMS) {
    const tm = typeStr.match(t.re);
    if (tm && !typeValues.includes(t.value)) {
      typeValues.push(t.value);
      typeLabels.push(t.label);
      typeStr = typeStr.replace(t.re, " ");
      consume(tm[0]);
    }
  }
  if (typeValues.length) {
    chips.push(chip("homeType", typeLabels.join(" / "), typeValues));
    seen.add("homeType");
  }

  // ── Basement (multi) ── shrink a working copy so "finished walk-out" doesn't also
  // fire plain Walk-Out.
  let bsmtStr = q;
  for (const b of BASEMENT_SYNONYMS) {
    const bm = bsmtStr.match(b.re);
    if (bm && !chips.some((c) => c.kind === "basement" && (c.value as string[])[0] === b.value)) {
      chips.push(chip("basement", b.label, [b.value]));
      bsmtStr = bsmtStr.replace(b.re, " ");
      consume(bm[0]);
    }
  }

  // ── Schools ──
  const schoolNum = q.match(/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:\/\s*10\s*)?(?:rated\s+)?schools?\b/i);
  if (schoolNum) {
    const s = Math.min(10, parseFloat(schoolNum[1]));
    add(chip("school", `School ≥ ${s.toFixed(1)}`, s), schoolNum[0]);
  } else {
    const sm =
      q.match(/\b(?:top|good|best|great|high(?:ly)?[-\s]?rated|top[-\s]?rated)\s+schools?\b/i) ||
      q.match(/\bnear\s+(?:good\s+|top\s+)?schools?\b/i) ||
      q.match(/\b(?:good|top|great|best)\s+school\s+district\b/i);
    if (sm) add(chip("school", "School ≥ 8.0", 8), sm[0]);
  }

  // ── Parking / garage ──
  const parking =
    q.match(/\b(\d+)\s*(?:car\s+)?(?:garage|parking)\b/i) ||
    q.match(/\bparking\s+for\s+(\d+)\b/i) ||
    q.match(/\b(\d+)\s+(?:parking\s+)?(?:spots?|spaces?)\b/i);
  if (parking) add(chip("parking", `${parking[1]}+ Parking`, parseInt(parking[1], 10)), parking[0]);
  else {
    const garage = q.match(/\b(?:garage|carport)\b/i);
    if (garage) add(chip("parking", "Garage", 1), garage[0]);
  }

  // ── Motivation signals ──
  const stale = q.match(
    /\b(?:stale|sitting|been on the market|long\s+dom|motivated(?:\s+seller)?|must\s+sell|needs?\s+to\s+sell|quick\s+(?:sale|close))\b/i
  );
  if (stale) add(chip("staleOnly", "Stale only", "true"), stale[0]);
  const drop = q.match(/\b(?:price\s*drops?|price\s*cuts?|reduced|just\s+reduced|price\s*reduction|dropped)\b/i);
  if (drop) add(chip("priceDrop", "Price-dropped", 1), drop[0]);

  // ── Location (city / community) ──
  const place = detectPlace(original);
  if (place) {
    add(chip("location", place, place), place.toLowerCase());
  } else {
    const near = original.match(/\b(?:in|near|around|within)\s+([a-z][a-z .'\-]{2,})$/i);
    if (near) {
      const label = near[1].trim().replace(/\b\w/g, (m) => m.toUpperCase());
      add(chip("location", label, label), near[1].toLowerCase());
    }
  }

  return {
    chips,
    unmatched: computeUnmatched(residual),
    // Treat as an NL query only when we found something beyond a single bare place
    // (a lone "Hamilton" is better handled by the normal place typeahead).
    isStructured: chips.some((c) => c.kind !== "location") && chips.length >= 2,
  };
}
