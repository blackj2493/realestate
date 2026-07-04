/**
 * LedgerPanel — right-hand property ledger. Columns are persona-driven.
 */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MapPin, AlertCircle, Zap, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { SEARCH_BRAND } from "@/lib/brand";
import LedgerRow from "./LedgerRow";
import type { SalePriceEstimate } from "@/lib/avm/salePrice";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG, type ColumnType } from "@/lib/personas/personaConfig";
import { SORTABLE_COLUMN_TYPES, DEFAULT_SORT_DIR, compareByColumn, fitLedgerColumns, type SortDir } from "./columnSort";
import { makeCohortRanker } from "./cohortPercentiles";
import { useIsAuthed } from "@/hooks/useIsAuthed";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOpenListing } from "@/hooks/useOpenListing";

interface LedgerPanelProps {
  className?: string;
}

export default function LedgerPanel({ className }: LedgerPanelProps) {
  const { activePersona, searchResult, isLoading, error, totalCount, selectedProperty, location, hoveredId, setHoveredId, selectedIds, showSelectedOnly, toggleSelected, activeLayers, soldWindowDays } =
    useCommandCenterStore();
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
  const visibleColumns = useMemo(() => fitLedgerColumns(columns, width), [columns, width]);
  const allProperties = searchResult?.listings || [];
  const visible = showSelectedOnly ? allProperties.filter((p) => selectedIds.has(p.id)) : allProperties;
  const ms = searchResult?.processingTimeMs ?? 0;

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
    () => (sort ? [...visible].sort(compareByColumn(sort.type, sort.dir)) : visible),
    [visible, sort]
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
        <Zap className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        <p className="font-mono text-xs text-muted-foreground">
          {(activeLayers.has("sold") || activeLayers.has("leased") || activeLayers.has("delisted")) ? (
            <>
              <span className="font-semibold text-cyan-600 dark:text-cyan-400">{totalCount.toLocaleString()}</span> Comps
              <span className="mx-1.5 text-muted-foreground">|</span>
              {/* The de-listed fetch is capped at 90d while sold/leased go to 180d:
                  delisted-only shows the clamped figure; a mixed view annotates both
                  so the label never overstates the de-listed coverage. */}
              VOW · last{" "}
              <span className="text-cyan-600 dark:text-cyan-400">
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
              <span className="font-semibold text-cyan-600 dark:text-cyan-400">{totalCount.toLocaleString()}</span> Active Listings
              <span className="mx-1.5 text-muted-foreground">|</span>
              Instant Query <span className="text-cyan-600 dark:text-cyan-400">&lt;{ms}ms</span>
            </>
          )}
        </p>
      </div>

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
                active && "text-cyan-600 dark:text-cyan-400 hover:text-cyan-400",
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
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-cyan-600 dark:text-cyan-400" />
            <span className="text-sm text-muted-foreground">SCANNING MARKET DATA...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <AlertCircle className="mb-3 h-8 w-8 text-rose-600 dark:text-rose-400" />
            <span className="mb-1 text-sm text-rose-600 dark:text-rose-400">Search Error</span>
            <span className="text-center text-xs text-muted-foreground">{error}</span>
          </div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MapPin className="mb-3 h-8 w-8 text-muted-foreground" />
            <span className="mb-1 text-sm text-muted-foreground">No Assets Found</span>
            <span className="text-xs text-muted-foreground">
              {location ? `No properties in ${location}` : "Adjust your filters to expand search"}
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

      {(activeLayers.has("sold") || activeLayers.has("leased") || activeLayers.has("delisted")) && (
        <p className="border-t border-border bg-card px-3 py-1.5 text-[9px] leading-tight text-muted-foreground">
          Sold/leased/de-listed data via TRREB VOW — deemed reliable but not guaranteed accurate by PROPTX; for consumers with a bona fide interest only, not for any commercial purpose.
        </p>
      )}

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
