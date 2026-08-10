/**
 * How a property RECORD (a sold / leased / off-market campaign) presents itself in a
 * search dropdown — one definition shared by both search bars.
 *
 * The terminal bar and the header bar each used to spell this out for themselves, which
 * is how they drifted: the header rendered a listing-less record as a generic "Profile"
 * tag while the terminal showed a coloured OFF MARKET chip for the same record. Anything
 * that describes a record's status belongs here so the two surfaces cannot disagree
 * again.
 */

import type { AddressRecordResponse } from "./types";

export type RecordKind = AddressRecordResponse["dealKind"];

/** Row chip text per public status kind (audit R24a — the kind is public, the price isn't). */
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  sold: "SOLD",
  leased: "LEASED",
  offmarket: "OFF MARKET",
};

/** Chip colours, theme-aware in both directions (never a bare dark-only token). */
export const RECORD_KIND_TONE: Record<RecordKind, string> = {
  sold: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
  leased: "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  offmarket: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

/** Epoch (UTC-midnight, date-only) → "Jul 21, 2026". Rendered in UTC — a local-time
 *  render shifts these dates back a day for every Canadian viewer (audit MEDIUM-18). */
export function formatRecordDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "$1,625,000" — close prices and asking prices alike. */
export function formatRecordPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

/**
 * The "this home is listed again" line shown under a record whose address currently has
 * a live campaign. Plain language on purpose — it appears in the app header, which is
 * the one search surface a brand-new visitor meets before they know the terminal's
 * vocabulary.
 */
export function backOnMarketLabel(livePrice?: number, transactionType?: string): string {
  const lease = /lease|rent/i.test(transactionType ?? "");
  const verb = lease ? "For rent again" : "Back on the market";
  if (!livePrice || livePrice <= 0) return verb;
  return `${verb} — ${formatRecordPrice(livePrice)}${lease ? "/mo" : ""}`;
}
