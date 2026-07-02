"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { rowIsIdentical } from "@/lib/compare/diff";
import {
  resolveRow,
  GROUP_LABELS,
  type CompareGroupId,
  type CompareMetric,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import MetricRow from "./MetricRow";

export default function MetricGroup({
  groupId,
  metrics,
  contexts,
  colSpan,
  defaultOpen,
  diffOnly,
}: {
  groupId: CompareGroupId;
  metrics: CompareMetric[];
  contexts: MetricContext[];
  colSpan: number;
  defaultOpen: boolean;
  diffOnly: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const rows = metrics.map((m) => ({ metric: m, resolved: resolveRow(m, contexts) }));
  const visible = diffOnly
    ? rows.filter(({ metric, resolved }) => metric.alwaysShow || !rowIsIdentical(resolved.displayed))
    : rows;

  return (
    <tbody className="divide-y divide-border/70 border-b-4 border-slate-950">
      <tr className="bg-card/50">
        <td colSpan={colSpan} className="sticky left-0 z-10 p-0">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
            {GROUP_LABELS[groupId]}
          </button>
        </td>
      </tr>
      {open && visible.length === 0 && (
        <tr>
          <td colSpan={colSpan} className="px-3 py-2 text-xs italic text-muted-foreground">
            All identical
          </td>
        </tr>
      )}
      {open && visible.map(({ metric, resolved }) => (
        <MetricRow key={metric.key} metric={metric} contexts={contexts} resolved={resolved} />
      ))}
    </tbody>
  );
}
