/**
 * Signup intent — "What brings you here?", asked once on /welcome and stored in
 * `profiles.signup_intent` (jsonb). Pure: no React, no network.
 *
 * WHY. Until 2026-11 the column existed and was empty for every account (689 of 689), so
 * nothing downstream could tell a buyer from a seller from a renter. One tap at the one
 * screen every account passes through fixes that.
 *
 * A seller may also name their home. That address only decides where they land (their
 * /address page) and is kept so a later session can open the same page; it is never
 * required and never fails the Terms acceptance.
 */

export const SIGNUP_GOALS = [
  { id: "buying", label: "Buying a home" },
  { id: "selling", label: "Selling a home" },
  { id: "investing", label: "Investing" },
  { id: "renting", label: "Renting" },
  { id: "researching", label: "Just researching" },
] as const;

export type SignupGoal = (typeof SIGNUP_GOALS)[number]["id"];

export interface SignupIntent {
  goal: SignupGoal;
  /** Sellers only, optional: the home they named, as typed or picked. */
  address?: string;
}

const GOAL_IDS = new Set<string>(SIGNUP_GOALS.map((g) => g.id));
const MAX_ADDRESS = 200;

export function isSignupGoal(v: unknown): v is SignupGoal {
  return typeof v === "string" && GOAL_IDS.has(v);
}

/**
 * Validate a client-sent intent. Anything unusable becomes null — the caller stores
 * nothing and carries on, because failing a Terms acceptance over this answer would cost
 * an account to save a label.
 */
export function cleanSignupIntent(raw: unknown): SignupIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isSignupGoal(r.goal)) return null;
  const out: SignupIntent = { goal: r.goal };
  if (r.goal === "selling" && typeof r.address === "string") {
    const a = r.address.replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS);
    if (a.length >= 5) out.address = a;
  }
  return out;
}
