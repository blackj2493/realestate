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

const chip = (kind: ChipKind, label: string, value: ParsedChip["value"]): ParsedChip => ({
  id: `${kind}:${Array.isArray(value) ? value.join(",") : value}`,
  kind,
  label,
  value,
});

// Property-type synonyms → exact PropertySubType value (from RESIDENTIAL_TYPE_OPTIONS).
const TYPE_SYNONYMS: Array<{ re: RegExp; value: string; label: string }> = [
  { re: /\bsemi[-\s]?detached\b|\bsemis?\b/, value: "Semi-Detached ", label: "Semi-Detached" },
  { re: /\bcondo\s*town(house|home)?\b/, value: "Condo Townhouse", label: "Condo Townhouse" },
  { re: /\b(town\s?house|town\s?home|row\s?house|row\b)\b/, value: "Att/Row/Townhouse", label: "Townhouse" },
  { re: /\b(condo|apartment|apt)\b/, value: "Condo Apartment", label: "Condo Apt" },
  { re: /(?<!semi[-\s])\bdetached\b|\bsingle\s?family\b/, value: "Detached", label: "Detached" },
  { re: /\bduplex\b/, value: "Duplex", label: "Duplex" },
  { re: /\b(multiplex|triplex|fourplex|multi[-\s]?plex)\b/, value: "Multiplex", label: "Multiplex" },
  { re: /\blink\b/, value: "Link", label: "Link" },
  { re: /\b(vacant\s?land|empty\s?lot|building\s?lot)\b/, value: "Vacant Land", label: "Vacant Land" },
];

const BASEMENT_SYNONYMS: Array<{ re: RegExp; value: string; label: string }> = [
  { re: /\bfinished\s+(?:basement|bsmt)\b/, value: "Finished", label: "Finished basement" },
  { re: /\b(walk\s?-?\s?out|walkout)\b/, value: "Walk-Out", label: "Walk-out basement" },
  { re: /\bseparate\s+entrance\b/, value: "Separate Entrance", label: "Separate entrance" },
  { re: /\bunfinished\s+(?:basement|bsmt)\b/, value: "Unfinished", label: "Unfinished basement" },
  { re: /\bbasement\s+apartment\b|\bin-?law\s+suite\b/, value: "Apartment", label: "Basement apartment" },
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

export function parseNlQuery(raw: string): ParsedQuery {
  const original = raw.trim();
  const q = ` ${original.toLowerCase()} `;
  const chips: ParsedChip[] = [];
  const consumed: Array<[number, number]> = [];
  const seen = new Set<ChipKind>();

  const add = (c: ParsedChip, span?: [number, number]) => {
    if (seen.has(c.kind) && c.kind !== "homeType" && c.kind !== "basement") return;
    seen.add(c.kind);
    chips.push(c);
    if (span) consumed.push(span);
  };

  // ── Price ── keyword-anchored so the bed/bath digits are never grabbed.
  const between =
    q.match(new RegExp(`\\b(?:between|from)\\s+(${MONEY})\\s+(?:and|to|-|–)\\s+(${MONEY})`, "i")) ||
    q.match(new RegExp(`(${MONEY})\\s*(?:-|–|to)\\s*(${MONEY})`, "i"));
  if (between) {
    const lo = parseMoney(between[1]);
    const hi = parseMoney(between[2]);
    if (lo != null) add(chip("priceMin", `≥ ${fmtMoney(lo)}`, lo));
    if (hi != null) add(chip("priceMax", `≤ ${fmtMoney(hi)}`, hi));
  } else {
    const maxM = q.match(
      new RegExp(`\\b(?:under|below|less than|up to|max|maximum|cheaper than|<=?)\\s+(${MONEY})`, "i")
    );
    if (maxM) {
      const n = parseMoney(maxM[1]);
      if (n != null) add(chip("priceMax", `≤ ${fmtMoney(n)}`, n));
    }
    const minM = q.match(
      new RegExp(`\\b(?:over|above|more than|at least|min|minimum|starting at|from|>=?)\\s+(${MONEY})`, "i")
    );
    if (minM) {
      const n = parseMoney(minM[1]);
      if (n != null) add(chip("priceMin", `≥ ${fmtMoney(n)}`, n));
    }
  }

  // ── Beds / baths ──
  const beds = q.match(/\b(\d+)\s*\+?\s*(?:bed(?:room)?s?|bd|br)\b/i);
  if (beds) add(chip("beds", `${beds[1]}+ Beds`, parseInt(beds[1], 10)));
  const baths = q.match(/\b(\d+)\s*\+?\s*(?:bath(?:room)?s?|ba)\b/i);
  if (baths) add(chip("baths", `${baths[1]}+ Baths`, parseInt(baths[1], 10)));

  // ── Property type (multi) ──
  const typeValues: string[] = [];
  const typeLabels: string[] = [];
  for (const t of TYPE_SYNONYMS) {
    if (t.re.test(q) && !typeValues.includes(t.value)) {
      typeValues.push(t.value);
      typeLabels.push(t.label);
    }
  }
  if (typeValues.length) {
    chips.push(chip("homeType", typeLabels.join(" / "), typeValues));
    seen.add("homeType");
  }

  // ── Basement (multi) ──
  for (const b of BASEMENT_SYNONYMS) {
    if (b.re.test(q)) chips.push(chip("basement", b.label, [b.value]));
  }

  // ── Schools ──
  const schoolNum = q.match(/\b(\d+(?:\.\d+)?)\s*\+?\s*(?:\/\s*10\s*)?(?:rated\s+)?schools?\b/i);
  if (schoolNum) {
    const s = Math.min(10, parseFloat(schoolNum[1]));
    add(chip("school", `School ≥ ${s.toFixed(1)}`, s));
  } else if (/\b(top|good|best|great|high(?:ly)?[-\s]?rated|top[-\s]?rated)\s+schools?\b/i.test(q) || /\bnear\s+schools?\b/i.test(q)) {
    add(chip("school", "School ≥ 8.0", 8));
  }

  // ── Parking / garage ──
  const parking = q.match(/\b(\d+)\s*(?:car\s+)?(?:garage|parking)\b/i);
  if (parking) add(chip("parking", `${parking[1]}+ Parking`, parseInt(parking[1], 10)));
  else if (/\bgarage\b/i.test(q)) add(chip("parking", "Garage", 1));

  // ── Motivation signals ──
  if (/\b(stale|sitting|been on the market|long\s+dom|motivated)\b/i.test(q))
    add(chip("staleOnly", "Stale only", "true"));
  if (/\b(price\s*drop|price\s*cut|reduced|price\s*reduction|dropped)\b/i.test(q))
    add(chip("priceDrop", "Price-dropped", 1));

  // ── Location (city / community) ──
  const place = detectPlace(original);
  if (place) {
    add(chip("location", place, place));
  } else {
    const near = original.match(/\b(?:in|near|around|within)\s+([a-z][a-z .'\-]{2,})$/i);
    if (near) {
      const label = near[1].trim().replace(/\b\w/g, (m) => m.toUpperCase());
      add(chip("location", label, label));
    }
  }

  return {
    chips,
    unmatched: "",
    // Treat as an NL query only when we found something beyond a single bare place
    // (a lone "Hamilton" is better handled by the normal place typeahead).
    isStructured: chips.some((c) => c.kind !== "location") && chips.length >= 2,
  };
}
