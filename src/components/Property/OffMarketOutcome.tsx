import Link from "next/link";
import { Lock, Clock, Gauge, ArrowRight } from "lucide-react";
import { LiveDealScoreBadge } from "@/components/Property/LiveDealScore";
import type { DealPersona, DealScoreResult } from "@/lib/dealScore/computeDealScore";

/**
 * OffMarketOutcome — the decoded "how this played out" strip for a sold, leased or
 * off-market (delisted) listing.
 *
 * Once a listing leaves the market the rest of the page hides its two most decoded
 * signals — the relisting-adjusted True DOM and the Deal Score are surfaced ONLY
 * for active listings (page.tsx). For a sold/leased/off-market home those are
 * exactly the retrospective questions a landing visitor has ("how long did it
 * really take? was it priced as a good deal?"), so we surface them here and bridge
 * to the address's full Home Pulse dossier (street pulse, sold history, "if listed
 * today", nearby active — all already built at /address).
 *
 * Deal Score is a PURCHASE metric, so its cell is omitted for leases; True DOM and
 * the "homes for sale nearby" forward-path apply to every off-market page (leased
 * rentals get the same dead-end and SEO traffic).
 *
 * The forward-path is the area's live for-sale inventory (the city/community hub),
 * NOT the /address dossier: for an off-market record whose listing row survives
 * (i.e. every record that reaches this page), the address ladder resolves back to
 * this same listing URL, so an /address link would just loop. The hub is a distinct
 * page and serves the "missed buyer" who wants what's actually available near here.
 *
 * VOW-safe: the caller passes `trueDom={null}` and the already-gated (EMPTY)
 * `dealScore` for anonymous visitors, so no VOW-derived number can reach an
 * anonymous DOM here — anon sees locked cells + a free sign-in. The hub is a
 * public link, shown to everyone.
 */

/** Locked placeholder for a VOW value an anonymous visitor can't see. Module-scope on
 *  purpose — defining it inside the render body re-creates a component every render
 *  (react-hooks "Cannot create components during render"); it closes over nothing. */
function LockedValue() {
  return (
    <span className="mt-1 inline-flex items-center gap-1 font-mono text-lg font-bold text-muted-foreground">
      <Lock className="h-3.5 w-3.5" /> —
    </span>
  );
}

export default function OffMarketOutcome({
  kind,
  isLease,
  isAuthed,
  nearbyHref,
  trueDom,
  hasTrueDom,
  dealScore,
  hasDealScore,
  initialLens,
}: {
  kind: "sold" | "delisted";
  isLease: boolean;
  isAuthed: boolean;
  /** Live for-sale inventory near here (the city/community hub); null to hide. */
  nearbyHref: string | null;
  /** Resolved True DOM — the caller passes null for anon (VOW gate); never rendered for anon. */
  trueDom: number | null;
  /** Ungated flag — is there a days-on-market figure to reveal at all. */
  hasTrueDom: boolean;
  /** Already VOW-gated on the server (EMPTY_DEAL_SCORE for anon). */
  dealScore: DealScoreResult;
  /** Ungated flag — only tease the locked score where a real one exists. */
  hasDealScore: boolean;
  initialLens: DealPersona;
}) {
  const showScore = hasDealScore && !isLease;
  const headline =
    kind === "delisted" ? "Before it came off the market" : "How this one played out";
  const signInLabel = isLease
    ? "See the full leasing history — free"
    : kind === "sold"
      ? "See how it sold — free"
      : "Unlock the full history — free";

  // Nothing to say and nowhere to go → render nothing.
  if (!hasTrueDom && !showScore && !nearbyHref) return null;

  return (
    <div className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-4">
      <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
        {headline}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {/* True DOM — relisting-adjusted; hidden on off-market pages until now. */}
        {hasTrueDom && (
          <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
            <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Clock className="h-3 w-3" /> True days on market
            </p>
            {isAuthed && trueDom != null ? (
              <p className="mt-1 font-mono text-lg font-bold text-foreground">{trueDom}d</p>
            ) : (
              <LockedValue />
            )}
            <p className="mt-0.5 text-[10px] text-muted-foreground">relisting-adjusted</p>
          </div>
        )}

        {/* Deal Score — the retrospective "was it a good deal at its ask?". Purchase only. */}
        {showScore && (
          <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
            <p className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              <Gauge className="h-3 w-3" /> Deal score at ask
            </p>
            {isAuthed ? (
              <div className="mt-1">
                <LiveDealScoreBadge dealScore={dealScore} initialLens={initialLens} />
              </div>
            ) : (
              <LockedValue />
            )}
            <p className="mt-0.5 text-[10px] text-muted-foreground">for the Homebuyer lens</p>
          </div>
        )}

        {/* Forward-path — public, shown to everyone. The area's live for-sale
            inventory (city/community hub), for the visitor who wants what's actually
            available near here. A distinct page, so it never loops back. */}
        {nearbyHref && (
          <Link
            href={nearbyHref}
            className="group flex flex-col justify-between rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2.5 transition-colors hover:bg-cyan-500/20"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
              Nearby
            </p>
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-cyan-700 dark:text-cyan-200">
              Homes for sale
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        )}
      </div>

      {!isAuthed && (showScore || hasTrueDom) && (
        <Link
          href="/login"
          className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-cyan-500 bg-cyan-500/10 px-4 text-sm font-bold text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
        >
          <Lock className="h-4 w-4" />
          {signInLabel}
        </Link>
      )}
    </div>
  );
}
