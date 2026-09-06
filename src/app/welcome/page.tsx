/**
 * /welcome — one-time VOW Terms acceptance gate for a signed-in user who hasn't yet
 * accepted (the dashboard server gate and requireConsumer route here when enforcement
 * is on). Bounces to /login if not signed in, or straight to `next` if already accepted.
 *
 * This is also the ONLY reliable first-run signal we have: `hasAcceptedTerms` is false
 * exactly once per account, and every sign-in funnels through here (see postSignInPath).
 * That makes it the one place where asking every new account for a starting market is
 * possible at all — so AcceptTermsForm now REQUIRES one from everybody, because an
 * account with no saved area is one the nightly digest can never mail (see that file, and
 * seedSignupRegion for where the answer is stored).
 *
 * `firstRun` no longer decides whether we ask — only where the user LANDS. A brand-new
 * account with no explicit destination goes to the map terminal, because /dashboard
 * renders almost nothing until regions are configured (DashboardClient's `hasRegions`
 * gate) and spending the highest-intent moment on a setup chore is what that change fixed.
 *
 * An EXPLICIT `next` (a gated listing teaser, /analytics, a shared compare link) still
 * wins for the destination — that user already told us where they were going, and
 * returning them there with the gate open is the strongest flow we have.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import { isFirstRunEntry } from "@/lib/auth/firstRunEntry";
import { marketSourceFromNext } from "@/lib/auth/seedMarket";
import { regionForCity } from "@/lib/dashboard/area";
import { getListingDetailCached } from "@/lib/property/getListingDetailCached";
import AcceptTermsForm from "@/components/auth/AcceptTermsForm";

export const dynamic = "force-dynamic";

/**
 * The market to SUGGEST to a listing-origin signup, inferred from where they're headed.
 *
 * Best-effort by design: it preselects nothing and decides nothing — it only puts a
 * pre-named chip at the front of the picker so a reader three clicks into one home answers
 * in one tap instead of hunting. A miss costs that convenience and nothing else, and must
 * never block terms acceptance. The listing lookup is the same cached read the listing
 * page itself just did (unstable_cache, keyed by ListingKey), so in the common flow —
 * read listing, sign up, come back — it is a warm cache hit, not a new query on the
 * critical path.
 */
async function inferSeedMarket(explicitNext: string | null): Promise<string | null> {
  const source = marketSourceFromNext(explicitNext);
  if (!source) return null;
  try {
    if (source.kind === "city") return regionForCity(source.city);
    const listing = await getListingDetailCached(source.listingKey);
    return regionForCity(listing?.city);
  } catch {
    return null;
  }
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Open-redirect guard. `null` = no destination, which is what distinguishes a signup
  // from a navigation — do NOT collapse it into the "/dashboard" default below.
  const explicitNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  // Where a user WITH a destination goes, and where an already-accepted user without
  // one goes (a returning sign-in belongs on their dashboard — it has content by then).
  const safeNext = explicitNext ?? "/dashboard";

  const user = await getCurrentUser();
  // Bounce with a bare /login when there's no destination, so the round trip back through
  // postSignInPath doesn't manufacture a `?next=/dashboard` and erase the first-run signal.
  if (!user) redirect(explicitNext ? `/login?next=${encodeURIComponent(explicitNext)}` : "/login");
  if (await hasAcceptedTerms(user.id)) redirect(safeNext);

  // Not accepted + nothing worth honouring = first-ever session: open the terminal rather
  // than `next`. See isFirstRunEntry for why /dashboard counts as "nothing". Everyone is
  // asked for a market either way — this only picks the landing page.
  const firstRun = isFirstRunEntry(explicitNext);
  // Only a destination can name a place, so a first-run entry has nothing to infer from
  // and we skip the lookup entirely rather than pay for a guaranteed null.
  const seedMarket = firstRun ? null : await inferSeedMarket(explicitNext);

  return (
    <div className="flex min-h-app flex-col bg-background text-foreground">
      <header className="px-4 py-3">
        <Link href="/" className="inline-flex items-center" aria-label="PureProperty.ca home">
          {/* "auto", not "dark": this page's ground is `bg-background`, which flips with
              the theme, so a pinned dark wordmark renders light ink on the light ground
              and disappears. Pin the shade only on permanently-one-shade surfaces. */}
          <Logo size="md" theme="auto" />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg border border-border bg-card/40 p-6">
          <h1 className="terminal-font text-center text-sm font-bold uppercase tracking-widest text-foreground">
            VOW Access Terms
          </h1>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
            One step before you can view sold data and valuations — then tell us which area
            to follow for you.
          </p>

          <div className="mt-6">
            <AcceptTermsForm next={safeNext} firstRun={firstRun} seedMarket={seedMarket} />
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
