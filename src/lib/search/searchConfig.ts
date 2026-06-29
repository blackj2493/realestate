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

/** Min query length before we hit the network for suggestions. 3 (not 2) avoids a
 *  burst of low-value queries on the first couple keystrokes of every word. */
export const SUGGEST_MIN_CHARS = 3;

/** Debounce (ms) for the suggest typeahead. Deliberately unhurried (350ms) so fast
 *  typing fires ONE query on the pause, not one per keystroke — this keeps the
 *  per-host connection pool free for the main listings/map query, which shares the
 *  same Typesense origin and must never be starved by typeahead churn. */
export const SUGGEST_DEBOUNCE_MS = 350;

/**
 * Dev-only parse diagnostics: a tiny overlay in the suggest panel showing how many
 * chips were read and which words went unmatched — so the parser's real miss-rate is
 * visible while testing. Defaults ON in dev, OFF in prod; force with
 * NEXT_PUBLIC_SEARCH_DEBUG=1/0.
 */
export const SEARCH_DEBUG =
  (process.env.NEXT_PUBLIC_SEARCH_DEBUG ?? (process.env.NODE_ENV !== "production" ? "1" : "0")) !== "0";
