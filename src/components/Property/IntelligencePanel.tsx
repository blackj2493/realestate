"use client";

/**
 * PROTOTYPE (listing-page Proposal B) — the single "PureProperty Intelligence"
 * panel. Consolidates the analysis cards (verdict / price / score / costs)
 * behind a segmented control so the page reads Home → Numbers → Market instead
 * of stacking six analysis cards. Slots arrive server-rendered from page.tsx;
 * inactive panes stay mounted (hidden) so calculator state survives switches.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "verdict", label: "Verdict" },
  { key: "price", label: "Price" },
  { key: "score", label: "Score" },
  { key: "costs", label: "Costs" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function IntelligencePanel({
  verdict,
  price,
  score,
  costs,
  footer,
}: {
  verdict: ReactNode;
  price: ReactNode;
  score: ReactNode;
  costs: ReactNode;
  /** Rendered below every pane — the single sign-in gate strip for anon. */
  footer?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("verdict");
  const panes: Record<TabKey, ReactNode> = { verdict, price, score, costs };
  return (
    <div
      className="rounded-lg border border-cyan-500/30 bg-card/50 p-4"
      data-tour="listing-intelligence"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-cyan-400" aria-hidden />
        <h3 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground">
          PureProperty Intelligence
        </h3>
      </div>
      <div
        role="tablist"
        aria-label="Intelligence views"
        className="mb-3 flex gap-1 rounded-lg border border-border bg-background/60 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-[34px] flex-1 rounded-md px-1 text-xs font-semibold transition-colors",
              tab === t.key
                ? "bg-cyan-400 font-bold text-cyan-950"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.key} role="tabpanel" hidden={tab !== t.key}>
          {panes[t.key]}
        </div>
      ))}
      {footer}
    </div>
  );
}
