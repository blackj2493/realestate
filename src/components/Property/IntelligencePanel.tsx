"use client";

/**
 * The single "PureProperty Intelligence" panel (mobile). Consolidates the analysis
 * cards (the read / estimate / deal grade / renovation / costs) so the page reads
 * Home → Numbers → Market instead of stacking six analysis cards.
 *
 * Presented as a SINGLE-OPEN ACCORDION rather than a tab strip: every section's row
 * is always on screen, each carrying its headline "answer" (the estimate, the grade,
 * the net upside) right on the collapsed row — so a visitor sees at a glance that we
 * priced the home, graded the deal and found renovation upside, and can open any one
 * for the full card without hunting through tabs. Opening a row closes the others, so
 * the panel stays compact. Sections arrive server-rendered from page.tsx (with their
 * VOW gating already applied); this component adds nothing gated.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntelligenceSection {
  key: string;
  /** Row label — kept short and plain so a collapsed row still says what it is. */
  label: string;
  /** Leading icon (feature-coloured) — gives the row an anchor for the eye. */
  icon?: ReactNode;
  /** One-line context under the label (the delta, verdict, best move …). */
  caption?: ReactNode;
  /** Headline "answer" shown on the collapsed row (a value, grade chip, or lock). */
  summary?: ReactNode;
  /** The full card, revealed when the row is open. */
  detail: ReactNode;
}

export default function IntelligencePanel({
  sections,
  defaultOpenKey,
  footer,
}: {
  sections: IntelligenceSection[];
  /** Which section is open on first paint (defaults to the first). */
  defaultOpenKey?: string;
  /** Rendered below every section — the single sign-in gate strip for anon. */
  footer?: ReactNode;
}) {
  const [openKey, setOpenKey] = useState<string | null>(defaultOpenKey ?? sections[0]?.key ?? null);

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-card/50" data-tour="listing-intelligence">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-cyan-400" aria-hidden />
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          PureProperty Intelligence
        </h3>
      </div>

      <div className="divide-y divide-border">
        {sections.map((s) => {
          const open = openKey === s.key;
          const panelId = `intel-panel-${s.key}`;
          return (
            <div key={s.key}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpenKey(open ? null : s.key)}
                className={cn(
                  "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                  open && "bg-cyan-500/5"
                )}
              >
                {s.icon != null && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
                    {s.icon}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold leading-tight text-foreground">{s.label}</span>
                  {s.caption != null && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                      {s.caption}
                    </span>
                  )}
                </span>
                {s.summary != null && <span className="shrink-0 text-right">{s.summary}</span>}
                <ChevronDown
                  className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
                  aria-hidden
                />
              </button>
              <div id={panelId} role="region" aria-label={s.label} hidden={!open} className="px-4 pb-4 pt-1">
                {open && s.detail}
              </div>
            </div>
          );
        })}
      </div>

      {footer && <div className="border-t border-border p-4">{footer}</div>}
    </div>
  );
}
