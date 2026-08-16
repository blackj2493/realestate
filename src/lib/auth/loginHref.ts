/**
 * The sign-in URL for a gated surface, carrying the page the visitor is standing on so
 * they come back to it once they're in.
 *
 * This is the second half of the contract postSignInPath/isFirstRunEntry already
 * describe. Those two are careful to distinguish "the user had a specific destination"
 * from "the user just signed in" — but that distinction only survives if the LINK
 * supplies the destination in the first place. A bare `/login` is not neutral: the login
 * page defaults `next` to /dashboard, isFirstRunEntry reads /dashboard as "no
 * destination", and a brand-new account is routed into the map terminal. So a locked
 * card on a listing page that links to a bare `/login` silently sends the one visitor
 * with the clearest intent we ever get — someone who wants THIS home's sold price — to a
 * province-wide map instead of back to the home they asked about.
 *
 * Nothing errors and nothing looks broken, which is why this survived so long. Route
 * every gated CTA through here (or <SignInLink>, which applies it to the current path).
 */

/**
 * @param pathname Where the visitor is now — usually `usePathname()`, or a path built
 *   server-side. Include a query string only when it is load-bearing (e.g. the compare
 *   shortlist `?ids=`); `usePathname()` omits it, which is the right default.
 * @returns `/login?next=<encoded>`, or a bare `/login` when there is nothing safe to
 *   return to — in which case the first-run signup path deliberately takes over.
 */
export function loginHref(pathname: string | null | undefined): string {
  // Open-redirect guard, matching postSignInPath: relative, single-slash paths only.
  // Anything else (absent, absolute, protocol-relative) counts as "no destination".
  const safe = pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : null;
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}
