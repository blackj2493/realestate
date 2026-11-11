import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Where every signed-out ask on /dashboard goes. `next=/dashboard` maps to the
 *  "dashboard" sign-up source in loginGate, so PostHog keeps the attribution. */
export const DASHBOARD_SIGN_UP_HREF = "/login?next=%2Fdashboard";

/**
 * The one sign-up ask on the signed-out dashboard. It sits at the top, next to the
 * live market it makes personal. Nothing here is sample data: the sections below are
 * the real dashboard, scoped to `city`.
 */
export default function SignedOutBar({ city }: { city: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-cyan-600/40 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-base font-semibold text-foreground">Live {city} market. Make it yours.</p>
        <p className="mt-1 text-sm text-foreground/70">
          Pick your areas, save homes, see sold prices, and get an email when a price drops. Free.
        </p>
      </div>
      <Link
        href={DASHBOARD_SIGN_UP_HREF}
        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 bg-cyan-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-cyan-700"
      >
        Make it mine — free <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
