"use client";

/**
 * OpinionNudge — "You keep coming back to this home" → the free price second-opinion (2026-11).
 *
 * Shown on an ACTIVE SALE listing to a signed-in reader on their third visit to that home,
 * once per home (interestOffer.ts). It opens the existing price-opinion form through the same
 * `pp:open-viewing` event the CTA ladder uses, so the request lands in the normal lead
 * pipeline with the timeline / agent questions. Regulars returned on 3+ days at 26% but sent
 * almost no leads; this asks them at the moment they are weighing one specific home.
 */

import { useEffect, useState } from "react";
import { Scale, X } from "lucide-react";
import { useWatchlistStore } from "@/lib/watchlist/useWatchlist";
import { takeOpinionOffer } from "@/lib/watchlist/interestOffer";
import { track } from "@/lib/analytics/posthog";

export default function OpinionNudge({ listingKey }: { listingKey: string }) {
  const init = useWatchlistStore((s) => s.init);
  const loaded = useWatchlistStore((s) => s.loaded);
  const signedIn = useWatchlistStore((s) => s.signedIn);
  const [show, setShow] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  // Wait for the watchlist load: by then this view has been counted (the save prompt records
  // the visit on mount) and we know whether the reader is signed in.
  useEffect(() => {
    if (checked || !loaded) return;
    setChecked(true);
    if (signedIn && takeOpinionOffer(listingKey)) {
      setShow(true);
      track("opinion_offer_shown", { listingKey });
    }
  }, [checked, loaded, signedIn, listingKey]);

  if (!show) return null;

  const open = () => {
    track("opinion_offer_clicked", { listingKey });
    window.dispatchEvent(new CustomEvent("pp:open-viewing", { detail: { listingKey, intent: "price_opinion" } }));
    setShow(false);
  };
  const dismiss = () => {
    track("opinion_offer_dismissed", { listingKey });
    setShow(false);
  };

  return (
    <section
      aria-label="Free second opinion on the price"
      className="border border-border border-l-2 border-l-cyan-500 bg-card p-3 dark:border-l-cyan-400/70"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-relaxed text-foreground">
          <span className="font-semibold">You keep coming back to this home.</span> Want a free second
          opinion on the price before you make an offer?
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="No thanks"
          className="-m-1 shrink-0 p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={open}
        className="mt-2.5 inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-cyan-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 md:min-h-[36px]"
      >
        <Scale className="h-4 w-4" />
        Get a second opinion
      </button>
    </section>
  );
}
