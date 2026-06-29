/**
 * chipUrl — the shared contract that lets a search typed ANYWHERE land on the
 * terminal fully parsed. It serializes the NL parser's editable chips to URL
 * params and reconstructs them on the other side.
 *
 *   parseNlQuery("4 bed townhouse under 900k in richmond hill")
 *     → chipsToSearchParams → "/properties?city=Richmond+Hill&beds=4&maxPrice=900000&type=Att%2FRow%2FTownhouse"
 *     → paramsToChips → syncChips (chipApply.ts) → identical terminal state.
 *
 * Pure + dependency-light (only the ParsedChip contract) so the lightweight
 * header search, the terminal page, and any link builder share one schema. The
 * `city` key is the EXISTING place param, so old `/properties?city=…` links keep
 * working and a plain place stays a plain place (hasStructuredParams === false).
 */

import type { ChipKind, ParsedChip } from "./types";

/** Accepts both URLSearchParams and Next's ReadonlyURLSearchParams. */
type ReadParams = Pick<URLSearchParams, "get">;

const fmtMoney = (n: number): string =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : n >= 1000
      ? `$${Math.round(n / 1000)}K`
      : `$${n}`;

const mk = (kind: ChipKind, label: string, value: ParsedChip["value"]): ParsedChip => ({
  id: `${kind}:${Array.isArray(value) ? value.join(",") : value}`,
  kind,
  label,
  value,
});

// Every param key the terminal hydrates beyond the bare place. Presence of ANY of
// these is what makes a link "structured" (vs. a plain `?city=` place link).
const STRUCTURED_KEYS = [
  "minPrice",
  "maxPrice",
  "beds",
  "baths",
  "parking",
  "school",
  "priceDrop",
  "stale",
  "type",
  "basement",
] as const;

/** ParsedChip[] → URLSearchParams. Multi-value kinds (type/basement) comma-join. */
export function chipsToSearchParams(chips: ParsedChip[]): URLSearchParams {
  const p = new URLSearchParams();
  const types: string[] = [];
  const basements: string[] = [];
  for (const c of chips) {
    switch (c.kind) {
      case "location":
        if (c.value) p.set("city", String(c.value));
        break;
      case "priceMin":
        p.set("minPrice", String(c.value));
        break;
      case "priceMax":
        p.set("maxPrice", String(c.value));
        break;
      case "beds":
        p.set("beds", String(c.value));
        break;
      case "baths":
        p.set("baths", String(c.value));
        break;
      case "parking":
        p.set("parking", String(c.value));
        break;
      case "school":
        p.set("school", String(c.value));
        break;
      case "priceDrop":
        p.set("priceDrop", String(c.value));
        break;
      case "staleOnly":
        p.set("stale", "1");
        break;
      // homeType is one chip carrying all values; basement is one chip per value.
      case "homeType":
        for (const v of c.value as string[]) if (v && !types.includes(v)) types.push(v);
        break;
      case "basement":
        for (const v of c.value as string[]) if (v && !basements.includes(v)) basements.push(v);
        break;
    }
  }
  if (types.length) p.set("type", types.join(","));
  if (basements.length) p.set("basement", basements.join(","));
  return p;
}

/** Convenience: the query string (no leading "?"). Empty when no chips serialize. */
export function chipsToQueryString(chips: ParsedChip[]): string {
  return chipsToSearchParams(chips).toString();
}

/** True when the URL carries at least one parser-owned filter beyond the place. */
export function hasStructuredParams(params: ReadParams): boolean {
  return STRUCTURED_KEYS.some((k) => params.get(k) != null);
}

/**
 * URLSearchParams → ParsedChip[], the inverse of chipsToSearchParams. Labels are
 * regenerated for display; syncChips() reads only kind + value, so a perfect label
 * round-trip isn't required for correctness — the filter state is what matters.
 */
export function paramsToChips(params: ReadParams): ParsedChip[] {
  const chips: ParsedChip[] = [];
  const num = (k: string): number | null => {
    const v = params.get(k);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Location reuses the existing place param (and tolerates the legacy `search`).
  const city = params.get("city") || params.get("search");
  if (city) chips.push(mk("location", city, city));

  const minP = num("minPrice");
  if (minP != null) chips.push(mk("priceMin", `≥ ${fmtMoney(minP)}`, minP));
  const maxP = num("maxPrice");
  if (maxP != null) chips.push(mk("priceMax", `≤ ${fmtMoney(maxP)}`, maxP));

  const beds = num("beds");
  if (beds) chips.push(mk("beds", `${beds}+ Beds`, beds));
  const baths = num("baths");
  if (baths) chips.push(mk("baths", `${baths}+ Baths`, baths));
  const parking = num("parking");
  if (parking) chips.push(mk("parking", `${parking}+ Parking`, parking));

  const school = num("school");
  if (school) chips.push(mk("school", `School ≥ ${school.toFixed(1)}`, school));
  const priceDrop = num("priceDrop");
  if (priceDrop) chips.push(mk("priceDrop", "Price-dropped", priceDrop));
  if (params.get("stale") === "1") chips.push(mk("staleOnly", "Stale only", "true"));

  // Preserve the EXACT PropertySubType / BasementType spelling — some live values
  // carry a trailing space ("Semi-Detached ") that the Typesense match depends on,
  // so we drop only blank entries and never trim the kept values.
  const splitExact = (raw: string | null): string[] =>
    (raw || "").split(",").filter((s) => s.trim().length > 0);

  const types = splitExact(params.get("type"));
  if (types.length) chips.push(mk("homeType", types.join(" / "), types));

  const basements = splitExact(params.get("basement"));
  for (const b of basements) chips.push(mk("basement", b, [b]));

  return chips;
}
