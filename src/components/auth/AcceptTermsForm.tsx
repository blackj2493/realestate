"use client";

/**
 * AcceptTermsForm — the one-time VOW Terms acceptance for a signed-in user. Posts to
 * /api/vow/accept-terms, then returns the user to where they were headed (`next`).
 * Mirrors the §3 attestations on /apply, but for an authenticated account.
 *
 * In `firstRun` mode (a brand-new account that arrived with no destination — see
 * /welcome) this also asks for ONE starting market and lands the user in the map
 * terminal instead of the dashboard. That single tap does double duty: it seeds
 * `?city=` so the terminal opens somewhere real, and it writes config.regions so the
 * dashboard already has content the first time the user visits it — no second setup
 * step. The chip applies on tap with no separate commit button, deliberately: the
 * dashboard's old stage-then-commit picker lost users who did the work but never
 * pressed the button (see FirstRunRegionPicker).
 *
 * A signup that arrived FROM a listing is not asked at all: `seedMarket` carries that
 * property's city (resolved in /welcome) and we write it silently. Asking someone who is
 * three clicks into one specific home which city they care about is a question we can
 * already answer, and the interruption costs more than the answer is worth.
 *
 * Either way a market gets written, because either way this is the account's FIRST-EVER
 * acceptance — /welcome redirects past this form once terms are on file — and leaving
 * config.regions empty is what puts a new user on a blank dashboard.
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

/** Where an unseeded first-run user lands if they never tap a market. Matches the
 *  terminal map's INITIAL_VIEW_STATE, so the opening camera needs no correcting fly. */
const DEFAULT_MARKET = "Toronto";

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
  /** Brand-new account with no destination — seed a market and open the terminal. */
  firstRun?: boolean;
  /**
   * Market inferred from the page this signup came from (see seedMarket.ts). Used only
   * when we are NOT asking — a listing-origin signup already told us where it cares about.
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
  // Read after hydration (localStorage is client-only) purely so we can say so in the UI;
  // the picker itself no longer depends on it.
  const [foreignWorkspace, setForeignWorkspace] = useState(false);

  // Not gated on firstRun: a listing-origin signup writes to this same workspace, so it
  // needs the warning too.
  useEffect(() => {
    setForeignWorkspace(hasForeignWorkspace());
  }, []);

  const allChecked = notAgent && bonaFide && agree;
  // A first-ever acceptance ALWAYS asks. An earlier version skipped the question when
  // localStorage already held a region — but that storage is not scoped to an account.
  // Deleting a user in Supabase (or just signing out) leaves it intact, so a genuinely
  // new account silently inherited the previous one's city and never saw the picker.
  const askMarket = firstRun;

  const submit = async () => {
    if (!allChecked) {
      setError("All three confirmations are required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/vow/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Server re-verifies these — the disabled button is UX, not the security boundary.
        body: JSON.stringify({ notAgent, bonaFide, agree }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Could not record your acceptance. Please try again.");
      }

      // Asked (first run) or inferred from the listing they came from — either way this is
      // the account's first-ever acceptance, so write a starting market rather than leave
      // the dashboard empty.
      const city = firstRun ? (market ?? DEFAULT_MARKET) : seedMarket;
      // Best-effort: a storage failure must never block entry to the terminal.
      try {
        // Clear anything a PREVIOUS account left in this browser before seeding. The
        // workspace is localStorage, not Supabase, so it survives account deletion and
        // sign-out — leaving a new account with the old one's cities, persona and
        // boards, and greeted by the old one's name (DashboardClient reads
        // getProfile()?.fullName). A brand-new account starts clean on this device.
        // Runs on BOTH paths: a listing-origin signup used to skip this and inherit it.
        if (hasForeignWorkspace()) resetLocalWorkspace();
        if (city) saveConfig({ ...getConfig(), regions: [city] });
      } catch {
        /* private mode / quota — never block entry over a convenience seed */
      }

      if (firstRun) {
        // Seed the CAMERA via the terminal's existing ?lat/?lng/?z contract, NOT ?city=.
        // A new user is exploring: a city text filter blanks the map the moment they pan
        // past its boundary, whereas a camera leaves the query unfiltered so the viewport
        // bounds scope it and results follow the drag. That is the same reasoning the
        // ?lat/?lng seed already documents for address entry — reuse it rather than
        // inventing a second camera param.
        // Non-null on this path (market ?? DEFAULT_MARKET); the fallback only satisfies
        // the widened type shared with the inferred-seed path.
        const cam = marketCamera(city ?? DEFAULT_MARKET);
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

      {askMarket && (
        <div className="border-t border-border pt-4">
          <p className="terminal-font text-[11px] uppercase tracking-wider text-muted-foreground">
            Where do you want to start?
          </p>
          <div role="group" aria-label="Starting market" className="mt-3 flex flex-wrap gap-2">
            {QUICK_PICK_MARKETS.map(({ name: city }) => {
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
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Optional — you can search any area once you&rsquo;re in, and add more later.
          </p>
        </div>
      )}

      {/* Inferred instead of asked. Say what we're setting up rather than silently
          configuring someone's account behind a Terms checkbox. */}
      {!askMarket && seedMarket && (
        <p className="border-t border-border pt-4 text-[11px] leading-snug text-muted-foreground">
          We&rsquo;ll set your dashboard up for{" "}
          <span className="text-foreground">{seedMarket}</span> — change it any time.
        </p>
      )}

      {/* Don't wipe someone's saved setup silently — say so before it happens. Applies to
          both paths: the inferred seed writes to this same workspace. */}
      {foreignWorkspace && (
        <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-300">
          This browser still has a saved workspace from a previous account. Continuing
          replaces it with your own.
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
        disabled={!allChecked || loading}
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
