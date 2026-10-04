"use client";

/**
 * SaveHomeHint — a one-time card on the terminal that shows a signed-in reader with no
 * saved home where the save heart is and what it gets them.
 *
 * WHY IT EXISTS. Measured 2026-10-04 over 422 real signups: a reader who saved a home on
 * signup day came back on a later day at 81%, against 33-34% for one who saved only an
 * area or nothing. Most readers never find the heart, so they never learn a saved home
 * emails them when its price drops or it sells.
 *
 * WHEN. Signed in, watchlist loaded and empty, and the reader already follows an area. The
 * last condition keeps it from stacking on AreaFollowPrompt, which owns the same corner and
 * shows only to readers with no area — the two are mutually exclusive by construction.
 *
 * ONCE. Shown until the reader taps "Got it" or saves a home, then never again on this
 * browser. It points; it never saves anything itself.
 */

import { useEffect, useState } from "react";
import { Heart, Check, X } from "lucide-react";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import { track } from "@/lib/analytics/posthog";

const DONE_KEY = "pp_save_hint_done";

function isDone(): boolean {
  try {
    return window.localStorage.getItem(DONE_KEY) === "1";
  } catch {
    // Storage blocked: treat as done rather than show the card on every load.
    return true;
  }
}

function markDone(): void {
  try {
    window.localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* private mode / quota */
  }
}

export default function SaveHomeHint() {
  const initWatch = useWatchlistStore((s) => s.init);
  const watchLoaded = useWatchlistStore((s) => s.loaded);
  const signedIn = useWatchlistStore((s) => s.signedIn);
  const savedCount = useWatchlistStore((s) => Object.keys(s.items).length);
  const initBubbles = useBubblesStore((s) => s.init);
  const bubblesLoaded = useBubblesStore((s) => s.loaded);
  const hasArea = useBubblesStore((s) => Object.keys(s.items).length > 0);

  // Start hidden; localStorage is client-only, and a card that paints then vanishes is worse.
  const [done, setDone] = useState(true);
  // Latched the first time the card is due, so a save afterwards reads as "converted"
  // rather than simply making the card ineligible. Set during render, not in an effect.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    setDone(isDone());
    void initWatch();
    void initBubbles();
  }, [initWatch, initBubbles]);

  const eligible = !done && watchLoaded && bubblesLoaded && signedIn && hasArea;
  if (!shown && eligible && savedCount === 0) setShown(true);
  const saved = shown && savedCount > 0;

  useEffect(() => {
    if (shown) track("save_hint_shown");
  }, [shown]);

  // The reader saved a home while the card was up: retire the hint for good, then let the
  // confirmation stand for a few seconds — a receipt, not a permanent bar.
  useEffect(() => {
    if (!saved) return;
    markDone();
    track("save_hint_converted");
    const t = setTimeout(() => setDone(true), 6000);
    return () => clearTimeout(t);
  }, [saved]);

  const dismiss = () => {
    markDone();
    setDone(true);
    track("save_hint_dismissed");
  };

  if (done || !shown) return null;

  // Same corner and stacking rules as AreaFollowPrompt's floating variant — see there.
  const shell =
    "fixed inset-x-3 bottom-20 z-40 mx-auto max-w-lg shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-[32rem] sm:-translate-x-1/2 md:bottom-3";

  if (saved) {
    return (
      <div className={shell}>
        <section
          aria-live="polite"
          className="flex items-start gap-2 border border-border border-l-2 border-l-emerald-500 bg-card p-3 dark:border-l-emerald-400/70"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-[13px] leading-snug text-foreground">
            Saved. We&rsquo;ll email you if the price drops, it sells or it comes back on the
            market.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className={shell}>
      <section
        aria-label="Save a home"
        className="border border-border border-l-2 border-l-cyan-500 bg-card p-3 dark:border-l-cyan-400/70"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-[13px] leading-relaxed text-foreground">
            Tap{" "}
            <Heart
              aria-label="the heart"
              className="inline h-3.5 w-3.5 -translate-y-px text-cyan-700 dark:text-cyan-400"
            />{" "}
            on any home to save it. We&rsquo;ll email you if the price drops, it sells or it
            comes back on the market.
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="-m-1 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="terminal-font inline-flex min-h-[44px] items-center border border-border bg-background px-3 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-cyan-600/60 hover:text-foreground sm:min-h-[32px]"
          >
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}
