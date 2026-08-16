/**
 * Whether a not-yet-accepted account arriving at /welcome should be treated as a SIGNUP
 * (offer the market picker, open the map terminal) rather than a navigation (honour
 * `next`).
 *
 * Split out of /welcome so the rule is testable on its own. It decides two visible
 * behaviours at once — whether the market chips appear, and whether the user lands in the
 * terminal or on `next` — and getting it wrong is silent: the user simply ends up on an
 * empty dashboard with no picker, which is exactly the bug this exists to prevent.
 */

/**
 * Destinations that are MEANINGLESS for a brand-new account.
 *
 * /dashboard renders almost nothing until regions are configured (DashboardClient's
 * `hasRegions` gate). An anonymous visitor clicking "Dashboard" in the nav is bounced
 * through /login?next=/dashboard and arrives here carrying that as an explicit
 * destination — but a first-ever account has no dashboard to go to. Honouring it lands
 * them on a blank page with a setup form, which is the whole problem.
 *
 * /analytics is deliberately NOT in this set: it carries its own region selector and
 * renders fine for a new account, so a user who asked for it should get it.
 */
const EMPTY_FOR_NEW_ACCOUNTS: ReadonlySet<string> = new Set(["/dashboard"]);

/** Strip any query/hash so "/dashboard?tab=x" is still recognised as the dashboard. */
function pathOf(dest: string): string {
  const cut = dest.search(/[?#]/);
  return cut === -1 ? dest : dest.slice(0, cut);
}

/**
 * @param explicitNext A validated relative path the user was headed to, or null when the
 *   sign-in carried no destination at all (see postSignInPath, which emits a bare
 *   /welcome precisely so this distinction survives).
 */
export function isFirstRunEntry(explicitNext: string | null): boolean {
  if (explicitNext === null) return true;
  return EMPTY_FOR_NEW_ACCOUNTS.has(pathOf(explicitNext));
}
