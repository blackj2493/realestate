"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { ALL_FILTERS, FILTERS_BY_KEY } from "@/lib/filters/filterRegistry";
import type { FilterCategory } from "@/lib/filters/types";

const LABEL = "text-[10px] font-semibold uppercase tracking-wider";
const CATEGORY_ORDER: FilterCategory[] = ["Basics", "Property", "Investor", "Location"];

/** Opens from the "+ Add filter" chip. Lists filters not pinned and not already added. */
export default function AddFilterPalette({ onPicked }: { onPicked?: () => void }) {
  const { addedFilterKeys, addFilter } = useCommandCenterStore();
  const [q, setQ] = React.useState("");

  const available = ALL_FILTERS.filter(
    (f) => !f.defaultPinned && !addedFilterKeys.includes(f.key)
  ).filter((f) => f.label.toLowerCase().includes(q.trim().toLowerCase()));

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: available.filter((f) => f.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex w-64 flex-col gap-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search filters…"
        className="w-full border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
      />
      <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
        {byCategory.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-500">No more filters.</p>
        )}
        {byCategory.map((g) => (
          <div key={g.cat} className="flex flex-col">
            <span className={cn(LABEL, "px-1 py-1 text-slate-500")}>{g.cat}</span>
            {g.items.map((f) => (
              <button
                key={f.key}
                onClick={() => {
                  addFilter(f.key);
                  onPicked?.();
                }}
                className="px-2 py-1.5 text-left text-xs text-slate-300 transition-colors hover:bg-cyan-500/10 hover:text-cyan-300"
              >
                {FILTERS_BY_KEY[f.key].label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
