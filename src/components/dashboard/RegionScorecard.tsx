"use client";

/**
 * Region Scorecard — a sortable head-to-head comparison of the user's market areas on
 * metrics HouseSigma/Realtor.ca don't surface (months of supply, sold-to-list, market
 * temperature), every one a TRUTHFUL full-population aggregate (see marketAggregates.ts).
 * Aggregates only — no listing rows — so the §6.3(b) display cap doesn't apply.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronDown } from "lucide-react";
import { fetchRegionScores, type RegionScore } from "@/lib/dashboard/marketAggregates";
import type { BasementFilter } from "@/lib/dashboard/config";
import {
  TEMP,
  YoY,
  Sparkline,
  TemperatureBadge,
  compactPrice,
  orDash,
} from "@/components/dashboard/metricViz";
import { cn } from "@/lib/utils";
import { regionMapHref } from "@/lib/dashboard/area";
import VowGateOverlay from "@/components/auth/VowGateOverlay";
import { ModuleHead } from "@/components/daylight/primitives";
import { formatRegionLabel } from "@/lib/regions/formatRegionLabel";

type SortKey =
  | "region"
  | "medianPrice"
  | "medianPpsf"
  | "activeCount"
  | "monthsOfSupply"
  | "trueDom"
  | "soldToListPct"
  | "sellThroughPct"
  | "medianCapRate"
  | "temperature";

const GRID =
  "grid-cols-[minmax(130px,1.5fr)_minmax(150px,1.4fr)_minmax(84px,0.9fr)_minmax(72px,0.8fr)_minmax(90px,0.9fr)_minmax(96px,1fr)_minmax(84px,0.9fr)_minmax(96px,1fr)_minmax(88px,0.9fr)_minmax(78px,0.8fr)]";

/**
 * Headings stay terse — this is the terminal, and the dense grid is the point
 * (voice.md §5.1). `hint` is the plain-language translation, surfaced on hover
 * so nobody has to already know the vocabulary to read the table. Write hints
 * for someone buying their first house: no jargon, and if a term is unavoidable
 * ("cap rate") say what it means in the same breath.
 */
const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; hint: string }[] = [
  { key: "region", label: "Region", align: "left", hint: "The city or district. Click a name to see its listings." },
  {
    key: "medianPrice",
    label: "Median Price",
    align: "right",
    hint: "The middle price of homes that sold — half went for more, half for less. We use the middle rather than the average so one unusually expensive sale can't drag the number up.",
  },
  {
    key: "medianPpsf",
    label: "$/Sqft",
    align: "right",
    hint: "Middle sale price per square foot. The fairest way to compare areas when the homes are different sizes.",
  },
  { key: "activeCount", label: "Active", align: "right", hint: "How many homes are for sale here right now." },
  {
    key: "monthsOfSupply",
    label: "Mo. Supply",
    align: "right",
    hint: "How many months it would take to sell every home currently for sale, at the pace they're selling now. Under 4 months favours sellers; over 6 favours buyers.",
  },
  {
    key: "trueDom",
    label: "True DoM",
    align: "right",
    hint: "How long the typical home for sale has been on the market — counted from the first day it was listed, so pulling it and relisting to look fresh doesn't hide the wait. \"% stale\" is the share sitting 60+ days.",
  },
  {
    key: "soldToListPct",
    label: "Sold/List",
    align: "right",
    hint: "What homes actually sold for, compared with what they were asking. Below 100% means buyers are negotiating the price down; above means bidding wars.",
  },
  {
    key: "sellThroughPct",
    label: "Sell-Thru",
    align: "right",
    hint: "Of the homes that stopped being for sale in the past year, the share that actually sold — the rest gave up without a sale. A home taken off the market and listed again counts as a sale if it eventually sold.",
  },
  {
    key: "medianCapRate",
    label: "Cap Rate",
    align: "right",
    hint: "If you bought the typical home for sale here and rented it out, this is the yearly return after running costs like taxes, insurance and upkeep — but before mortgage payments. The rent is our estimate, not a signed lease.",
  },
  {
    key: "temperature",
    label: "Temp",
    align: "right",
    hint: "Whether the market currently favours buyers or sellers, based on months of supply and how close homes sell to their asking price.",
  },
];

function sortValue(s: RegionScore, key: SortKey): number | string | null {
  if (key === "region") return s.region.toLowerCase();
  if (key === "temperature") return s.temperature ? TEMP[s.temperature].rank : null;
  return s[key] as number | null;
}

