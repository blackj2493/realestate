"use client";

/**
 * Generic sortable ranking table for the public /data trackers. Follows the
 * RegionScorecard recipe: one shared grid-template applied to the header + every
 * row, header buttons toggle sort, nulls always sort last. Column `render` fns live
 * in client components (they can't cross the server→client boundary), so each tracker
 * defines its own columns and feeds this plain-data rows.
 */
import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RankingColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Value used for sorting; null/undefined always sorts last. Omit to disable sort. */
  sortValue?: (row: T) => number | string | null | undefined;
  render: (row: T) => ReactNode;
  /** Optional header tooltip. */
  hint?: string;
}

interface Props<T> {
  columns: RankingColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** grid-template-columns applied to header + rows. */
  gridTemplate: string;
  initialSortKey?: string;
  initialSortDir?: "asc" | "desc";
  /** Min width (px) before horizontal scroll kicks in. */
  minWidth?: number;
  /** Subtly highlight a row (e.g. the flagship market). */
  isFeatured?: (row: T) => boolean;
}

export function RankingTable<T>({
  columns,
  rows,
  getRowKey,
  gridTemplate,
  initialSortKey,
  initialSortDir = "desc",
  minWidth = 640,
  isFeatured,
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | undefined>(initialSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialSortDir);

  const col = columns.find((c) => c.key === sortKey);
  const sorted = [...rows];
  if (col?.sortValue) {
    const sv = col.sortValue;
    sorted.sort((a, b) => {
      const av = sv(a);
      const bv = sv(b);
      const an = av == null;
      const bn = bv == null;
      if (an && bn) return 0;
      if (an) return 1; // nulls last, regardless of direction
      if (bn) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const onSort = (key: string) => {
    const c = columns.find((x) => x.key === key);
    if (!c?.sortValue) return;
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="dt-panel dt-reg relative overflow-x-auto border border-border bg-card dark:bg-transparent">
      <div style={{ minWidth }}>
        <div
          className="grid border-b border-border bg-card/60"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          {columns.map((c) => {
            const active = sortKey === c.key;
            const sortable = !!c.sortValue;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => onSort(c.key)}
                disabled={!sortable}
                title={c.hint}
                className={cn(
                  "terminal-font flex items-center gap-1 px-2 py-2 text-[11px] font-bold uppercase tracking-wider transition-colors",
                  c.align === "right" ? "justify-end" : "justify-start",
                  sortable
                    ? "cursor-pointer hover:text-cyan-700 dark:hover:text-cyan-300"
                    : "cursor-default",
                  active ? "text-cyan-700 dark:text-cyan-400" : "text-muted-foreground"
                )}
              >
                {c.label}
                {active && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
              </button>
            );
          })}
        </div>

        {sorted.map((row) => (
          <div
            key={getRowKey(row)}
            className={cn(
              "grid border-b border-border/70 last:border-0",
              isFeatured?.(row) && "bg-cyan-500/[0.06] dark:bg-cyan-400/[0.06]"
            )}
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {columns.map((c) => (
              <div
                key={c.key}
                className={cn(
                  "terminal-font px-2 py-3 text-[13px] text-foreground",
                  c.align === "right" ? "text-right" : "text-left"
                )}
              >
                {c.render(row)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
