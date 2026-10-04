"use client";

/**
 * SaveAfterSignupPrompt — the one-tap "save this home?" a reader sees on the listing they
 * just signed up from. Renders nothing for everyone else.
 *
 * The mark is set by AcceptTermsForm and consumed here exactly once (see saveOffer.ts for
 * why a saved home is the thing worth asking for). It never saves on render: the reader
 * taps, and the write is the same watchlist toggle the Save button above uses, so the home
 * enters the nightly digest like any other saved home.
 */

import { useEffect, useState } from "react";
import { Bookmark, Check, X } from "lucide-react";
import { useWatchlistStore, type WatchItem } from "@/lib/watchlist/useWatchlist";
import { takeSaveOffer } from "@/lib/watchlist/saveOffer";
import { track } from "@/lib/analytics/posthog";

export default function SaveAfterSignupPrompt({ item }: { item: WatchItem }) {
  const init = useWatchlistStore((s) => s.init);
  const loaded = useWatchlistStore((s) => s.loaded);
  const watched = useWatchlistStore((s) => !!s.items[item.listing_key]);
  const toggle = useWatchlistStore((s) => s.toggle);

  const [offered, setOffered] = useState(false);
  const [state, setState] = useState<"ask" | "saved" | "closed">("ask");

  useEffect(() => {
    // sessionStorage is client-only, so the offer can only be read after hydration.
    if (takeSaveOffer(item.listing_key)) setOffered(true);
    void init();
  }, [init, item.listing_key]);

  // Already saved (another tab, or the Save button above) — nothing to ask.
  const visible = offered && loaded && state !== "closed" && (state === "saved" || !watched);

  useEffect(() => {
    if (visible && state === "ask") track("signup_save_offer_shown", { listingKey: item.listing_key });
  }, [visible, state, item.listing_key]);

  if (!visible) return null;

  if (state === "saved") {
    return (
      <section
        aria-live="polite"
        className="mt-3 flex items-start gap-2 border border-border border-l-2 border-l-emerald-500 bg-card p-3 dark:border-l-emerald-400/70"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <p className="text-[13px] leading-snug text-foreground">
          Saved. We&rsquo;ll email you if the price drops, it sells or it comes back on the
          market. It&rsquo;s on your dashboard too.
        </p>
      </section>
    );
  }

  const save = async () => {
    setState("saved");
    track("signup_save_offer_accepted", { listingKey: item.listing_key });
    await toggle(item);
  };

  const dismiss = () => {
    setState("closed");
    track("signup_save_offer_dismissed", { listingKey: item.listing_key });
  };

  return (
    <section
      aria-label="Save this home"
      className="mt-3 border border-border border-l-2 border-l-cyan-500 bg-card p-3 dark:border-l-cyan-400/70"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] leading-relaxed text-foreground">
          <span className="font-semibold">Save this home?</span> We&rsquo;ll email you if the
          price drops, it sells or it comes back on the market.
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
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md bg-cyan-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 md:min-h-[36px]"
        >
          <Bookmark className="h-4 w-4" />
          Save this home
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-[44px] items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-[36px]"
        >
          No thanks
        </button>
      </div>
    </section>
  );
}
