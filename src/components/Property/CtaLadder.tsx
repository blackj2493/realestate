"use client";

import { CalendarDays, HelpCircle, Scale, ArrowRight } from "lucide-react";
import { LEAD_INTENTS, type LeadIntent } from "./leadIntents";

/**
 * CTA ladder — graduated rungs of commitment for the listing page. Each rung opens the
 * shared ScheduleViewingForm (via the `pp:open-viewing` event) with a different intent,
 * so all paths feed one lead pipeline. The primary rung (book a viewing) is emphasized;
 * the lower-friction rungs sit below as ghost buttons.
 */
export default function CtaLadder({ listingKey }: { listingKey: string }) {
  function open(intent: LeadIntent) {
    window.dispatchEvent(new CustomEvent("pp:open-viewing", { detail: { listingKey, intent } }));
  }

  const ICONS: Record<LeadIntent, typeof HelpCircle> = {
    viewing: CalendarDays,
    question: HelpCircle,
    price_opinion: Scale,
  };

  return (
    <div className="space-y-2">
      {/* Primary rung */}
      <button
        type="button"
        onClick={() => open("viewing")}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-95 [touch-action:manipulation]"
      >
        <CalendarDays className="h-4 w-4" />
        {LEAD_INTENTS.viewing.rungLabel}
        <ArrowRight className="h-4 w-4" />
      </button>

      {/* Lower-friction rungs */}
      {(["question", "price_opinion"] as LeadIntent[]).map((id) => {
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
              <Icon className="h-4 w-4 text-cyan-400" />
              {def.rungLabel}
            </span>
            <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">{def.rungHint}</span>
          </button>
        );
      })}
    </div>
  );
}
