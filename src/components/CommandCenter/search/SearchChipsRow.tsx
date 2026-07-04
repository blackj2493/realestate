/**
 * SearchChipsRow — the "AI PARSED" interpreted-chips strip. Shows exactly how the
 * natural-language query was read, each chip removable. No black box.
 */

"use client";

import React from "react";
import { X, Sparkles } from "lucide-react";
import type { ParsedChip } from "@/lib/search/types";

interface Props {
  chips: ParsedChip[];
  onRemove: (id: string) => void;
}

export default function SearchChipsRow({ chips, onRemove }: Props) {
  if (chips.length === 0) return null;
  return (
    <div className="border-b border-border bg-background/60 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Interpreted · tap a chip to adjust
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1.5 border border-cyan-500/45 bg-cyan-500/10 px-2 py-1 font-mono text-[11px] text-cyan-700 dark:text-cyan-300"
          >
            {c.label}
            <button
              type="button"
              aria-label={`Remove ${c.label}`}
              onClick={() => onRemove(c.id)}
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
