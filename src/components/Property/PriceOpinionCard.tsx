"use client";

/**
 * PriceOpinionCard — the main action of an ACTIVE SALE listing, right under the asking price
 * (2026-11). Through Oct 2026 the price second-opinion produced 9 of 9 sale-side leads and
 * the only closed deal, while "Book a viewing" produced 1 — yet it sat as a ghost button deep
 * in the right rail. This puts it first; "Book a viewing" becomes the second button and the
 * rest moves into one "More" menu.
 *
 * Every button opens the shared ScheduleViewingForm through the `pp:open-viewing` event, so
 * all requests land in the same lead pipeline (no new table). Lease listings never render this:
 * a tenant does not need an opinion on a sale price.
 */

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, GitCompareArrows, HelpCircle, Scale } from "lucide-react";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { track } from "@/lib/analytics/posthog";
import type { LeadIntent } from "./leadIntents";

export default function PriceOpinionCard({ listingKey, priceText }: { listingKey: string; priceText: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const isSelected = useCommandCenterStore((s) => s.selectedIds.has(listingKey));
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);

  // Close the More menu on an outside tap or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  function open(intent: LeadIntent) {
    track("listing_cta_clicked", { listingKey, intent, placement: "price_card" });
    window.dispatchEvent(new CustomEvent("pp:open-viewing", { detail: { listingKey, intent } }));
    setMoreOpen(false);
  }

  return (
    <section
      aria-label="Free second opinion on the price"
      className="mt-4 max-w-xl space-y-3"
    >
      <div className="rounded-xl border-2 border-emerald-600 bg-emerald-50 p-4 dark:border-emerald-500/70 dark:bg-emerald-500/10">
        <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">Is {priceText} a fair price?</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/80">
          We compare it with recent sales near this home and send you our read. Free, no obligation.
        </p>
        <button
          type="button"
          onClick={() => open("price_opinion")}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[15px] font-bold text-white transition-colors hover:bg-emerald-700 active:scale-[0.99] [touch-action:manipulation]"
        >
          <Scale className="h-4 w-4" />
          Get a free second opinion on the price
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => open("viewing")}
          className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <CalendarDays className="h-4 w-4" />
          Book a viewing
        </button>
        <div ref={moreRef} className="relative">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            className="flex min-h-[44px] items-center gap-1 rounded-lg border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            More
            <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (
            <div
              role="menu"
              className="absolute right-0 z-30 mt-1 w-56 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => open("question")}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm text-foreground hover:bg-muted"
              >
                <HelpCircle className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                Ask a question
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  toggleSelected(listingKey);
                  setMoreOpen(false);
                }}
                className="flex min-h-[44px] w-full items-center gap-2 px-3 text-left text-sm text-foreground hover:bg-muted"
              >
                <GitCompareArrows className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                {isSelected ? "Remove from comparison" : "Add to comparison"}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
