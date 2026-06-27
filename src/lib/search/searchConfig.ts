/**
 * Search V2 — master switches for the search overhaul (categorized federated
 * suggest, natural-language chips, map fly-to, persona ranking, recents/watched).
 *
 * The whole feature lives behind SEARCH_V2_ENABLED so it can be reverted without
 * touching the legacy LocationSearch path: ship the `feat/search-v2` branch with
 * the flag on, or set NEXT_PUBLIC_SEARCH_V2=0 to fall back to the old bar at runtime.
 */

/** Build-time flag (NEXT_PUBLIC_* is inlined). Defaults ON for this branch. */
export const SEARCH_V2_ENABLED =
  (process.env.NEXT_PUBLIC_SEARCH_V2 ?? "1") !== "0";

/**
 * VOW / legal gate. Sold *prices* are never rendered to anonymous users in the
 * search surfaces (suggest rows, answer-card medians, comps). Existence + date may
 * show — the masked price is the sign-up hook, not a wall. Per the advisory verdict
 * (run WRITTEN-NO until the legal memo clears), keep this TRUE.
 */
export const SOLD_PRICE_GATED = true;

/** Min query length before we hit the network for suggestions. */
export const SUGGEST_MIN_CHARS = 2;

/** Debounce (ms) for the suggest typeahead. */
export const SUGGEST_DEBOUNCE_MS = 180;