export default function RegionScorecard({
  regions,
  propertyTypes,
  minBeds = 0,
  minBaths = 0,
  minGarage = 0,
  minFrontage = 0,
  basement = "any",
  onClearFilters,
}: {
  regions: string[];
  /** Global lens property-type keys ([] = all). Drives the sold/active aggregates. */
  propertyTypes: string[];
  /** Global lens beds/baths/parking/frontage floors (0 = no floor). Scope sold + active medians (Phase C). */
  minBeds?: number;
  minBaths?: number;
  minGarage?: number;
  minFrontage?: number;
  /** Global lens basement finish (any = no filter). Scopes sold + active medians (migration 043). */
  basement?: BasementFilter;
  /** Reset the lens's property filters (keeps the time window + sale/lease). When
   *  provided, a prominent "Filtered view" cue with a Clear action appears whenever
   *  a filter is active — so the reshaped numbers never look like the full population. */
  onClearFilters?: () => void;
}) {
  const [scores, setScores] = useState<RegionScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Stable dependencies so the effect doesn't re-fire on every parent render.
  const regionsKey = regions.join("|");
  const typesKey = [...propertyTypes].sort().join(",");
  const scopeKey = `${minBeds}|${minBaths}|${minGarage}|${minFrontage}|${basement}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    // One batched request for all regions (server runs the VOW gate once + fans out the
    // aggregates in parallel), replacing the old N×4 client fetch storm.
    fetchRegionScores(regions, propertyTypes, {
      minBeds,
      minBaths,
      minParking: minGarage,
      minFrontage,
      basement,
    })
      .then((next) => {
        if (alive) setScores(next);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionsKey, typesKey, scopeKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return scores;
    const arr = [...scores];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always last
      if (bv == null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [scores, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "region" ? "asc" : "desc");
    }
  };

  if (regions.length === 0) return null;

  // Human-readable list of the active lens filters, for the disclosure footnote.
  const filterParts = [
    propertyTypes.length > 0
      ? `your selected property type${propertyTypes.length > 1 ? "s" : ""}`
      : null,
    minBeds > 0 ? `${minBeds}+ beds` : null,
    minBaths > 0 ? `${minBaths}+ baths` : null,
    minGarage > 0 ? `${minGarage}+ parking` : null,
    minFrontage > 0 ? `${minFrontage}+ ft frontage` : null,
    basement !== "any" ? `${basement} basement` : null,
  ].filter(Boolean) as string[];

  // VOW gate: when every row came back locked (anonymous), blur the grid and
  // surface a single sign-in overlay instead of a wall of "—".
  const locked = !loading && scores.length > 0 && scores.every((s) => s.locked);

  return (
    <section className="space-y-2">
      <ModuleHead title="Region Scorecard" right="full-population · daily sync" />

      {/* #18 — a filtered scorecard silently reshapes every number below. Surface a
          prominent cue (not just the fine-print footnote) with a one-click Clear, so
          the reader always knows these aren't the full-population figures. */}
      {onClearFilters && filterParts.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-1.5">
          <span className="terminal-font text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            Filtered view
          </span>
          <span className="text-[11px] text-muted-foreground">
            Every number below reflects {filterParts.join(" · ")}.
          </span>
          <button
            type="button"
            onClick={onClearFilters}
            className="terminal-font ml-auto text-[10px] font-semibold uppercase tracking-wider text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-400"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Mobile-only affordance: the 1000px table scrolls horizontally; tell the user. */}
      <p className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground md:hidden">
        ← Scroll for more metrics →
      </p>

      {/* `after:` right-edge fade (md:hidden) signals more columns scroll off-screen.
          from-background so the fade matches the page ground in both themes. */}
      <div className="dt-panel dt-reg relative overflow-x-auto border border-border bg-card after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:bg-gradient-to-l after:from-background after:to-transparent dark:bg-transparent md:after:hidden">
        <div className={cn("min-w-[1000px]", locked && "blur-sm select-none")}>
          {/* Header */}
          <div className={`grid ${GRID} border-b border-border bg-card/60`}>
            {COLUMNS.map((c) => {
              const active = sortKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  title={c.hint}
                  onClick={() => onSort(c.key)}
                  className={`terminal-font flex items-center gap-1 px-2 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors hover:text-cyan-700 dark:hover:text-cyan-300 ${
                    c.align === "right" ? "justify-end" : "justify-start"
                  } ${active ? "text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"}`}
                >
                  {c.label}
                  {active &&
                    (sortDir === "asc" ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    ))}
                </button>
              );
            })}
          </div>

          {/* Rows */}
          {loading
            ? regions.map((r) => (
                <div key={r} className={`grid ${GRID} border-b border-border/60`}>
                  {COLUMNS.map((c) => (
                    <div key={c.key} className="px-2 py-3">
                      <div className="h-3 w-full animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              ))
            : sorted.map((s) => (
                <div
                  key={s.region}
                  className={`grid ${GRID} items-center border-b border-border/60 transition-colors hover:bg-card/40`}
                >
                  {/* Region — opens by CAMERA where we can place it, so browsing a saved
                      area doesn't pin the terminal to a text query the user never typed. */}
                  <Link
                    href={regionMapHref(s.region)}
                    className="terminal-font flex items-center gap-1 px-2 py-3 text-[13px] font-semibold text-foreground hover:text-cyan-700 dark:hover:text-cyan-300"
                  >
                    <span className="truncate" title={s.region}>{formatRegionLabel(s.region)}</span>
                    <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </Link>

                  {/* Median Price + sparkline + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <div className="flex w-full items-center justify-end gap-2">
                      <Sparkline data={s.priceSeries} />
                      <span className="terminal-font text-[13px] font-bold text-cyan-700 dark:text-cyan-400">
                        {orDash(s.medianPrice, compactPrice)}
                      </span>
                    </div>
                    <YoY pct={s.yoyPct} />
                  </div>

                  {/* $/Sqft + YoY */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <span className="terminal-font text-[13px] text-foreground">
                      {orDash(s.medianPpsf, (n) => `$${Math.round(n)}`)}
                    </span>
                    <YoY pct={s.ppsfYoyPct} />
                  </div>

                  <Cell>{orDash(s.activeCount, (n) => n.toLocaleString())}</Cell>
                  <Cell>{orDash(s.monthsOfSupply, (n) => n.toFixed(1))}</Cell>

                  {/* True DoM (primary market-pace metric) + % stale, its derivative, folded in */}
                  <div className="flex flex-col items-end gap-0.5 px-2 py-2">
                    <span className="terminal-font text-[13px] text-foreground">{orDash(s.trueDom, (n) => `${n}d`)}</span>
                    {s.stalePct != null && (
                      <span className="terminal-font text-[10px] text-muted-foreground">{s.stalePct.toFixed(0)}% stale</span>
                    )}
                  </div>

                  <Cell>{orDash(s.soldToListPct, (n) => `${n.toFixed(1)}%`)}</Cell>
                  <Cell>{orDash(s.sellThroughPct, (n) => `${Math.round(n)}%`)}</Cell>
                  <Cell>{orDash(s.medianCapRate, (n) => `${n.toFixed(1)}%`)}</Cell>

                  {/* Temperature */}
                  <div className="flex justify-end px-2 py-3">
                    <TemperatureBadge temperature={s.temperature} />
                  </div>
                </div>
              ))}
        </div>
        {locked && <VowGateOverlay message="Sign in to view region market stats" />}
      </div>

      {/* One always-visible honesty line (the single thing readers misread), with the fuller
          glossary + sample thresholds tucked into a tap-to-open disclosure — reachable on
          phones, where the column-heading tooltips (title=) can't be hovered, without a wall
          of text dominating the view. The active-filter restatement that used to live here is
          dropped: the amber "Filtered view" banner above already carries it. */}
      <div className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          Sold-based columns (Median Price, $/sqft, Sold/List, Mo. Supply, Sell-Thru) trail the market by
          a few months. A dash means too few recent sales to trust &mdash; never zero.
        </p>
        <details className="group">
          <summary className="terminal-font inline-flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-700 marker:content-none [&::-webkit-details-marker]:hidden hover:underline dark:text-cyan-400">
            <span>How to read this</span>
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              The three terms that trip people up:{" "}
              <strong className="font-semibold text-foreground">True DoM</strong> — how long the typical
              home for sale has been listed, counted from the day it first went up, so pulling it and
              relisting can&rsquo;t reset the clock.{" "}
              <strong className="font-semibold text-foreground">Sell-Thru</strong> — of the homes that
              stopped being for sale, the share that actually sold rather than giving up.{" "}
              <strong className="font-semibold text-foreground">Cap Rate</strong> — the yearly return on a
              rental after running costs, before mortgage payments. Hover any column heading for the rest.
            </p>
            <p>
              Active, True DoM, % stale and Cap Rate describe what is for sale <em>today</em>; the
              sold-based columns come from homes that have <em>already sold</em>. A dash shows until there
              are enough recent sales to trust the number: 10 sales for the price columns, 5 priced
              listings for Cap Rate, 10 for True DoM, and 30 finished listings for Sell-Thru.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return (
    <div className="terminal-font px-2 py-3 text-right text-[13px] text-foreground">{children}</div>
  );
}

