/**
 * formatRegionLabel — turn a raw TRREB/OREB market-area string into a label a
 * consumer can read, for DISPLAY ONLY.
 *
 * TRREB files the City of Toronto as ~36 opaque district codes ("Toronto C01" …
 * "Toronto W10") and Ottawa as OREB area names carried with a numeric board code
 * ("7711 - Barrhaven - Half Moon Bay"). Neither means anything to a buyer. This
 * maps a Toronto code to its well-known neighbourhoods and strips Ottawa's board
 * prefix; anything else passes through unchanged.
 *
 * IMPORTANT — this is a pure display formatter. The raw string stays the canonical
 * VALUE everywhere data flows (chip/URL values, Typesense filters, saved bubbles,
 * region_metrics keys, dashboard config). Only ever pass a region/place string to
 * it, never a street address — the OREB prefix-strip is address-shaped ("12 - 100
 * Main St"), which is why callers gate it to place/community rows and the strip
 * itself only fires when a NON-digit follows the dash.
 */

/**
 * TRREB Toronto district code (the "C01"/"E01"/"W01" suffix) → a concise,
 * recognizable neighbourhood pair. Descriptions follow the public TREB district
 * community maps. TREB has no C05, so it is intentionally absent; any unmapped
 * code falls back to the bare "Toronto Cxx" (still better than a wrong guess).
 */
export const TORONTO_DISTRICTS: Record<string, string> = {
  C01: "Downtown & Waterfront",
  C02: "The Annex & Yorkville",
  C03: "Forest Hill South & Cedarvale",
  C04: "Lawrence Park & Bedford Park",
  C06: "Bathurst Manor & Clanton Park",
  C07: "Willowdale West & Lansing",
  C08: "Cabbagetown & St. James Town",
  C09: "Rosedale & Moore Park",
  C10: "Davisville & Mount Pleasant",
  C11: "Leaside & Thorncliffe Park",
  C12: "Bridle Path & York Mills",
  C13: "Don Mills & Banbury",
  C14: "Willowdale East & Newtonbrook",
  C15: "Bayview Village & Don Valley Village",
  E01: "Riverdale & Leslieville",
  E02: "The Beaches & Woodbine",
  E03: "Danforth & East York",
  E04: "Wexford & Clairlea",
  E05: "L'Amoreaux & Tam O'Shanter",
  E06: "Birch Cliff & Cliffside",
  E07: "Agincourt & Milliken",
  E08: "Guildwood & Scarborough Village",
  E09: "Woburn & Bendale",
  E10: "Highland Creek & Centennial",
  E11: "Malvern & Rouge",
  W01: "High Park & Roncesvalles",
  W02: "The Junction & Bloor West Village",
  W03: "Corso Italia & Weston-Pellam Park",
  W04: "Yorkdale & Weston",
  W05: "Downsview & Jane-Finch",
  W06: "Mimico & The Queensway",
  W07: "Sunnylea & Stonegate",
  W08: "Islington & The Kingsway",
  W09: "Richview & Kingsview Village",
  W10: "Rexdale & West Humber",
};

/** "Toronto C01" (the whole City value is the code — the prefix is always "Toronto"). */
const TORONTO_RE = /^Toronto\s+([CEW]\d{2})$/i;

/**
 * OREB board prefix: "7711 - " / "551 - ". Stripped ONLY when a non-digit follows,
 * so a unit-dash street address ("12 - 100 Main St") is never mangled — that half
 * ("100 Main St") starts with a digit and is left intact.
 */
const OREB_PREFIX_RE = /^\d{3,4}\s*-\s*(?=\D)/;

export interface RegionParts {
  /** The untouched canonical value (never use for anything but round-tripping). */
  raw: string;
  /** The TRREB code, present only for a mapped Toronto district ("Toronto C01"). */
  code?: string;
  /** The consumer-readable name (neighbourhood pair, stripped OREB name, or the raw). */
  name: string;
}

/**
 * Decompose a raw region string into display parts, so a caller can compose the
 * ordering it wants (e.g. "code · name" inline, or "name (code)" in a breadcrumb).
 */
export function formatRegionParts(raw: string): RegionParts {
  const value = raw ?? "";
  const trimmed = value.trim();
  if (!trimmed) return { raw: value, name: value };

  const tor = trimmed.match(TORONTO_RE);
  if (tor) {
    const code = `Toronto ${tor[1].toUpperCase()}`;
    const hood = TORONTO_DISTRICTS[tor[1].toUpperCase()];
    // Unmapped district (e.g. a code TREB doesn't use): show the bare code, no name.
    return hood ? { raw: value, code, name: hood } : { raw: value, name: code };
  }

  const stripped = trimmed.replace(OREB_PREFIX_RE, "").trim();
  if (stripped && stripped !== trimmed) return { raw: value, name: stripped };

  return { raw: value, name: trimmed };
}

/**
 * Primary display label. Toronto districts read "Toronto C01 · Downtown &
 * Waterfront"; Ottawa reads "Barrhaven - Half Moon Bay"; everything else is
 * returned unchanged.
 */
export function formatRegionLabel(raw: string): string {
  const parts = formatRegionParts(raw);
  return parts.code ? `${parts.code} · ${parts.name}` : parts.name;
}
