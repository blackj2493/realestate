/**
 * MapComparePanel — the Compare basket drawer. Replaces the old floating
 * SelectionBar: a thumbnail tray of the multi-select set with per-item remove,
 * a "tap map to add" toggle, and the isolate / compare / share / clear actions.
 * Brokerage (ListOfficeName) is shown at the same weight as other details per
 * the TRREB display rule (CLAUDE.md §4).
 */

"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { MousePointerClick, Eye, ListFilter, GitCompareArrows, Share2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import ShareDialog from "./ShareDialog";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

export default function MapComparePanel() {
  const selectedIds = useCommandCenterStore((s) => s.selectedIds);
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const clearSelected = useCommandCenterStore((s) => s.clearSelected);
  const isSelectMode = useCommandCenterStore((s) => s.isSelectMode);
  const setSelectMode = useCommandCenterStore((s) => s.setSelectMode);
  const showSelectedOnly = useCommandCenterStore((s) => s.showSelectedOnly);
  const setShowSelectedOnly = useCommandCenterStore((s) => s.setShowSelectedOnly);
  const searchResult = useCommandCenterStore((s) => s.searchResult);

  const [shareOpen, setShareOpen] = useState(false);

  const listingKeys = useMemo(() => Array.from(selectedIds), [selectedIds]);
  const count = listingKeys.length;
  // Resolve the docs we can (those in the current result set) for thumbnails.
  const docs = useMemo(
    () => (searchResult?.listings ?? []).filter((l) => selectedIds.has(l.id)),
    [searchResult, selectedIds]
  );
  const missing = count - docs.length;
  const compareHref = `/properties/compare?ids=${encodeURIComponent(listingKeys.join(","))}`;

  return (
    <div className="flex max-h-[70vh] flex-col">
      {/* Tap-to-add toggle */}
      <div className="border-b border-slate-800 p-3">
        <button
          type="button"
          onClick={() => setSelectMode(!isSelectMode)}
          aria-pressed={isSelectMode}
          className={cn(
            "flex w-full items-center justify-center gap-2 border py-2 text-xs font-medium transition-all",
            isSelectMode
              ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
              : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
          )}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          {isSelectMode ? "Tap map to add — on" : "Tap map to add"}
        </button>
      </div>

      {/* Basket list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {count === 0 ? (
          <p className="p-3 text-xs leading-relaxed text-slate-500">
            No properties selected yet. Turn on “Tap map to add” and click pins, or use the
            checkboxes in the listings panel.
          </p>
        ) : (
          <>
            {docs.map((d) => {
              const src = d.thumbnailUrl || d.primaryImageUrl;
              return (
                <div key={d.id} className="flex items-center gap-2.5 border-b border-slate-800/50 p-2">
                  <ListingThumbnail
                    src={src}
                    alt={d.UnparsedAddress || "Property"}
                    className="h-12 w-16 shrink-0"
                    sizes="64px"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-200">
                      {d.UnparsedAddress?.trim() || d.City || "Address unavailable"}
                    </p>
                    <p className="font-mono text-xs text-cyan-400">
                      {d.ListPrice ? `$${d.ListPrice.toLocaleString()}` : "—"}
                    </p>
                    {d.ListOfficeName && <p className="truncate text-[10px] text-slate-500">{d.ListOfficeName}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSelected(d.id)}
                    aria-label="Remove from selection"
                    className="shrink-0 text-slate-500 hover:text-rose-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            {missing > 0 && (
              <p className="px-3 py-2 text-[10px] text-slate-500">
                {missing} more selected {missing === 1 ? "listing isn’t" : "listings aren’t"} in the current view.
              </p>
            )}
          </>
        )}
      </div>

      {/* Actions */}
      {count > 0 && (
        <div className="flex flex-col gap-2 border-t border-slate-800 p-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowSelectedOnly(!showSelectedOnly)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border py-2 text-xs font-medium transition-all",
                showSelectedOnly
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
              )}
            >
              {showSelectedOnly ? <ListFilter className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showSelectedOnly ? "Show all" : "Isolate"}
            </button>
            <Link
              href={compareHref}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 border py-2 text-xs font-medium transition-all",
                count >= 2
                  ? "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
                  : "pointer-events-none border-slate-800 text-slate-600"
              )}
              aria-disabled={count < 2}
              title={count < 2 ? "Select at least 2 to compare" : "Compare side by side"}
            >
              <GitCompareArrows className="h-3.5 w-3.5" />
              Compare
            </Link>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex flex-1 items-center justify-center gap-1.5 bg-cyan-500 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
            >
              <Share2 className="h-3.5 w-3.5" />
              Share ({count})
            </button>
            <button
              type="button"
              onClick={clearSelected}
              className="flex items-center justify-center gap-1.5 border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} listingKeys={listingKeys} />
    </div>
  );
}
