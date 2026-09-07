"use client";

/**
 * AreaFollowPrompt — the one-tap ask shown to a signed-in account that follows no area.
 *
 * WHY IT EXISTS. The nightly digest builds a payload only for a user who owns a watchlist
 * row or an `alerts_enabled` `market_bubbles` row. An account with neither receives nothing,
 * forever, and no counter anywhere says so. 305 of 432 accounts had no saved area when the
 * Weekly Data Drop chip was written.
 *
 * WHY A PROMPT AND NOT A BACKFILL. There is nothing to back-fill. `repairAreaAlerts.ts`
 * builds alert rows out of areas already stored server-side, and these accounts have none —
 * either they never chose one, or they chose one under the old signup flow that wrote it to
 * localStorage and never pushed it (PR #511). No script can invent an area nobody picked, so
 * the only honest move is to ask.
 *
 * WHY HERE AND NOT ON /dashboard. That is where both existing pickers already live, and it
 * is precisely where these users do not go — the reason the email chip was built in the
 * first place. So this renders in the (app) shell and on the terminal instead: the listing
 * pages, address hubs and map where they actually are.
 *
 * WHAT IT WILL NOT DO. It never picks for them and it never writes on render. The write is
 * the same server-side step every other regions writer takes (followRegion → config.regions
 * + reconcileCityAlerts), so the area it saves actually emails — which is the entire point,
 * and the exact promise the earlier writers broke.
 *
 * "Not now" is honoured for 30 days rather than forever. This banner is the only channel
 * left for these accounts, so a single mistaken tap should not silence it permanently — but
 * asking again next page load would be nagging. One ask a month, and any answer at all
 * (including following an area anywhere else) retires it for good.
 */

import { useEffect, useState } from "react";
import { MapPin, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { QUICK_PICK_MARKETS } from "@/lib/dashboard/area";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";

const DISMISS_KEY = "pp_area_prompt_snoozed_at";
const REASK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Snoozed within the last 30 days? A storage failure means "not snoozed". */
function isSnoozed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return Number.isFinite(at) && Date.now() - at < REASK_AFTER_MS;
  } catch {
    return false;
  }
}

/**
 * Stamp "asked, declined" at module scope.
 *
 * Not inlined into the click handler: `Date.now()` is impure, and the lint rule that
 * enforces render purity cannot tell a handler defined during render from render itself.
 * Keeping the impure call out here is also just where it belongs.
 */
function stampSnooze(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* private mode / quota — it simply asks again on the next load */
  }
}

/**
 * Wrapper placement per surface.
 *
 * "floating" is fixed, so the terminal's full-height flex tree is untouched. Tappable on
 * purpose: the pointer-events-none rule applies to decorative overlays INSIDE the map, and
 * this sits outside it. Bottom-anchored to clear the top command bar, and lifted on small
 * screens to clear MobileMapTools (also bottom-left, also z-40, md:hidden). z-40
 * deliberately, not higher: every dialog, sheet and palette in the terminal is z-50+ and
 * must cover this, and QuickLookPanel's z-40 backdrop comes later in the DOM so it still
 * paints over us.
 */
function shellClass(variant: "inline" | "floating"): string {
  return variant === "floating"
    ? "fixed inset-x-3 bottom-20 z-40 mx-auto max-w-lg shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-[32rem] sm:-translate-x-1/2 md:bottom-3"
    : "mx-auto my-3 max-w-5xl px-3";
}

export default function AreaFollowPrompt({
  variant = "inline",
}: {
  /**
   * "inline" sits in document flow for the (app) shell. "floating" is fixed to the bottom
   * of the viewport for the terminal, whose layout is a bare fragment wrapping a
   * full-height flex tree — a fixed element is out of flow, so it leaves that untouched.
   */
  variant?: "inline" | "floating";
}) {
  const init = useBubblesStore((s) => s.init);
  const items = useBubblesStore((s) => s.items);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const loaded = useBubblesStore((s) => s.loaded);

  // Start hidden and only reveal after hydration: localStorage is client-only, and a banner
  // that paints then vanishes is worse than one that arrives a beat late.
  const [snoozed, setSnoozed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [followed, setFollowed] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSnoozed(isSnoozed());
    void init();
  }, [init]);

  // The confirmation is a receipt, not a permanent bar. This component lives in a LAYOUT,
  // and App Router layouts survive client-side navigation — without this it would ride
  // along on top of every page the user opened next. Clearing it falls through to the
  // guard below, which by then sees the area and renders nothing.
  useEffect(() => {
    if (!followed) return;
    const t = setTimeout(() => setFollowed(null), 6000);
    return () => clearTimeout(t);
  }, [followed]);

  const snooze = () => {
    stampSnooze();
    setSnoozed(true);
  };

  const follow = async (region: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/areas/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region }),
      });
      if (!res.ok) throw new Error("save failed");
      setFollowed(region);
      // Re-read the areas we now own. Without this the store keeps its empty snapshot for
      // the rest of the session, so a client-side navigation to another page in this group
      // would mount a second copy of this banner and ask again — for an area they just
      // saved. `init` is guarded by `initialized`, hence clearing it first.
      useBubblesStore.setState({ initialized: false });
      void init();
    } catch {
      setError("Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Confirmation first: the refetch above flips `hasArea` true, and the guard below would
  // otherwise unmount the card before the user has read what happened.
  if (followed) {
    return (
      <div className={shellClass(variant)}>
        <section
          aria-live="polite"
          className="flex items-center gap-2 border border-border border-l-2 border-l-emerald-500 bg-card p-3 dark:border-l-emerald-400/70"
        >
          <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-[13px] leading-snug text-foreground">
            Following <span className="font-semibold">{followed}</span>. We&rsquo;ll email you
            what sells and what comes up there.
          </p>
        </section>
      </div>
    );
  }

  // Only for a signed-in account we have actually loaded, and only when it follows NO area.
  // A muted row still counts as an area: the user made that call and this must not re-ask.
  // A drawn or school bubble counts too — they already receive area email.
  const hasArea = Object.keys(items).length > 0;
  if (!loaded || !signedIn || hasArea || snoozed) return null;

  return (
    <div className={shellClass(variant)}>
      <section
        aria-label="Follow an area"
        className="border border-border border-l-2 border-l-cyan-500 bg-card p-3 dark:border-l-cyan-400/70"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-cyan-700 dark:text-cyan-400" />
            <h2 className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-foreground">
              Follow an area
            </h2>
          </div>
          <button
            type="button"
            onClick={snooze}
            disabled={busy}
            aria-label="Not now"
            className="-m-1 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <p className="mt-2 text-[13px] leading-relaxed text-foreground">
          You don&rsquo;t follow an area yet. Pick one and we&rsquo;ll email you what sells
          and what comes up there.
        </p>

        <div role="group" aria-label="Areas" className="mt-2.5 flex flex-wrap gap-2">
          {QUICK_PICK_MARKETS.map(({ name }) => (
            <button
              key={name}
              type="button"
              onClick={() => follow(name)}
              disabled={busy}
              className={cn(
                "terminal-font inline-flex min-h-[44px] items-center border border-border bg-background px-3 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors sm:min-h-[32px]",
                "hover:border-cyan-600/60 hover:text-foreground disabled:opacity-60"
              )}
            >
              {name}
            </button>
          ))}
        </div>

        {error && <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-400">{error}</p>}

        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Add more or turn it off any time on your dashboard.
        </p>
      </section>
    </div>
  );
}
