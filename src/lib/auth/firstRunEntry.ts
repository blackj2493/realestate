/**
 * Whether a not-yet-accepted account arriving at /welcome should be treated as a SIGNUP
 * (offer the market picker, open the map terminal) rather than a navigation (honour
 * `next`).
 *
 * Split out of /welcome so the rule is testable on its own. It decides two visible
 * behaviours at once — whether the market chips appear, and whether the user lands in the
 * terminal or on `next` — and getting it wrong is silent: the user simply ends up on an
 * empty dashboard with no picker, which is exactly the bug this exists to prevent.
 *
 * /dashboard used to count as "no destination" here, because a new account's dashboard
 * was empty. Since 2026-11 it is not: a signed-out visitor sees the real dashboard (for
 * Toronto) and signs up from it, and the Terms form saves the area they pick, so the
 * dashboard they return to is already filled. A bare /login now carries no `next` at all
 * (login/page.tsx), so "/dashboard" can only mean the visitor asked for it.
 */

/**
 * @param explicitNext A validated relative path the user was headed to, or null when the
 *   sign-in carried no destination at all (see postSignInPath, which emits a bare
 *   /welcome precisely so this distinction survives).
 */
export function isFirstRunEntry(explicitNext: string | null): boolean {
  return explicitNext === null;
}
