/**
 * The narrowing question asked beside the market at signup, and the only thing that can
 * make a brand-new city alert row genuinely filtered.
 *
 * WHY THIS EXISTS. `defaultAlertScopeForRegion` already tries to protect a new user: a
 * WHOLE CITY takes `alert_scope = 'filtered'` rather than 'all'. It cannot work, and its
 * own comment says so — 'filtered' over an empty lens emits no clauses, so the worker falls
 * back to the bare price floor and delivers exactly what 'all' delivers. A brand-new user's
 * lens is empty by definition, so the guard has never protected the one person it was
 * written for.
 *
 * Measured across production on 2026-09-21, of 397 alert-enabled areas:
 *
 *   'filtered' over a DEFAULT lens .... 196 ... 49.4%   ← the guard, doing nothing
 *   scope 'all' ...................... 131 ... 33.0%
 *   actually narrows .................. 70 ... 17.6%
 *
 * 82.4% of saved areas send everything. Toronto enters ~268 new listings a night, and the
 * readers who follow one unfiltered area and never came back unsubscribe at 27.8% — 45% of
 * all churn, from 21% of the accounts. The lens is the only thing that can change that at
 * the moment the area is chosen, and signup is the one moment every account passes through.
 *
 * WHAT IT CAN AND CANNOT ASK. MarketActivityLens carries no price field — a city row stores
 * `{ lens }` and buildLensClauses has nothing to say about price — so "your budget", the
 * most natural question to ask a buyer, is not expressible here and is NOT asked. Asking it
 * and then ignoring it would be worse than not asking. Home type and bedrooms are what the
 * lens can actually enforce, and they are enough: a probe on Brampton put 7 days at 239
 * listings unfiltered against 83 for "4+ bd detached".
 *
 * IT IS OPTIONAL, deliberately. The area question is mandatory because an account without
 * one can never be mailed at all; this one only changes how much. A second required field
 * on the last screen of the funnel buys a narrower list at the cost of accounts, and the
 * copy beside it says plainly what skipping means, so the default is informed rather than
 * hidden.
 */

import { PROPERTY_TYPE_OPTIONS } from "./propertyTypes";
import { DEFAULT_ACTIVITY_LENS, type MarketActivityLens } from "./config";

/** Bedrooms the chips offer. 0 is "any" and is stored as no constraint. */
export const SIGNUP_BED_CHOICES = [0, 1, 2, 3, 4] as const;

const MAX_BEDS = SIGNUP_BED_CHOICES[SIGNUP_BED_CHOICES.length - 1];
const VALID_TYPE_KEYS = new Set(PROPERTY_TYPE_OPTIONS.map((o) => o.key));

export interface SignupFilter {
  /** PROPERTY_TYPE_OPTIONS keys; [] means no type constraint. */
  propertyTypes: string[];
  /** Minimum bedrooms; 0 means no constraint. */
  minBeds: number;
}

/**
 * Validate what the client sent, or null when it narrows nothing.
 *
 * NULL IS THE ORDINARY ANSWER, not an error: it covers a reader who skipped the question, a
 * client bundle from before this shipped, and a payload whose values all mean "any". Every
 * one of those should behave exactly as signup behaved yesterday, so the caller treats null
 * as "no filter" rather than as something to report.
 *
 * Unknown type keys are DROPPED rather than rejected. The option list is data that changes,
 * and a stale client sending one retired key should still get the filter it can express —
 * whereas a 400 would fail a Terms acceptance over a chip label.
 */
export function cleanSignupFilter(raw: unknown): SignupFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { propertyTypes?: unknown; minBeds?: unknown };

  const propertyTypes = Array.isArray(r.propertyTypes)
    ? [...new Set(r.propertyTypes.filter((k): k is string => typeof k === "string" && VALID_TYPE_KEYS.has(k)))]
    : [];

  const rawBeds = typeof r.minBeds === "number" && Number.isFinite(r.minBeds) ? Math.floor(r.minBeds) : 0;
  const minBeds = Math.min(Math.max(rawBeds, 0), MAX_BEDS);

  // Nothing to enforce. Returning null here is what keeps hasActiveLensFilters false and
  // the behaviour identical to a signup that never saw this question.
  if (propertyTypes.length === 0 && minBeds === 0) return null;

  return { propertyTypes, minBeds };
}

/**
 * Is this lens still exactly the default?
 *
 * The test for "nobody has chosen anything yet", and the condition under which a signup
 * answer may be written into a workspace that already exists. Compared FIELD BY FIELD
 * against DEFAULT_ACTIVITY_LENS rather than by JSON.stringify — Postgres jsonb re-orders
 * keys, so a stringify compare reports a difference that is not there.
 */
export function isDefaultLens(lens: MarketActivityLens): boolean {
  const d = DEFAULT_ACTIVITY_LENS;
  return (
    lens.windowDays === d.windowDays &&
    lens.transactionType === d.transactionType &&
    lens.propertyTypes.length === 0 &&
    lens.minBeds === d.minBeds &&
    lens.bedsExact === d.bedsExact &&
    lens.minBaths === d.minBaths &&
    lens.bathsExact === d.bathsExact &&
    lens.minGarage === d.minGarage &&
    lens.garageExact === d.garageExact &&
    lens.basement === d.basement &&
    lens.minFrontage === d.minFrontage
  );
}

/**
 * Write a signup answer into a lens.
 *
 * Only the two fields the question asked about are touched; `windowDays`, transaction type
 * and every other constraint keep whatever the lens already carried. `bedsExact` is forced
 * false because the chips read "3+", and storing an exact match under a "+" label would
 * quietly deliver something other than what the reader agreed to.
 */
export function applySignupFilter(
  lens: MarketActivityLens,
  filter: SignupFilter
): MarketActivityLens {
  return {
    ...lens,
    propertyTypes: filter.propertyTypes,
    minBeds: filter.minBeds,
    bedsExact: false,
  };
}
