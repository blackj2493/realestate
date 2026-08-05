"use client";

/**
 * The "PureProperty Intelligence" panel (mobile). Consolidates the analysis cards
 * (the read / estimate / deal grade / renovation / costs) into one place so the page
 * reads Home → Numbers → Market instead of stacking six full cards.
 *
 * Design (Proposal B — "surface the moat"): every section's HEADLINE is always on
 * screen — the icon, label, the one-line takeaway (`caption`) and the answer chip
 * (`summary`) — so a visitor gets each insight while scrolling, with no taps. Only the
 * deep EVIDENCE (comps, grade breakdown, reno moves, cost model) sits behind a single
 * HIGHLIGHTED "See the …" toggle per row, opened independently (multi-open — opening
 * one no longer closes the others). A short synthesised `verdict` leads the panel.
 * Sections arrive server-rendered from page.tsx with their VOW gating already applied;
 * this component adds nothing gated.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface IntelligenceSection {
  key: string;
  /** Row label — kept short and plain. */
  label: string;
  /** Leading icon (feature-coloured) — gives the row an anchor for the eye. */
  icon?: ReactNode;
  /** One-line takeaway under the label — ALWAYS visible (the delta, verdict, best move…). */
  caption?: ReactNode;
  /** Headline "answer" shown on the row (a value, grade chip, or lock) — ALWAYS visible. */
  summary?: ReactNode;
  /** Label for the highlighted evidence toggle, e.g. "See the comps". Falls back to a generic. */
  evidenceLabel?: string;
  /** The deep-evidence card, revealed only when the row's toggle is open. */
  detail?: ReactNode;
}

export default function IntelligencePanel({
  sections,
  verdict,
  footer,
}: {
  sections: IntelligenceSection[];
  /** One-line synthesis + headline chips, rendered at the top of the panel. */
  verdict?: ReactNode;
  /** Rendered below every section — the single sign-in gate strip for anon. */
  footer?: ReactNode;
}) {
  // Multi-open: each row's evidence toggles independently, so a visitor can line up
  // the comps, the grade breakdown and the reno moves at once (the old single-open
  // accordion forced them to close one to see another).
  const [openKeys, setOpenKeys] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setOpenKeys((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-card/50" data-tour="listing-intelligence">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-cyan-400" aria-hidden />
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          PureProperty Intelligence
        </h3>
      </div>

      {verdict != null && <div className="border-b border-border p-3">{verdict}</div>}

      <div className="divide-y divide-border">
        {sections.map((s) => {
          const open = !!openKeys[s.key];
          const panelId = `intel-panel-${s.key}`;
          return (
            <div key={s.key} className="px-4 py-3">
              {/* Always-visible headline: icon · label · answer chip · one-line takeaway. */}
              <div className="flex items-start gap-3">
                {s.icon != null && (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
                    {s.icon}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[13px] font-semibold leading-tight text-foreground">{s.label}</span>
                    {s.summary != null && <span className="shrink-0 text-right">{s.summary}</span>}
                  </div>
                  {s.caption != null && (
                    <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{s.caption}</p>
                  )}
                </div>
              </div>

              {/* Highlighted evidence toggle — the deliberate, tappable way into the
                  comps / breakdown / moves / cost model. Deep content is only rendered
                  (and mounted) once opened, so the collapsed panel stays cheap. */}
              {s.detail != null && (
                <>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panelId}
                    onClick={() => toggle(s.key)}
                    className="mt-2.5 flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/5 px-3 py-2.5 text-[12px] font-semibold text-cyan-700 transition-colors hover:bg-cyan-500/10 dark:text-cyan-300"
                  >
                    <span>{open ? "Hide details" : (s.evidenceLabel ?? "See the full breakdown")}</span>
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
                      aria-hidden
                    />
                  </button>
                  <div id={panelId} role="region" aria-label={s.label} hidden={!open} className="pt-3">
                    {open && s.detail}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {footer && <div className="border-t border-border p-4">{footer}</div>}
    </div>
  );
}
