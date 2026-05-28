"use client";

/**
 * RegionDrilldown — band ③ collapsible wrapper for a single area's deep view
 * (New/Sold panel + playlist boards). Default COLLAPSED, and children are
 * lazy-mounted (kept mounted after first expand) so a dashboard with many
 * regions/bubbles fires zero per-area Typesense queries on load — the comparison
 * band (②) already gives the at-a-glance snapshot; the drill-down is on demand.
 *
 * Generic enough to host both city sections (title only) and bubble sections
 * (icon + subtitle + actions + deep-link id/highlight).
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function RegionDrilldown({
  title,
  subtitle,
  icon,
  actions,
  summary,
  defaultExpanded = false,
  id,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** One-line peek shown on the right when collapsed. */
  summary?: ReactNode;
  defaultExpanded?: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [everExpanded, setEverExpanded] = useState(defaultExpanded);

  const toggle = () =>
    setExpanded((v) => {
      if (!v) setEverExpanded(true);
      return !v;
    });

  return (
    <section id={id} className={cn("space-y-3 rounded-sm transition-shadow", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
          )}
          {icon}
          <span className="terminal-font truncate text-sm font-bold uppercase tracking-widest text-slate-100">
            {title}
          </span>
          {subtitle && (
            <span className="truncate text-[11px] text-slate-500">{subtitle}</span>
          )}
          {!expanded && summary && (
            <span className="terminal-font ml-auto shrink-0 truncate pl-2 text-[11px] text-slate-500">
              {summary}
            </span>
          )}
        </button>
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>

      {everExpanded && (
        <div className={expanded ? "space-y-3" : "hidden"}>{children}</div>
      )}
    </section>
  );
}
