/**
 * /welcome — one-time VOW Terms acceptance gate for a signed-in user who hasn't yet
 * accepted (the dashboard server gate and requireConsumer route here when enforcement
 * is on). Bounces to /login if not signed in, or straight to `next` if already accepted.
 *
 * This is also the ONLY reliable first-run signal we have: `hasAcceptedTerms` is false
 * exactly once per account, and every sign-in funnels through here (see postSignInPath).
 * So when a brand-new account arrives with NO explicit destination, we treat it as a
 * signup rather than a navigation and hand AcceptTermsForm the first-run flow — pick one
 * market, land in the map terminal. Previously every such user was dropped on /dashboard,
 * which renders almost nothing until regions are configured (see DashboardClient's
 * `hasRegions` gate), so the highest-intent moment was spent on a setup chore.
 *
 * An EXPLICIT `next` (a gated listing teaser, /analytics, a shared compare link) always
 * wins — that user already told us where they were going, and returning them there with
 * the gate open is the strongest flow we have. Only intent-less signups get redirected.
 */

import { redirect } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import { isFirstRunEntry } from "@/lib/auth/firstRunEntry";
import AcceptTermsForm from "@/components/auth/AcceptTermsForm";

export const dynamic = "force-dynamic";

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

  // Not accepted + nothing worth honouring = first-ever session: offer the market seed
  // and open the terminal. See isFirstRunEntry for why /dashboard counts as "nothing".
  const firstRun = isFirstRunEntry(explicitNext);

  return (
    <div className="flex min-h-app flex-col bg-background text-foreground">
      <header className="px-4 py-3">
        <Link href="/" className="inline-flex items-center" aria-label="PureProperty.ca home">
          <Logo size="md" theme="dark" />
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-lg border border-border bg-card/40 p-6">
          <h1 className="terminal-font text-center text-sm font-bold uppercase tracking-widest text-foreground">
            VOW Access Terms
          </h1>
          <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
            {firstRun
              ? "One step before you can view sold data and valuations — then pick where you want to start."
              : "One step before you can view sold data and valuations. Confirm the following to unlock the terminal."}
          </p>

          <div className="mt-6">
            <AcceptTermsForm next={safeNext} firstRun={firstRun} />
          </div>
        </div>
      </div>

      <footer className="py-4 text-center text-[11px] text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
