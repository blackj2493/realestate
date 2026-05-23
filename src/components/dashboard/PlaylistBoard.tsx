"use client";

import { useEffect, useState } from "react";
import type { ListingDocument } from "@/lib/typesense/client";
import type { BoardDef } from "@/lib/dashboard/boards";
import { fetchBoard } from "@/lib/dashboard/queries";
import PlaylistRow from "./PlaylistRow";

export default function PlaylistBoard({
  board,
  location,
}: {
  board: BoardDef;
  location: string;
}) {
  const [rows, setRows] = useState<ListingDocument[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setRows(null);
    setError(false);
    fetchBoard(board, location, 5)
      .then((r) => alive && setRows(r))
      .catch((e) => {
        console.error("[PlaylistBoard]", board.id, location, e);
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [board, location]);

  return (
    <div className="border border-slate-800 bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <h3 className="terminal-font text-[11px] font-bold uppercase tracking-wider text-slate-200">
          {board.title}
        </h3>
        <span className="terminal-font text-[10px] uppercase tracking-wider text-slate-500">
          {board.metricLabel}
        </span>
      </div>

      {rows === null && !error && (
        <div className="space-y-px p-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse bg-slate-800/40" />
          ))}
        </div>
      )}
      {error && (
        <p className="px-3 py-6 text-center text-xs text-rose-400">Failed to load</p>
      )}
      {rows && rows.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-slate-500">No matching listings</p>
      )}
      {rows &&
        rows.length > 0 &&
        rows.map((l) => <PlaylistRow key={l.id} listing={l} board={board} />)}
    </div>
  );
}
