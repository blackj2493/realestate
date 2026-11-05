"use client";

/**
 * "Email me new listings in {city}" — the signup reason on /new-homes-hst.
 *
 * WHY. The HST post sent 16 Reddit readers here on its first day and none signed up: the page
 * had no reason to. A city alert is the reason, and it is a real one — the nightly digest
 * mails new listings and recent sales for every followed area.
 *
 * HOW. Signed in: one tap follows the city (/api/areas/follow, the same write as every other
 * area follow). Signed out: sign in with next=/new-homes-hst?follow={city}. /welcome reads
 * ?follow= to pre-name the city in its area picker (seedMarket), and when the reader lands
 * back here signed in, this card finishes the follow they asked for — once.
 *
 * Toronto is too big to follow whole (cityParts): the reader picks a part, as in
 * AreaFollowPrompt. Copy says "new listings", not "new homes": the alert does not filter by
 * the age of the home.
 */

import { useEffect, useRef, useState } from "react";
import { Check, Mail } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { partsOf } from "@/lib/dashboard/cityParts";
import CityPartChips from "@/components/areas/CityPartChips";
import { loginHref } from "@/lib/auth/loginHref";
import { track } from "@/lib/analytics/posthog";

const DONE_KEY = "pp_hst_follow_done";

/** Drop ?follow= from the address bar so a reload or a shared link does not follow again. */
function clearFollowParam(): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("follow");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

function alreadyDone(city: string): boolean {
  try {
    return window.sessionStorage.getItem(DONE_KEY) === city;
  } catch {
    return false;
  }
}

function markDone(city: string): void {
  try {
    window.sessionStorage.setItem(DONE_KEY, city);
  } catch {
    /* ignore */
  }
}

export default function CityAlert({
  city,
  resume = false,
}: {
  city: string;
  /** The page was opened with ?follow={this city}: finish the follow once signed in. */
  resume?: boolean;
}) {
  const init = useBubblesStore((s) => s.init);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const loaded = useBubblesStore((s) => s.loaded);

  const [busy, setBusy] = useState(false);
  const [followed, setFollowed] = useState<string | null>(null);
  const parts = partsOf(city);
  // A Toronto reader back from sign-in still needs to pick a part: open the chips.
  const [showParts, setShowParts] = useState(resume && !!parts);
  const [error, setError] = useState("");
  const resumed = useRef(false);

  useEffect(() => {
    void init();
  }, [init]);

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
      setShowParts(false);
      markDone(region);
      track("hst_alert_followed", { city: region });
      // The store keeps its old snapshot otherwise, and AreaFollowPrompt would still ask.
      useBubblesStore.setState({ initialized: false });
      void init();
    } catch {
      setError("Could not save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  // Back from sign-in with ?follow={city}: finish the follow the reader asked for, once.
  useEffect(() => {
    if (!resume || resumed.current || !loaded || !signedIn) return;
    resumed.current = true;
    clearFollowParam();
    if (parts) return; // the part chips are open; the reader picks one
    if (alreadyDone(city)) return;
    void follow(city);
    // Run once per resume; `follow` is recreated each render and must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, loaded, signedIn, city, parts]);

  const onClick = () => {
    track("hst_alert_click", { city, signedIn });
    if (!signedIn) {
      window.location.assign(loginHref(`/new-homes-hst?follow=${encodeURIComponent(city)}`));
      return;
    }
    if (parts) setShowParts((v) => !v);
    else void follow(city);
  };

  if (followed) {
    return (
      <div
        aria-live="polite"
        className="mt-4 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-sm text-foreground">
          Done. We will email you new listings and recent sales in <span className="font-semibold">{followed}</span>.
          You can change this on your dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-emerald-600 px-4 py-2 text-center text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 disabled:opacity-60 sm:w-auto dark:text-emerald-300"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        Email me new listings in {city}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">
        {signedIn || !loaded
          ? "New listings and recent sales, by email. Free. Stop any time."
          : "Free account. New listings and recent sales, by email. Stop any time."}
      </p>
      {showParts && signedIn && parts && (
        <CityPartChips parent={city} parts={parts} onPick={(p) => void follow(p)} disabled={busy} />
      )}
      {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{error}</p>}
    </div>
  );
}
