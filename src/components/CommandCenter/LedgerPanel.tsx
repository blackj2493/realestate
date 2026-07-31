/**
 * LedgerPanel — right-hand property ledger. Columns are persona-driven.
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MapPin, AlertCircle, Zap, ChevronUp, ChevronDown, ChevronsUpDown, Eye, ListFilter, GitCompareArrows, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEARCH_BRAND } from "@/lib/brand";
import LedgerRow from "./LedgerRow";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import type { SalePriceEstimate } from "@/lib/avm/salePrice";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { passesDealGrade, MIN_GRADE_OPTIONS } from "@/lib/dealScore/gradeFilter";
import { PERSONA_CONFIG, type ColumnType } from "@/lib/personas/personaConfig";
import { SORTABLE_COLUMN_TYPES, DEFAULT_SORT_DIR, compareByColumn, fitLedgerColumns, dropEmptyColumns, type SortDir } from "./columnSort";
import { makeCohortRanker } from "./cohortPercentiles";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOpenListing } from "@/hooks/useOpenListing";

interface LedgerPanelProps {
  className?: string;
}

export default function LedgerPanel({ className }: LedgerPanelProps) {
  const { activePersona, searchResult, isLoading, error, totalCount, selectedProperty, location, hoveredId, setHoveredId, selectedIds, showSelectedOnly, setShowSelectedOnly, clearSelected, toggleSelected, activeLayers, soldWindowDays, mapBounds, drawPolygon, minDealGrade, setMinDealGrade } =
    useCommandCenterStore();

  // Scope chip (fix #4): with no typed place and no draw area, the results are
  // scoped to the visible map extent (first-load viewport scoping / "search this
  // map area"), not to a named place — say so explicitly rather than leaving the
  // count reading like a province-wide total.
  const viewportScoped = Boolean(mapBounds) && !location && !drawPolygon;
  const isAuthed = useIsAuthed();
  // Mobile → full report; desktop → in-page Quick Look drawer.
  const openListing = useOpenListing();

  // Card vs. column layout is DEVICE-driven, not panel-width-driven: desktop
  // always gets the sortable column grid (the whole point of the terminal),
  // mobile keeps the merged card. `md` (≤767px) mirrors the page layout, which
  // also switches the ledger to full-width / map-hidden at the same breakpoint.
  const cardMode = useIsMobile(767);

  // Within the desktop column grid, the panel is drag-resizable (620px default,
  // 400–1000px). The fixed numeric columns starve the flex-1 address card at
  // narrow widths — audit C4: at 620px every column showing clipped the price to
  // "$8…". So we width-fit: keep the address card + as many analytical columns
  // as fit, dropping the non-sortable alphaFlag first (see fitLedgerColumns).
  // ResizeObserver reads the panel's own width, which the resizable desktop panel
  // needs (viewport breakpoints can't see panel width).
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(620);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = PERSONA_CONFIG[activePersona].columns;
  const allProperties = searchResult?.listings || [];
  const visible = showSelectedOnly ? allProperties.filter((p) => selectedIds.has(p.id)) : allProperties;
  // Min-deal-grade filter (authed only): narrow the LOADED rows to the active-lens grade
  // floor, using the same per-row score the grade pill shows. Memoised on `visible` (a stable
  // ref unless a query/selection changes) so hover re-renders don't re-run the score.
  const dealFiltered = useMemo(
    () => (isAuthed && minDealGrade ? visible.filter((p) => passesDealGrade(p, activePersona, minDealGrade)) : visible),
    [visible, isAuthed, minDealGrade, activePersona]
  );
  const ms = searchResult?.processingTimeMs ?? 0;

  // Multi-select basket → quick actions (isolate / compare / clear) surfaced right on
  // the list, so a selection made with the row checkboxes is actionable without opening
  // Tools → Compare. `showSelectedOnly` filters both this ledger and the map (page.tsx).
  const selectedCount = selectedIds.size;
  const compareHref = useMemo(
    () => `/properties/compare?ids=${encodeURIComponent(Array.from(selectedIds).join(","))}&lens=${activePersona}`,
    [selectedIds, activePersona]
  );

  // Adaptive columns (fix #21): drop any column no row in the result set can
  // populate — most visibly Alpha Flag, which is all "—" on the homebuyer lens
  // (and for anon, whose VOW-gated flags collapse to none). Computed over the
  // FULL result set (like the percentile ranker) rather than the selection view
  // so the column set is stable as the user selects/hides rows. Feeding this into
  // the width-fit keeps the header and every row iterating the same list, so the
  // flex grid stays aligned; the address card is always kept.
  const populatedColumns = useMemo(
    () => dropEmptyColumns(columns, searchResult?.listings ?? [], isAuthed),
    [columns, searchResult, isAuthed]
  );
  const visibleColumns = useMemo(() => fitLedgerColumns(populatedColumns, width), [populatedColumns, width]);

  // Client-side column sort over the already-loaded set (instant, no refetch).
  // null = persona/server default order. Cleared on persona change so a sort
  // can't outlive its column — done via the "adjust state during render" pattern
  // (https://react.dev/learn/you-might-not-need-an-effect) rather than an effect.
  const [sort, setSort] = useState<{ type: ColumnType; dir: SortDir } | null>(null);
  const [sortPersona, setSortPersona] = useState(activePersona);
  if (activePersona !== sortPersona) {
    setSortPersona(activePersona);
    setSort(null);
  }

  const toggleSort = (type: ColumnType) =>
    setSort((prev) =>
      prev?.type === type
        ? { type, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { type, dir: DEFAULT_SORT_DIR[type] ?? "desc" }
    );

  const properties = useMemo(
    () => (sort ? [...dealFiltered].sort(compareByColumn(sort.type, sort.dir)) : dealFiltered),
    [dealFiltered, sort]
  );

  // Percentile context (#1): rank each numeric cell against the FULL result set
  // (not the selection-isolated view) so "P88" is stable as the user selects rows.
  // Depend on the result object (stable until a new query), not the `|| []`
  // fallback above, which is a fresh array every render.
  const ranker = useMemo(() => makeCohortRanker(searchResult?.listings ?? []), [searchResult]);

  // The single Estimated Sale Price for the visible ACTIVE rows, batched (VOW-gated →
  // authed only). One call per result set, deduped to distinct cohorts server-side; sold/
  // leased/de-listed comps are skipped (the "likely close" is a live-ask concept).
  const [salePriceById, setSalePriceById] = useState<Record<string, SalePriceEstimate | null>>({});
  const saleItems = useMemo(
    () =>
      visible
        .filter((p) => !p.compKind && !p.IsSoldComp && p.ListPrice && p.ListPrice > 0)
        .slice(0, 120)
        .map((p) => ({ id: p.id, listPrice: p.ListPrice, city: p.City, propertySubType: p.PropertySubType })),
    [visible]
  );
  const saleKey = useMemo(() => saleItems.map((i) => i.id).join(","), [saleItems]);
  useEffect(() => {
    // No fetch when signed out or nothing to price; display is gated by isAuthed below,
    // so stale-by-id entries are never read (avoids a synchronous reset in the effect).
    if (!isAuthed || saleItems.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/estimates/sale-price", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: saleItems }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setSalePriceById(data?.salePrices ?? {});
      } catch {
        /* additive — leave rows without the line */
      }
    })();
    return () => {
      cancelled = true;
    };
    // saleKey captures row membership; saleItems is derived from the same source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleKey, isAuthed]);

  return (
    <div ref={rootRef} className={cn("flex h-full flex-col border-l border-border bg-background", className)}>
      {/* Typesense stat header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Zap className="h-3.5 w-3.5 text-cyan-700 dark:text-cyan-400" />
        <p className="font-mono text-xs text-muted-foreground">
          {(activeLayers.has("sold") || activeLayers.has("leased") || activeLayers.has("delisted")) ? (
            <>
              <span className="font-semibold text-cyan-700 dark:text-cyan-400">{totalCount.toLocaleString()}</span> Comps
              <span className="mx-1.5 text-muted-foreground">|</span>
              {/* The de-listed fetch is capped at 90d while sold/leased go to 180d:
                  delisted-only shows the clamped figure; a mixed view annotates both
                  so the label never overstates the de-listed coverage. */}
              VOW · last{" "}
              <span className="text-cyan-700 dark:text-cyan-400">
                {!activeLayers.has("sold") && !activeLayers.has("leased") && activeLayers.has("delisted")
                  ? Math.min(soldWindowDays, 90)
                  : soldWindowDays}
                d
              </span>
              {activeLayers.has("delisted") &&
                (activeLayers.has("sold") || activeLayers.has("leased")) &&
                soldWindowDays > 90 && <span className="text-muted-foreground"> · de-listed 90d</span>}
            </>
          ) : (
            <>
              {SEARCH_BRAND}:{" "}
              <span className="font-semibold text-cyan-700 dark:text-cyan-400">{totalCount.toLocaleString()}</span> Active Listings
              <span className="mx-1.5 text-muted-foreground">|</span>
              Instant Query <span className="text-cyan-700 dark:text-cyan-400">&lt;{ms}ms</span>
            </>
          )}
        </p>
        {viewportScoped && (
          <span
            title="Results are scoped to the visible map area. Pan or zoom the map, or search a place, to change the scope."
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-sm border border-cyan-500/40 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-700 dark:text-cyan-300"
          >
            <MapPin className="h-3 w-3" /> Map area
          </span>
        )}
      </div>

      {/* Minimum Deal Score grade — narrows the LOADED rows to a grade floor for the active
          lens (client-side; the score isn't indexed) and drives the map via the store.
          Consumer-only: the grade is VOW-derived, shown only to authed users. */}
      {isAuthed && allProperties.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Min deal grade</span>
          <div className="ml-auto flex items-center gap-1">
            {MIN_GRADE_OPTIONS.map((g) => {
              const on = minDealGrade === g;
              return (
                <button
                  key={g ?? "any"}
                  type="button"
                  onClick={() => setMinDealGrade(g)}
                  aria-pressed={on}
                  title={g ? `Only homes grading ${g} or better (this lens)` : "No deal-grade floor"}
                  className={cn(
                    "rounded border px-2 py-0.5 font-mono text-[11px] font-bold transition-colors",
                    on
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {g ? `≥${g}` : "Any"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Selection quick-actions — appears the moment a row is checked, on BOTH the mobile
          card list and the desktop pane. Filter the list (and map) to just the picks, jump
          to a side-by-side compare, or clear — no need to open Tools → Compare to reach the
          isolate toggle. Same `showSelectedOnly` / compare route the Compare drawer uses. */}
      {selectedCount > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-cyan-500/5 px-3 py-2">
          <span className="text-xs font-semibold text-foreground">{selectedCount} selected</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowSelectedOnly(!showSelectedOnly)}
              aria-pressed={showSelectedOnly}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                showSelectedOnly
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-700 dark:text-cyan-200"
                  : "border-border bg-card text-foreground hover:border-cyan-500/40"
              )}
            >
              {showSelectedOnly ? <ListFilter className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showSelectedOnly ? "Show all" : "Show selected"}
            </button>
            <Link
              href={compareHref}
              aria-disabled={selectedCount < 2}
              title={selectedCount < 2 ? "Select at least 2 to compare" : "Compare side by side"}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                selectedCount >= 2
                  ? "border-border bg-card text-foreground hover:border-cyan-500/40"
                  : "pointer-events-none border-border text-muted-foreground opacity-50"
              )}
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </Link>
            <button
              type="button"
              onClick={clearSelected}
              aria-label="Clear selection"
              title="Clear selection"
              className="flex items-center justify-center rounded-md border border-border px-2 py-1.5 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Column headers — desktop only (mobile card mode has no columns to sort).
          Mirrors the width-fitted `visibleColumns` so each header aligns with its cell. */}
      <div className={cn("shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-2", cardMode ? "hidden" : "flex")}>
        <div className="w-5 shrink-0" />
        <div className="h-px w-24 shrink-0" />
        {visibleColumns.map((col) => {
          const headClass = cn(
            "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground",
            col.width,
            col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
          );
          // True DOM is VOW-gated for anon (§6.2(f)) — disable its sort header too,
          // so its hidden value can't be inferred from row ordering.
          const sortable = SORTABLE_COLUMN_TYPES.has(col.type) && (isAuthed || col.type !== "trueDom");
          if (!sortable) {
            return (
              <div key={col.type} className={headClass}>
                {col.header}
              </div>
            );
          }
          const active = sort?.type === col.type;
          return (
            <button
              key={col.type}
              type="button"
              onClick={() => toggleSort(col.type)}
              aria-label={`Sort by ${col.header}`}
              title={`Sort by ${col.header}`}
              className={cn(
                headClass,
                // Sortable headers read brighter than the inert alphaFlag header and
                // carry a persistent sort glyph, so it's obvious at rest that they
                // click to sort — not just on hover or once already sorted.
                "group flex cursor-pointer items-center gap-0.5 text-muted-foreground transition-colors hover:text-foreground",
                active && "text-cyan-700 dark:text-cyan-400 hover:text-cyan-400",
                col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start"
              )}
            >
              <span className="truncate">{col.header}</span>
              {active ? (
                sort!.dir === "asc" ? (
                  <ChevronUp className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )
              ) : (
                // Faint up/down glyph = "this column is sortable"; brightens on hover.
                <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
              )}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-cyan-700 dark:text-cyan-400" />
            <span className="text-sm text-muted-foreground">SCANNING MARKET DATA...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <AlertCircle className="mb-3 h-8 w-8 text-rose-700 dark:text-rose-400" />
            <span className="mb-1 text-sm text-rose-700 dark:text-rose-400">Search Error</span>
            <span className="text-center text-xs text-muted-foreground">{error}</span>
          </div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MapPin className="mb-3 h-8 w-8 text-muted-foreground" />
            <span className="mb-1 text-sm text-muted-foreground">No Assets Found</span>
            <span className="text-xs text-muted-foreground">
              {isAuthed && minDealGrade && allProperties.length > 0
                ? `None of the ${allProperties.length} loaded homes grade ${minDealGrade} or better — lower the minimum, or pan/zoom to load more.`
                : location
                  ? `No properties in ${location}`
                  : "Adjust your filters to expand search"}
            </span>
          </div>
        ) : (
          properties.map((property) => (
            <LedgerRow
              key={property.id}
              property={property}
              columns={columns}
              visibleColumns={visibleColumns}
              salePrice={isAuthed ? salePriceById[property.id] : undefined}
              compact={cardMode}
              isAuthed={isAuthed}
              onClick={() => openListing(property)}
              isSelected={selectedProperty?.id === property.id}
              isHovered={hoveredId === property.id}
              onHoverChange={(hovered) => setHoveredId(hovered ? property.id : null)}
              isChecked={selectedIds.has(property.id)}
              onToggleSelect={() => toggleSelected(property.id)}
              ranker={ranker}
            />
          ))
        )}
      </div>

      {/* TRREB §6.3(i)/(k): reliability + bona-fide notice — PERSISTENT on the terminal (the
          primary IDX display surface), not only when a sold/leased/de-listed VOW layer is on. */}
      <ListingComplianceNotice compact className="shrink-0 border-t border-border bg-card px-3 py-1.5" />

      {/* Footer */}
      <div className="shrink-0 border-t border-border bg-card px-3 py-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{isLoading ? "Scanning..." : `${properties.length} shown · ${totalCount.toLocaleString()} total`}</span>
          <span className="font-mono">PROPTX MLS®</span>
        </div>
      </div>
    </div>
  );
}
