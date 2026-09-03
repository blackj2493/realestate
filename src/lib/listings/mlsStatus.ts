/**
 * mlsStatus — the ONE place a TRREB `MlsStatus` string is interpreted for display.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Status was decided in two independent places that did not share a vocabulary:
 * `statusBadge()` (browse cards) knew about conditional sales, and
 * `resolveListingStatus()` (the listing detail page) did not — it matched
 * `mls === "sold"` exactly, so "Sold Conditional" missed every branch and fell
 * through to `{ kind: "active" }`.
 *
 * The result was a listing that read "Sold Cond." on its search card and, one
 * click later, rendered a clean For Sale page with a live "Book a viewing" CTA.
 * N13642346 (11 Elizabeth St, Markham) is the case this was built for. No sync
 * net could ever have caught it: the feed still serves these listings as
 * StandardStatus=Active (~2,424 live on 2026-06-03), the payload in `listings`
 * is current and correct, and it is the render layer that drops the status.
 *
 * So: both surfaces classify through `classifyMlsStatus` and can no longer
 * disagree about what a status string means.
 *
 * IDX-class only — this module reads a status STRING and never a close price or
 * a close date, so nothing here is VOW Listing Information and nothing here is
 * gated. Terminal statuses are recognised for completeness, but the authority on
 * what LEAVES the search index stays `NON_ACTIVE_STATUSES` in
 * scripts/worker/staleSearchDocs.ts (the ingest contract, deliberately separate).
 */

export type MlsStatusClass =
  /** New / Active / Price Change / Extension — ordinary available inventory. */
  | "plain-active"
  /** Sold Conditional (+ Escape Clause): under contract, conditions NOT yet waived. */
  | "sale-conditional"
  /** Leased Conditional (+ Escape Clause): the lease equivalent. */
  | "lease-conditional"
  /** Deal Fell Through: a collapsed firm sale, back on market. */
  | "back-on-market"
  /** Sold — firm. */
  | "sold"
  /** Leased — firm. */
  | "leased"
  /** Terminated / Expired / Suspended — the campaign ended without a deal. */
  | "terminal"
  /** Anything the board sends that we do not recognise. Never assume it is active. */
  | "other";

const PLAIN_ACTIVE = new Set(["new", "active", "price change", "extension", ""]);
const TERMINAL = new Set(["terminated", "expired", "suspended"]);

/**
 * Classify a raw `MlsStatus`. Case- and whitespace-insensitive.
 *
 * Conditionals are matched by PREFIX on purpose: TRREB ships several escape-clause
 * variants ("Sold Conditional Escape Clause", "Sold Conditional Escape") and a new
 * one must not silently regress to "other".
 */
export function classifyMlsStatus(status: string | null | undefined): MlsStatusClass {
  const s = (status ?? "").toLowerCase().trim();
  if (PLAIN_ACTIVE.has(s)) return "plain-active";
  if (s.startsWith("sold conditional")) return "sale-conditional";
  if (s.startsWith("leased conditional")) return "lease-conditional";
  if (s === "deal fell through") return "back-on-market";
  if (s === "sold") return "sold";
  if (s === "leased") return "leased";
  if (TERMINAL.has(s)) return "terminal";
  return "other";
}

/** A conditional sale or lease — under contract, but the deal is not firm yet. */
export function isConditionalClass(cls: MlsStatusClass): boolean {
  return cls === "sale-conditional" || cls === "lease-conditional";
}

/**
 * Title-Case a board status for verbatim display ("SOLD CONDITIONAL" → "Sold Conditional").
 * Used for statuses we recognise but have no dedicated copy for.
 */
export function titleCaseStatus(status: string | null | undefined): string {
  return (status ?? "").trim().replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}
