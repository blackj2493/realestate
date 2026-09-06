"use client";

/**
 * AcceptTermsForm — the one-time VOW Terms acceptance for a signed-in user. Posts to
 * /api/vow/accept-terms, then returns the user to where they were headed (`next`).
 * Mirrors the §3 attestations on /apply, but for an authenticated account.
 *
 * IT ALSO REQUIRES ONE STARTING MARKET, from every account, with no way past it.
 *
 * Why it is mandatory. A saved area is the only thing that makes an account reachable:
 * the nightly worker builds a digest for a user who owns a watchlist row or a city alert
 * row and nobody else, so an account with no area gets no mail, ever. The market chips
 * used to be optional, with the answer defaulting silently to Toronto — and the answer
 * only reached localStorage anyway, so even a deliberate tap subscribed nobody. Asking
 * plainly, once, at the one moment every account passes through is the cheapest honest
 * way to earn permission to write to someone.
 *
 * Why it is asked of EVERYONE, including a signup that arrived from a listing. We can
 * often infer that reader's city (see seedMarket.ts) and we still do — it becomes the
 * suggested chip, so their answer is one tap on a pre-named button rather than a search.
 * But inference returns null whenever the destination names no place, and silently
 * configuring an account from a URL is a worse deal for the user than a visible question:
 * this way what we are about to save is on screen before they agree to it.
 *
 * The chip applies on tap with no separate commit button, deliberately: the dashboard's
 * old stage-then-commit picker lost users who did the work but never pressed the button
 * (see MarketPicker).
 *
 * The choice is persisted SERVER-SIDE by the route, not here — see seedSignupRegion for
 * why a localStorage write plus a debounced push could not do this job.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUICK_PICK_MARKETS, marketCamera } from "@/lib/dashboard/area";
import {
  getConfig,
  saveConfig,
  hasForeignWorkspace,
  resetLocalWorkspace,
} from "@/lib/dashboard/config";

function CheckRow({
  checked,
  onToggle,
  children,
}: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left">
      <span
        className={cn(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors",
          checked ? "border-emerald-500 bg-emerald-500 text-slate-950" : "border-border bg-card"
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
      <span className="text-sm leading-snug text-foreground">{children}</span>
    </button>
  );
}

export default function AcceptTermsForm({
  next,
  firstRun = false,
  seedMarket = null,
}: {
  next: string;
  /** Brand-new account with no destination — open the map terminal instead of `next`. */
  firstRun?: boolean;
  /**
   * Market inferred from the page this signup came from (see seedMarket.ts). Offered as
   * the suggested chip so a listing-origin signup answers in one tap; never auto-applied.
   */
  seedMarket?: string | null;
}) {
  const router = useRouter();
  const [notAgent, setNotAgent] = useState(false);
  const [bonaFide, setBonaFide] = useState(false);
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [market, setMarket] = useState<string | null>(null);
  // Whether a PREVIOUS account left a workspace behind in this browser's localStorage.
  // Read after hydration (localStorage is client-only) purely so we can say so in the UI.
  const [foreignWorkspace, setForeignWorkspace] = useState(false);

  useEffect(() => {
    setForeignWorkspace(hasForeignWorkspace());
  }, []);

  // The inferred city first, then the standing list. A listing in Guelph is not a quick
  // pick, so without this the one market we are most confident about is the one market
  // the user cannot choose.
  const choices =
    seedMarket && !QUICK_PICK_MARKETS.some((m) => m.name === seedMarket)
      ? [seedMarket, ...QUICK_PICK_MARKETS.map((m) => m.name)]
      : QUICK_PICK_MARKETS.map((m) => m.name);

  const allChecked = notAgent && bonaFide && agree;
  // Both halves are required. An account with no area is an account we can never mail.
  const ready = allChecked && market !== null;

  const submit = async () => {
    if (!allChecked) {
      setError("All three confirmations are required.");
      return;
    }
    if (!market) {
      setError("Choose the area you want to follow.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/vow/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Server re-verifies all of this — the disabled button is UX, not the security
        // boundary — and it is the server that stores the market and creates the alert row.
        body: JSON.stringify({ notAgent, bonaFide, agree, region: market }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not record your acceptance. Please try again.");
      }

      // Local mirror, so the dashboard paints the right area instantly on first open. The
      // durable copy is already written server-side by the route above; this is a cache,
      // which is why a storage failure is swallowed rather than surfaced.
      try {
        // Clear anything a PREVIOUS account left in this browser before seeding. The
        // workspace is localStorage, not Supabase, so it survives account deletion and
        // sign-out — leaving a new account with the old one's cities, persona and boards,
        // and greeted by the old one's name (DashboardClient reads getProfile()?.fullName).
        if (hasForeignWorkspace()) resetLocalWorkspace();
        saveConfig({ ...getConfig(), regions: [market] });
      } catch {
        /* private mode / quota — never block entry over a convenience cache */
      }

      if (firstRun) {
        // Seed the CAMERA via the terminal's existing ?lat/?lng/?z contract, NOT ?city=.
        // A new user is exploring: a city text filter blanks the map the moment they pan
        // past its boundary, whereas a camera leaves the query unfiltered so the viewport
        // bounds scope it and results follow the drag. That is the same reasoning the
        // ?lat/?lng seed already documents for address entry — reuse it rather than
        // inventing a second camera param.
        // A market off the quick-pick list (the inferred chip) has no stored camera; the
        // terminal's own INITIAL_VIEW_STATE is the right fallback, not another city's.
        const cam = marketCamera(market);
        router.replace(
          cam ? `/properties?lat=${cam.lat}&lng=${cam.lng}&z=${cam.zoom}` : "/properties"
        );
        router.refresh();
        return;
      }

      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <CheckRow checked={notAgent} onToggle={() => setNotAgent((v) => !v)}>
        I am a principal/investor with a bona fide interest — not a licensed agent prospecting for
        clients.
      </CheckRow>
      <CheckRow checked={bonaFide} onToggle={() => setBonaFide((v) => !v)}>
        I have a bona fide interest in the purchase, sale, or lease of real estate.
      </CheckRow>
      <CheckRow checked={agree} onToggle={() => setAgree((v) => !v)}>
        I agree to the VOW Terms of Use and will use this data for personal, non-commercial purposes
        only.
      </CheckRow>

      <div className="border-t border-border pt-4">
        <p className="terminal-font text-[11px] uppercase tracking-wider text-muted-foreground">
          Which area do you want to follow?
        </p>
        <div role="group" aria-label="Starting market" className="mt-3 flex flex-wrap gap-2">
          {choices.map((city) => {
            const active = market === city;
            return (
              <button
                key={city}
                type="button"
                aria-pressed={active}
                onClick={() => setMarket(active ? null : city)}
                className={cn(
                  "min-h-[36px] border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : "border-border bg-card text-muted-foreground hover:border-cyan-600/60 hover:text-foreground"
                )}
              >
                {city}
                {city === seedMarket && !active && (
                  <span className="ml-1.5 text-[10px] text-cyan-700 dark:text-cyan-400">
                    suggested
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Say what the choice buys them. "Pick one" with no reason reads as a form field;
            the reason is the whole point, and it is also the consent we rely on. */}
        <p className="mt-2 text-[11px] text-muted-foreground">
          We&rsquo;ll email you what sells and what comes up here. Add more areas or turn this off
          any time.
        </p>
      </div>

      {/* Don't wipe someone's saved setup silently — say so before it happens. */}
      {foreignWorkspace && (
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          This browser still has a saved workspace from a previous account. Continuing replaces it
          with your own.
        </p>
      )}

      <p className="text-[11px] leading-snug text-muted-foreground">
        Read our full{" "}
        <Link href="/terms" className="text-cyan-700 hover:underline dark:text-cyan-400">
          Terms of Use
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-cyan-700 hover:underline dark:text-cyan-400">
          Privacy Policy
        </Link>
        .
      </p>

      {error && <p className="text-xs text-rose-700 dark:text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400 disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Unlocking
          </>
        ) : (
          "Unlock the terminal"
        )}
      </button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Data is deemed reliable but is not guaranteed accurate by PROPTX. Information herein must only
        be used by consumers with a bona fide interest in the purchase, sale, or lease of real estate
        and may not be used for any commercial purpose.
      </p>
    </div>
  );
}
