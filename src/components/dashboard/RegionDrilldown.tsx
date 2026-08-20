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
 *
 * WHY THE HEADER IS A CARD. The collapsed row used to be a bare title over
 * `border-b pb-2` — byte-for-byte the band heading above it (BubbleSections'
 * "Market Bubbles"). Users read it as a label and never pressed it; the clicks
 * went to "Open in Terminal" instead, the one thing on the row that looked like a
 * control, which dropped them on the map scoped to a single area. One rule fixes
 * it: a bare rule means HEADING, a bordered `bg-card` box means OBJECT. The band
 * label keeps the rule; every area gets the box, a hover state, a named action,
 * and a `summary` peek so the closed row says what is behind it.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import { isSectionExpanded, setSectionExpanded } from "@/lib/dashboard/sectionState";
import { useHydrated } from "@/lib/theme/useHydrated";

/**
 * The collapsed peek, in the terms the expanded section actually uses: the New/Sold
 * panel's own column headings, and the playlist boards the user has enabled.
 *
 * Deliberately an INVENTORY, not a statistic. A live count ("42 new this week") would
 * cost one request per collapsed section and undo the reason the section is collapsed;
 * this is derived from props already in hand and is free.
 */
export function sectionSummary(lens: MarketActivityLens, boardCount: number): string {
  const columns = lens.transactionType === "lease" ? "New & leased" : "New & sold";
  if (boardCount <= 0) return columns;
  return `${columns} · ${boardCount} board${boardCount === 1 ? "" : "s"}`;
}

export default function RegionDrilldown({
  title,
  subtitle,
  icon,
  actions,
  summary,
  defaultExpanded = false,
  persistKey,
  id,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /** One-line peek shown under the title when collapsed — say what expanding yields. */
  summary?: ReactNode;
  defaultExpanded?: boolean;
  /**
   * Namespaced key (`bubble:<id>`, `city:<region>`) under which this section's open
   * state survives to the next visit. Omit to opt out of persistence.
   */
  persistKey?: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const contentId = useId();
  const hydrated = useHydrated();

  // The server cannot see localStorage, so the restored answer must be `false` on the
  // first client render and arrive on the post-hydration one — that is exactly what
  // useHydrated is for. Read once per mount, not once per render.
  const restored = useMemo(
    () => (hydrated ? isSectionExpanded(persistKey) : false),
    [hydrated, persistKey]
  );

  // `defaultExpanded` is LATCHED. It carries the ?bubble=<id> deep link, which arrives a
  // render or two after mount (the bubbles store loads in an effect) and then clears
  // itself when the highlight times out. Reading it live would open the section and shut
  // it again 2.4s later; seeding it into useState — the previous behaviour — missed it
  // entirely, so a deep-linked bubble scrolled into view still collapsed.
  const [everDefault, setEverDefault] = useState(defaultExpanded);
  if (defaultExpanded && !everDefault) setEverDefault(true);

  // null until the user touches this section, so a restore or a deep link still speaks.
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? (everDefault || restored);

  // Children stay mounted once opened, so a collapse does not re-fire ~9 requests on the
  // next expand. Derived during render rather than in an effect — the same trick
  // BubbleSections uses, and the reason useHydrated exists.
  const [everExpanded, setEverExpanded] = useState(defaultExpanded);
  if (expanded && !everExpanded) setEverExpanded(true);

  const toggle = () => {
    const next = !expanded;
    setManual(next);
    setSectionExpanded(persistKey, next);
  };

  return (
    <section id={id} className={cn("space-y-3 rounded-sm transition-shadow", className)}>
      <div
        className={cn(
          "flex flex-wrap justify-between gap-2 border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted",
          expanded ? "items-center" : "items-start"
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="group flex min-w-0 flex-1 flex-col gap-2.5 text-left"
        >
          <span className="flex min-w-0 max-w-full items-center gap-2">
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-cyan-700 dark:group-hover:text-cyan-300" />
            )}
            {icon}
            {/* Title over subtitle below `sm`: at 390px they cannot share a line without
                one crushing the other. min-w-0 is what lets `truncate` engage at all. */}
            <span className="flex min-w-0 flex-col items-start gap-x-2 sm:flex-row sm:items-center">
              <span className="terminal-font max-w-full truncate text-sm font-bold uppercase tracking-widest text-foreground">
                {title}
              </span>
              {subtitle && (
                <span className="max-w-full truncate text-[11px] text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </span>
            {expanded && (
              <span className="terminal-font ml-1 hidden shrink-0 items-center gap-1 border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground transition-colors group-hover:text-foreground sm:inline-flex">
                <ChevronUp className="h-3 w-3" /> Hide
              </span>
            )}
          </span>

          {!expanded && (
            <span className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2.5">
              {summary && (
                <span className="terminal-font text-[11px] text-muted-foreground">
                  {summary}
                </span>
              )}
              {/* Full-width and 44px tall on mobile — the minimum the dashboard already
                  uses for "Add areas" and ShowMoreButton. */}
              <span className="terminal-font inline-flex min-h-[44px] items-center justify-center gap-1.5 border border-cyan-600/50 bg-cyan-600/10 px-3 text-[11px] font-bold uppercase tracking-wider text-cyan-700 transition-colors group-hover:bg-cyan-600/20 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:group-hover:bg-cyan-500/20 sm:min-h-0 sm:py-1">
                <ChevronDown className="h-3.5 w-3.5" /> Show market data
              </span>
            </span>
          )}
        </button>
        {actions && <div className="flex flex-wrap items-center gap-1">{actions}</div>}
      </div>

      {everExpanded && (
        <div id={contentId} className={expanded ? "space-y-3" : "hidden"}>
          {children}
        </div>
      )}
    </section>
  );
}
