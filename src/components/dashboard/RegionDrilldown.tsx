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
 *
 * WHY THE BOX WAS NOT ENOUGH. The row title still carried the band heading's exact
 * type — mono, bold, uppercase, `tracking-widest` — and white-on-`#e9edf4` is too
 * soft a step to beat identical type, so the row kept reading as a label. Four
 * changes finish the job:
 *   1. Two type RANKS. The band label goes quiet (see BubbleSections); the row
 *      title becomes an object — sans, 15px, sentence case, full contrast.
 *   2. One tinted control per row, at the RIGHT edge where the eye checks for the
 *      row's action. "Open in Terminal" drops to a ghost (BubbleMarketSection), so
 *      nothing competes with "Show market data" any more.
 *   3. A chevron that reads as a control: accent-coloured, in a hit-sized disc,
 *      and it ROTATES rather than swapping glyph.
 *   4. `autoOpenFirstRun` — one section opens itself on a device that has never
 *      recorded a section choice, so the pattern is demonstrated once instead of
 *      described. See sectionState.noSectionChoiceMade.
 *
 * MOBILE. The header is an explicit `flex-col sm:flex-row` stack, never a wrapping
 * row. Wrapping let the action cluster's widest child (the All listings / My
 * filters segmented control, ~186px) set a floor on the same flex line as the
 * title, which squeezed the title to an ellipsis and broke the actions into a
 * ragged three-line block. Anything that wide now goes to `mobileDetail` below `lg`.
 * Icon controls take 44px targets below `sm` — the rule this file already stated for
 * the button and nothing else obeyed.
 */

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import {
  isSectionExpanded,
  noSectionChoiceMade,
  setSectionExpanded,
} from "@/lib/dashboard/sectionState";
import { useHydrated } from "@/lib/theme/useHydrated";

/**
 * The collapsed peek, in plain language: what a press actually produces.
 *
 * Deliberately an INVENTORY, not a statistic. A live count ("42 new this week") would
 * cost one request per collapsed section and undo the reason the section is collapsed;
 * this is derived from props already in hand and is free.
 *
 * Says "market boards", not "boards": the bare noun is our word for the widget, not the
 * reader's, and the peek is the one line that has to earn the press (voice.md §5.1).
 */
export function sectionSummary(lens: MarketActivityLens, boardCount: number): string {
  const columns =
    lens.transactionType === "lease"
      ? "New and leased listings"
      : "New and sold listings";
  if (boardCount <= 0) return columns;
  return `${columns}, prices and ${boardCount} market board${boardCount === 1 ? "" : "s"}`;
}

