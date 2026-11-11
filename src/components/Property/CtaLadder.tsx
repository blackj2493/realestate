"use client";

import { CalendarDays, HelpCircle, Scale, ArrowRight } from "lucide-react";
import { LEAD_INTENTS, type LeadIntent } from "./leadIntents";
import { track } from "@/lib/analytics/posthog";

/**
 * CTA ladder — graduated rungs of commitment for the listing page. Each rung opens the
 * shared ScheduleViewingForm (via the `pp:open-viewing` event) with a different intent,
 * so all paths feed one lead pipeline. The primary rung is emphasized (price opinion on a
 * sale listing, book a viewing on a lease); the other rungs sit below as ghost buttons.
 */
export default function CtaLadder({ listingKey, isLease = false }: { listingKey: string; isLease?: boolean }) {
  function open(intent: LeadIntent) {
    track("listing_cta_clicked", { listingKey, intent, placement: "rail" });
    window.dispatchEvent(new CustomEvent("pp:open-viewing", { detail: { listingKey, intent } }));
  }

  const ICONS: Record<LeadIntent, typeof HelpCircle> = {
    viewing: CalendarDays,
    question: HelpCircle,
    price_opinion: Scale,
  };

  // Sale listing: the price second-opinion is the primary rung. Through Oct 2026 it produced
  // 9 of 9 sale-side leads and the only closed deal; "Book a viewing" produced 1 (2026-11).
  // Lease listing: a tenant does not need an opinion on a sale price, so "Book a viewing"
  // stays primary and the price rung drops.
  const primary: LeadIntent = isLease ? "viewing" : "price_opinion";
  const lowerRungs: LeadIntent[] = isLease ? ["question"] : ["viewing", "question"];
  const PrimaryIcon = ICONS[primary];

  return (
    <div className="space-y-2">
      {/* Primary rung */}
      <button
        type="button"
        onClick={() => open(primary)}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-95 [touch-action:manipulation]"
      >
        <PrimaryIcon className="h-4 w-4" />
        {primary === "price_opinion" ? "Get a free second opinion on the price" : LEAD_INTENTS[primary].rungLabel}
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* Lower-friction rungs */}
      {lowerRungs.map((id) => {
        const def = LEAD_INTENTS[id];
        const Icon = ICONS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => open(id)}
            className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md border border-border px-4 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted [touch-action:manipulation]"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Icon className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
              {def.rungLabel}
            </span>
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">{def.rungHint}</span>
          </button>
        );
      })}
    </div>
  );
}
