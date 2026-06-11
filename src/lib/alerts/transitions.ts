/**
 * Watchlist status-transition classifier — pure, deterministic (§4: no LLM).
 *
 * Inputs are the nightly snapshot pair for one watched listing:
 *   prev           watchlist.last_known_status (the baseline)
 *   current        Status from the active `properties` index, or null when the
 *                  doc is gone (PR #19 deletes sold/terminal docs from that index)
 *   soldHit        the listing was found in `sold_listings` with DealType 'sold'
 *   fallbackStatus listings.full_payload->>'MlsStatus' (Supabase vault, vanished docs only)
 *
 * Returns the alertable event, or null for routine churn / already-resolved rows.
 */

export type StatusAlertKind = "sold" | "sold-conditional" | "off-market" | "back-on-market" | "gone";

export interface StatusEvent {
  kind: StatusAlertKind;
  /** Off-market reason as spelled by the feed (Terminated / Expired / Suspended). */
  detail?: string;
}

// Same spellings the sync's stale-doc sweep recognizes (staleSearchDocs NON_ACTIVE_STATUSES),
// duplicated here so this module stays importable from both src and scripts without
// reaching into worker internals.
const TERMINAL = new Set(["sold", "closed", "closed sale", "leased", "terminated", "expired", "suspended"]);
const SOLD_SPELLINGS = new Set(["sold", "closed", "closed sale"]);

/** Synthetic baseline written when a vanish has no explanation; treated as resolved. */
const UNAVAILABLE = "unavailable";

const norm = (s: string | null | undefined): string => (s ?? "").toLowerCase().trim();

export function isTerminalStatus(s: string | null | undefined): boolean {
  return TERMINAL.has(norm(s));
}

/** Resolved = we already alerted (or decided not to) for this disappearance. */
function isResolvedBaseline(prev: string | null): boolean {
  const n = norm(prev);
  return TERMINAL.has(n) || n === UNAVAILABLE;
}

export interface ClassifyInput {
  prev: string | null;
  current: string | null; // null = vanished from the active index
  soldHit: boolean;
  fallbackStatus: string | null;
}

export function classifyStatusChange({
  prev,
  current,
  soldHit,
  fallbackStatus,
}: ClassifyInput): StatusEvent | null {
  const p = norm(prev);

  if (current != null) {
    const c = norm(current);
    if (!p || c === p) return null; // no baseline yet, or no change
    if (isResolvedBaseline(prev) && !TERMINAL.has(c)) return { kind: "back-on-market" };
    if (c.includes("sold conditional") && !p.includes("sold conditional")) return { kind: "sold-conditional" };
    return null; // routine churn (New → Price Change, Extension, …) — baseline refresh only
  }

  // Vanished from the active index.
  if (!p || isResolvedBaseline(prev)) return null; // nothing to compare, or already handled
  if (soldHit || SOLD_SPELLINGS.has(norm(fallbackStatus))) return { kind: "sold" };
  if (isTerminalStatus(fallbackStatus)) return { kind: "off-market", detail: fallbackStatus!.trim() };
  return { kind: "gone" };
}

/**
 * Baseline string to persist on the watchlist row so this event never re-fires.
 * null ⇒ persist the live index status instead (in-index transitions).
 */
export function resolvedBaseline(event: StatusEvent): string | null {
  if (event.kind === "sold") return "Sold";
  if (event.kind === "off-market") return event.detail ?? "Terminated";
  if (event.kind === "gone") return "Unavailable";
  return null;
}