export default function RegionDrilldown({
  title,
  subtitle,
  icon,
  actions,
  mobileDetail,
  summary,
  defaultExpanded = false,
  autoOpenFirstRun = false,
  persistKey,
  id,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  /**
   * Controls too wide for a narrow header (the alert-scope pair). Rendered full width
   * inside the EXPANDED body below `lg`, and nowhere at all above it — the caller keeps
   * showing them in `actions` on wide screens. The cut is `lg`, not `sm`: on a tablet the
   * pair still leaves the title barely 150px once the button and icons take their share.
   */
  mobileDetail?: ReactNode;
  /** One-line peek shown under the title when collapsed — say what expanding yields. */
  summary?: ReactNode;
  defaultExpanded?: boolean;
  /**
   * Opt this section in as the ONE that opens itself on a device with no section choice
   * recorded yet. Costs one area's requests, once, and is then persisted like any manual
   * open. Callers must set it on a single section — see BubbleSections / DashboardClient.
   */
  autoOpenFirstRun?: boolean;
  /**
   * Namespaced key (`bubble:<uuid>`, `city:<region>`) under which this section's open
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

  // Same hydration dance, same reason. Deps stay `[hydrated]` so the answer cannot flip
  // under the effect below, which writes the very key this reads.
  const firstRun = useMemo(() => (hydrated ? noSectionChoiceMade() : false), [hydrated]);
  const autoOpen = autoOpenFirstRun && firstRun;

  // `defaultExpanded` is LATCHED. It carries the ?bubble=<id> deep link, which arrives a
  // render or two after mount (the bubbles store loads in an effect) and then clears
  // itself when the highlight times out. Reading it live would open the section and shut
  // it again 2.4s later; seeding it into useState — the previous behaviour — missed it
  // entirely, so a deep-linked bubble scrolled into view still collapsed.
  const [everDefault, setEverDefault] = useState(defaultExpanded);
  if (defaultExpanded && !everDefault) setEverDefault(true);

  // null until the user touches this section, so a restore, a deep link or the first-run
  // auto-open still speaks.
  const [manual, setManual] = useState<boolean | null>(null);
  const expanded = manual ?? (everDefault || restored || autoOpen);

  // Children stay mounted once opened, so a collapse does not re-fire ~9 requests on the
  // next expand. Derived during render rather than in an effect — the same trick
  // BubbleSections uses, and the reason useHydrated exists.
  const [everExpanded, setEverExpanded] = useState(defaultExpanded);
  if (expanded && !everExpanded) setEverExpanded(true);

  // Record the auto-open so it happens exactly ONCE. Left unwritten, the key stays null
  // and every later visit re-opens this section — and re-fires its requests — for a user
  // who still has not chosen anything.
  useEffect(() => {
    if (autoOpen && manual === null) setSectionExpanded(persistKey, true);
  }, [autoOpen, manual, persistKey]);

  const toggle = () => {
    const next = !expanded;
    setManual(next);
    setSectionExpanded(persistKey, next);
  };

  return (
    <section id={id} className={cn("space-y-3 rounded-sm transition-shadow", className)}>
      <div className="flex flex-col gap-3 border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={contentId}
          className="group flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600/60 dark:focus-visible:ring-cyan-400/60"
        >
          {/* Accent, disc, and a rotation rather than a glyph swap — the chevron used to
              be the faintest mark on the row while holding its strongest position. */}
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-600/10 text-cyan-700 transition-transform duration-200 motion-reduce:transition-none dark:bg-cyan-500/10 dark:text-cyan-300",
              expanded && "rotate-90"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </span>
          {icon}
          <span className="flex min-w-0 flex-col gap-0.5">
            {/* Title over subtitle below `sm`: at 390px they cannot share a line without
                one crushing the other. min-w-0 is what lets `truncate` engage at all. */}
            <span className="flex min-w-0 flex-col items-start gap-x-2 sm:flex-row sm:items-baseline">
              <span className="max-w-full truncate text-[15px] font-semibold leading-snug text-foreground">
                {title}
              </span>
              {subtitle && (
                <span className="max-w-full truncate text-[11px] text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </span>
            {!expanded && summary && (
              <span className="max-w-full text-xs leading-snug text-muted-foreground">
                {summary}
              </span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-1.5 sm:shrink-0">
          {/* A second face on the SAME action, at the edge the eye checks for a row's
              button. Hidden from the a11y tree: the row button above already carries the
              name, the state and the keyboard path, and two controls for one region would
              simply be announced twice. */}
          <button
            type="button"
            onClick={toggle}
            aria-hidden="true"
            tabIndex={-1}
            className={cn(
              "terminal-font inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 border px-3 text-[11px] uppercase tracking-wider transition-colors sm:min-h-0 sm:flex-none sm:py-1.5",
              expanded
                ? "border-border text-muted-foreground hover:text-foreground"
                : "border-cyan-600/50 bg-cyan-600/10 font-bold text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
            )}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3.5 w-3.5" /> Hide
              </>
            ) : (
              <>
                Show market data <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
          {actions}
        </div>
      </div>

      {everExpanded && (
        <div id={contentId} className={expanded ? "space-y-3" : "hidden"}>
          {mobileDetail && <div className="lg:hidden">{mobileDetail}</div>}
          {children}
        </div>
      )}
    </section>
  );
}
