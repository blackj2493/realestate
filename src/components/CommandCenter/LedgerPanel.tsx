/**
 * LedgerPanel — right-hand property ledger. Columns are persona-driven.
 */

"use client";

import React, { useMemo, useState } from "react";
import { Loader2, MapPin, AlertCircle, Zap, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import LedgerRow from "./LedgerRow";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG, type ColumnType } from "@/lib/personas/personaConfig";
import { SORTABLE_COLUMN_TYPES, DEFAULT_SORT_DIR, compareByColumn, type SortDir } from "./columnSort";

interface LedgerPanelProps {
  className?: string;
}

export default function LedgerPanel({ className }: LedgerPanelProps) {
  const { activePersona, searchResult, isLoading, error, totalCount, selectedProperty, setSelectedProperty, location, hoveredId, setHoveredId, selectedIds, showSelectedOnly, toggleSelected, activeLayers, soldWindowDays } =
    useCommandCenterStore();

  const columns = PERSONA_CONFIG[activePersona].columns;
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

  return (
    <div className={cn("flex h-full flex-col border-l border-slate-800 bg-slate-950", className)}>
      {/* Typesense stat header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <Zap className="h-3.5 w-3.5 text-cyan-400" />
        <p className="font-mono text-xs text-slate-400">
          {(activeLayers.has("sold") || activeLayers.has("leased")) ? (
            <>
              <span className="font-semibold text-cyan-400">{totalCount.toLocaleString()}</span> Comps
              <span className="mx-1.5 text-slate-600">|</span>
              VOW · last <span className="text-cyan-400">{soldWindowDays}d</span>
            </>
          ) : (
            <>
              Typesense Search:{" "}
              <span className="font-semibold text-cyan-400">{totalCount.toLocaleString()}</span> Active Listings
              <span className="mx-1.5 text-slate-600">|</span>
              Instant Query <span className="text-cyan-400">&lt;{ms}ms</span>
            </>
          )}
        </p>
      </div>

      {/* Column headers */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
        <div className="w-5 shrink-0" />
        <div className="h-px w-24 shrink-0" />
        {columns.map((col) => {
          const headClass = cn(
            "text-[10px] font-semibold uppercase tracking-wider text-slate-500",
            col.width,
            col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
          );
          if (!SORTABLE_COLUMN_TYPES.has(col.type)) {
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
              className={cn(
                headClass,
                "flex items-center gap-0.5 transition-colors hover:text-slate-300",
                active && "text-cyan-400",
                col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start"
              )}
            >
              <span className="truncate">{col.header}</span>
              {active &&
                (sort!.dir === "asc" ? (
                  <ChevronUp className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                ))}
            </button>
          );
        })}
      </div>

      {/* Rows */}
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="mb-3 h-8 w-8 animate-spin text-cyan-400" />
            <span className="text-sm text-slate-400">SCANNING MARKET DATA...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <AlertCircle className="mb-3 h-8 w-8 text-rose-400" />
            <span className="mb-1 text-sm text-rose-400">Search Error</span>
            <span className="text-center text-xs text-slate-500">{error}</span>
          </div>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <MapPin className="mb-3 h-8 w-8 text-slate-700" />
            <span className="mb-1 text-sm text-slate-400">No Assets Found</span>
            <span className="text-xs text-slate-500">
              {location ? `No properties in ${location}` : "Adjust your filters to expand search"}
            </span>
          </div>
        ) : (
          properties.map((property) => (
            <LedgerRow
              key={property.id}
              property={property}
              columns={columns}
              onClick={() => setSelectedProperty(property)}
              isSelected={selectedProperty?.id === property.id}
              isHovered={hoveredId === property.id}
              onHoverChange={(hovered) => setHoveredId(hovered ? property.id : null)}
              isChecked={selectedIds.has(property.id)}
              onToggleSelect={() => toggleSelected(property.id)}
            />
          ))
        )}
      </div>

      {(activeLayers.has("sold") || activeLayers.has("leased")) && (
        <p className="border-t border-slate-800 bg-slate-900 px-3 py-1.5 text-[9px] leading-tight text-slate-600">
          Sold/leased data via TRREB VOW — deemed reliable but not guaranteed accurate by PROPTX; for consumers with a bona fide interest only, not for any commercial purpose.
        </p>
      )}

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
          <span>{isLoading ? "Scanning..." : `${properties.length} shown · ${totalCount.toLocaleString()} total`}</span>
          <span className="font-mono">PROPTX MLS®</span>
        </div>
      </div>
    </div>
  );
}
