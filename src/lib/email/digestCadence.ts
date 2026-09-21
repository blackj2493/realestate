/**
 * How often the nightly digest should send when the reader has not said.
 *
 * WHY THIS EXISTS (measured 2026-09-21, 453 real accounts, 60 unsubscribed).
 * The lifetime opt-out rate is 13.2%, but it is not one number:
 *
 *   1 saved area, and it is Toronto ... 97 users ... 27.8%
 *   1 saved area, another city ....... 99 users ... 15.2%
 *   2+ areas, includes Toronto ....... 16 users .... 6.3%
 *   2+ areas, no Toronto ............. 33 users .... 6.1%
 *
 * Both effects are real and they point in different directions. Holding the area count at
 * one, Toronto nearly doubles the rate — that is volume, ~268 new listings a night. Holding
 * Toronto constant, a second area collapses it from 27.8% to 6.3%. And among readers with
 * two or more areas Toronto makes no difference at all (6.3% against 6.1%): **the firehose
 * only burns people who never came back**. 97 users, 21% of the base, produce 45% of all
 * churn.
 *
 * Recency says the same thing from another angle. By `dashboard_prefs.updated_at`, opt-out
 * runs 8.5% for a workspace written inside 7 days, 22.9% at 7-30 days, 30.3% past 30.
 *
 * SO THE RULE IS NOT "TORONTO IS TOO BIG". It is: a reader who saved exactly one area, never
 * narrowed it, and has not touched the product in a week is being sent a nightly email about
 * a market they picked in a signup form. Those three conditions together are what predicts
 * the unsubscribe; none of them alone is enough to act on.
 *
 * WHAT MIGRATION 144 SAID, AND WHY THIS DOES NOT CONTRADICT IT. 144 refused to flip anyone
 * server-side: "a change the user did not ask for and cannot see reads as broken delivery,
 * not as courtesy." That reasoning is correct and it is the constraint this module is built
 * under, not an objection it walks past. Hence two hard requirements on every caller:
 *
 *   1. A DERIVED cadence must be SAID in the email — which week it covers, why it is weekly,
 *      and what to press for nightly. Invisible is the failure mode 144 named.
 *   2. An EXPLICIT choice always wins, in both directions, forever.
 *
 * A derived weekly is a default, not a preference. It never writes to `email_prefs`.
 */

import type { AlertsFrequency } from "./sendPolicy";

/** Days a workspace may sit untouched before a single unfiltered area stops sending nightly. */
export const DORMANT_WORKSPACE_DAYS = 7;

/** Above this many saved areas the reader has shown intent; never derive a cap. */
export const ENGAGED_AREA_COUNT = 2;

const DAY_MS = 86_400_000;

export interface DigestCadenceInput {
  /** How many alert-enabled areas this reader owns. */
  areaCount: number;
  /**
   * Does ANY of those areas actually narrow what it sends?
   *
   * Read from the same `filterLabel` the digest renders, never from `alert_scope`: 196 of
   * 397 enabled rows carry scope 'filtered' over a DEFAULT lens, which runs the identical
   * query to 'all'. The column cannot answer this question — see hasActiveLensFilters.
   */
  anyFilteredArea: boolean;
  /**
   * Milliseconds since `dashboard_prefs.updated_at`, or null when the reader has no row.
   *
   * Null counts as dormant: every signup since PR #511 writes this row at acceptance, so a
   * missing one means an account that predates it and has not been back since.
   */
  workspaceAgeMs: number | null;
  /** The reader's own choice, or null when they have never made one. */
  chosen: AlertsFrequency | null;
}

export type CadenceReason =
  /** The reader chose this. */
  | "chosen"
  /** One unfiltered area, workspace untouched — the 27.8% cell. */
  | "dormant_single_unfiltered_area"
  /** Nothing applies; the digest sends nightly. */
  | "default";

export interface DigestCadence {
  frequency: AlertsFrequency;
  reason: CadenceReason;
  /** True when the email MUST explain itself and offer the way back to nightly. */
  derived: boolean;
}

/**
 * The cadence this reader gets tonight.
 *
 * Pure, so the rule can be tested without a database and argued about without reading the
 * worker. Fail-OPEN throughout: anything unclear sends nightly, because the cost of a
 * wrongly-capped reader is an email they wanted and did not get.
 */
export function digestCadence(i: DigestCadenceInput): DigestCadence {
  // An explicit choice is final, in both directions. A reader who pressed "Go back to a
  // nightly email" must not be re-capped by a rule they already overruled.
  if (i.chosen) return { frequency: i.chosen, reason: "chosen", derived: false };

  const dormant =
    i.workspaceAgeMs === null || i.workspaceAgeMs >= DORMANT_WORKSPACE_DAYS * DAY_MS;

  if (i.areaCount === 1 && !i.anyFilteredArea && dormant) {
    return { frequency: "weekly", reason: "dormant_single_unfiltered_area", derived: true };
  }

  return { frequency: "daily", reason: "default", derived: false };
}
