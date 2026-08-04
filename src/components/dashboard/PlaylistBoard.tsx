"use client";

import { useEffect, useState } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import { resolveBoardView, type BoardDef } from "@/lib/dashboard/boards";
import { fetchBoard } from "@/lib/dashboard/queries";
import { scopeKey } from "@/lib/dashboard/lensKey";
import { areaKey, type Area } from "@/lib/dashboard/area";
import type { MarketActivityLens } from "@/lib/dashboard/config";

import PlaylistRow from "./PlaylistRow";

export default function PlaylistBoard({
  board,
  area,
  lens,
}: {
  board: BoardDef;
  area: Area;
  lens: MarketActivityLens;
}) {
  const [rows, setRows] = useState<ListingDocument[] | null>(null);
  const [error, setError] = useState(false);
  const key = areaKey(area);
  const scope = scopeKey(lens);
  // Lens-aware face of the board — swaps to the rental-native metric in "For Rent" mode.
  const view = resolveBoardView(board, lens.transactionType);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    fetchBoard(board, area, lens, 5)
      .then((r) => alive && setRows(r))
      .catch((e) => {
        console.error("[PlaylistBoard]", board.id, key, e);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
    // `area`/`lens` captured via `key`/`scope`; `board` is a stable module def.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, key, scope]);

  return (
    <div className="border border-border bg-card/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-foreground">
          {view.title}
        </h3>
        <span className="terminal-font text-[10px] uppercase tracking-wider text-muted-foreground">
          {view.metricLabel}
        </span>
      </div>

      {rows === null && !error && (
        <div className="space-y-px p-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-muted/40" />
          ))}
        </div>
      )}
      {error && (
        <p className="px-3 py-6 text-center text-xs text-rose-700 dark:text-rose-400">Failed to load</p>
      )}
      {rows && rows.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching listings</p>
      )}
      {rows &&
        rows.length > 0 &&
        rows.map((l) => <PlaylistRow key={l.id} listing={l} view={view} />)}
    </div>
  );
}
