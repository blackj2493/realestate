/**
 * Brand-name constants — the single source of truth for user-facing product
 * names, so a rename is one edit here and the strings can't drift across
 * surfaces (e.g. the ledger HUD vs. the sidebar status badge).
 *
 * Rule of thumb: keep REAL third-party vendor names (Typesense, Supabase,
 * Mapbox, …) OUT of the product UI — reference these brand names instead. The
 * one deliberate exception is the privacy policy's sub-processor disclosure,
 * which must name the actual vendors for legal accuracy.
 */

/** Branded name for the listing search engine (powered internally by Typesense). */
export const SEARCH_BRAND = "PureSearch";
