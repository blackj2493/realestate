/**
 * SearchEmptyState — a useful empty dropdown: recent searches, watched areas
 * (active lenses you can resume), and a "Search this map area" action.
 */

"use client";

import React from "react";
import { RotateCcw, Diamond, SquareDashedMousePointer } from "lucide-react";
import type { RecentSearch } from "@/lib/search/recents";

export interface WatchedArea {
  id: string;
  label: string;
  sub?: string;
}

interface Props {
  recents: RecentSearch[];
  watched: WatchedArea[];
  onPickRecent: (r: RecentSearch) => void;
  onPickWatched: (id: string) => void;
  onClearRecents: () => void;
  onSearchThisArea: () => void;
}

const GROUP = "flex items-center justify-between px-3 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground";
const ROW = "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted";

export default function SearchEmptyState({
  recents,
  watched,
  onPickRecent,
  onPickWatched,
  onClearRecents,
  onSearchThisArea,
}: Props) {
  return (
    <div className="pb-2">
      {recents.length > 0 && (
        <>
          <div className={GROUP}>
            <span>Recent</span>
            <button type="button" onClick={onClearRecents} className="hover:text-foreground">
              Clear
            </button>
          </div>
          {recents.map((r) => (
            <button key={r.id} type="button" onClick={() => onPickRecent(r)} className={ROW}>
              <RotateCcw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-xs text-foreground">{r.label}</span>
            </button>
          ))}
        </>
      )}

      {watched.length > 0 && (
        <>
          <div className={GROUP}>
            <span>Watched areas</span>
            <span className="text-cyan-600 dark:text-cyan-400/80">live</span>
          </div>
          {watched.map((w) => (
            <button key={w.id} type="button" onClick={() => onPickWatched(w.id)} className={ROW}>
              <Diamond className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-400/80" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-mono text-xs text-foreground">{w.label}</span>
                {w.sub && <span className="truncate text-[10px] text-muted-foreground">{w.sub}</span>}
              </span>
            </button>
          ))}
        </>
      )}

      {recents.length === 0 && watched.length === 0 && (
        <p className="px-3 py-3 font-mono text-[11px] text-muted-foreground">
          Search a city, community, address, school, or MLS# — or describe what you want in plain English.
        </p>
      )}

      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={onSearchThisArea}
          className="flex w-full items-center justify-center gap-2 border border-border bg-card py-2 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
        >
          <SquareDashedMousePointer className="h-3.5 w-3.5" />
          Search this map area
        </button>
      </div>
    </div>
  );
}
