"use client";

/**
 * ShowMoreButton — shared expand/collapse control for the dashboard's capped
 * lists (Watchlist, Recently Viewed, Action Feed). Each list renders only its
 * first N items, then this reveals the rest in place (and collapses again),
 * so the dashboard stays short on mobile without a separate "see all" route.
 */

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ShowMoreButton({
  expanded,
  hiddenCount,
  onToggle,
  className,
}: {
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={cn(
        "terminal-font flex min-h-[44px] w-full items-center justify-center gap-1.5 border border-border bg-card/40 px-4 text-xs font-semibold uppercase tracking-wider text-cyan-700 transition-colors hover:border-cyan-600/50 hover:bg-cyan-600/5 active:bg-muted dark:text-cyan-300 dark:hover:border-border dark:hover:bg-transparent",
        className
      )}
    >
      {expanded ? "Show less" : `Show ${hiddenCount} more`}
      <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
    </button>
  );
}
