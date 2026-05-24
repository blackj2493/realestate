/**
 * SelectionBar — floating action bar for the multi-select set.
 * Appears once ≥1 property is selected. Lets the user isolate the view to the
 * selection ("View Selected"), share it, or clear it.
 */

"use client";

import React, { useMemo, useState } from "react";
import { Eye, Share2, Trash2, ListFilter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import ShareDialog from "./ShareDialog";

export default function SelectionBar() {
  const selectedIds = useCommandCenterStore((s) => s.selectedIds);
  const showSelectedOnly = useCommandCenterStore((s) => s.showSelectedOnly);
  const setShowSelectedOnly = useCommandCenterStore((s) => s.setShowSelectedOnly);
  const clearSelected = useCommandCenterStore((s) => s.clearSelected);

  const [shareOpen, setShareOpen] = useState(false);
  const count = selectedIds.size;
  const listingKeys = useMemo(() => Array.from(selectedIds), [selectedIds]);

  if (count === 0) return null;

  return (
    <>
      <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
        <div className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/95 px-2 py-1.5 shadow-2xl backdrop-blur-sm">
          <span className="flex items-center gap-1.5 px-3 text-xs font-semibold text-cyan-300">
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-500 px-1.5 text-[11px] font-bold text-slate-950">
              {count}
            </span>
            selected
          </span>

          <div className="h-5 w-px bg-slate-700" />

          <button
            type="button"
            onClick={() => setShowSelectedOnly(!showSelectedOnly)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              showSelectedOnly
                ? "bg-cyan-500/20 text-cyan-300"
                : "text-slate-300 hover:bg-slate-800"
            )}
          >
            {showSelectedOnly ? <ListFilter className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showSelectedOnly ? "Show All" : "View Selected"}
          </button>

          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="flex items-center gap-1.5 rounded-full bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>

          <button
            type="button"
            onClick={clearSelected}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} listingKeys={listingKeys} />
    </>
  );
}
