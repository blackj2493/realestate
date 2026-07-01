/**
 * Basement status label — the raw TRREB basement value(s), joined for display.
 *
 * Single source of truth so the /properties/[id] hero spec row, the Quick Look
 * drawer, and the Command Center listing cards all render basement identically.
 * Mirrors the data-sheet "Basement" row (datasheet.ts `list`/`joined`).
 *
 * Two surfaces, two field names for the *same* TRREB tokens:
 *   • `Basement`     — the full VOW payload (detail page).
 *   • `BasementType` — the Typesense index field (faceted for search; what the
 *                      map/ledger cards and Quick Look drawer carry in memory).
 * We read whichever is populated, preferring `Basement`.
 *
 * TRREB stores one or more free-text tokens (e.g. ["Finished","Walk-Out"],
 * ["Part Fin","Sep Entrance"]); condos/apartments leave it empty. Pure (no
 * React, no "use client") so Server Components can import it.
 *
 * Returns "None" when there's no basement data so spec grids stay symmetric
 * rather than rendering an empty cell.
 */
export interface BasementInfo {
  /** Full VOW payload field (/properties/[id] detail page). */
  Basement?: string[] | string | null;
  /** Typesense index field — same TRREB tokens, faceted for search. */
  BasementType?: string[] | string | null;
}

function tokens(raw: string[] | string | null | undefined): string[] {
  return (Array.isArray(raw) ? raw : raw != null ? [raw] : [])
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);
}

export function basementLabel(p: BasementInfo): string {
  // Prefer the detail-payload field; fall back to the index field when the
  // former is absent or empty (e.g. a card fed by a Typesense doc).
  const primary = tokens(p.Basement);
  const use = primary.length > 0 ? primary : tokens(p.BasementType);
  return use.length > 0 ? use.join(" · ") : "None";
}
