/**
 * "Quick facts about this home" — closed by default, at the foot of a for-sale listing
 * page. A native <details>, so every sentence is in the server HTML (crawlers and AI
 * assistants read it) and the section costs one row of screen space. Copy is built in
 * src/lib/property/quickFacts.ts (VOW-safe by construction: public fields + aggregates).
 */
import { ChevronDown } from "lucide-react";
import type { QuickFacts } from "@/lib/property/quickFacts";

export default function ListingQuickFacts({ facts, className }: { facts: QuickFacts; className?: string }) {
  return (
    <details id="quick-facts" className={`group rounded-xl border border-border bg-card/40 ${className ?? ""}`}>
      <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <span>Quick facts about this home</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-border px-4 pb-4 pt-3">
        <p className="text-sm leading-relaxed text-foreground">{facts.summary}</p>
        {facts.faqs.length > 0 && (
          <dl className="space-y-3">
            {facts.faqs.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-xs text-muted-foreground">
          Source: MLS® listing data
          {facts.updatedLabel ? `; neighbourhood figures from the last 12 months, updated ${facts.updatedLabel}` : ""}. This is not an
          appraisal.
        </p>
      </div>
    </details>
  );
}
