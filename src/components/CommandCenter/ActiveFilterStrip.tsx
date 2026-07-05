"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterToken } from "./filterTokens";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";

/**
 * ActiveFilterStrip — the "what am I filtering by" summary. Reads as a query
 * sentence ("Showing  ≤$800k · 4+ Bd · Finished basement"), each token removable,
 * with a single Clear all. It's the ONE surface that shows every applied filter at
 * once — including ones scrolled off the desktop bar or hidden behind the mobile
 * "Filters" button. Renders nothing when no filter is set, so the bar only grows
 * a second line once the user is actually filtering.
 */
export default function ActiveFilterStrip({
  tokens,
  onClearAll,
}: {
  tokens: FilterToken[];
  onClearAll: () => void;
}) {
  if (tokens.length === 0) return null;

  return (
    <div className="flex items-center gap-2 border-t border-border/70 bg-card/40 px-3 py-2">
      <span className={cn(LABEL, "shrink-0 text-muted-foreground")}>Showing</span>

      <div className="no-scrollbar flex flex-1 flex-wrap items-center gap-1.5 md:flex-nowrap md:overflow-x-auto">
        {tokens.map((t) => (
          <span
            key={t.id}
            className={cn(
              "flex shrink-0 items-center gap-1 border px-2 py-1 font-mono text-[11px] font-semibold",
              t.tone === "investor"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : "border-cyan-500/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            )}
          >
            {t.label}
            <X
              className="h-3 w-3 cursor-pointer opacity-70 hover:opacity-100"
              role="button"
              aria-label={`Remove ${t.label} filter`}
              onClick={t.onRemove}
            />
          </span>
        ))}
      </div>

      <button
        type="button"
        onClick={onClearAll}
        className={cn(
          LABEL,
          "shrink-0 border border-border px-2 py-1 text-muted-foreground transition-colors hover:border-rose-500/40 hover:text-rose-300"
        )}
      >
        Clear all
      </button>
    </div>
  );
}
