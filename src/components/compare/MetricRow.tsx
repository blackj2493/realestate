"use client";

import { cn, formatPrice } from "@/lib/utils";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import LockedCell from "./LockedCell";
import type { CompareMetric, MetricContext, ResolvedRow } from "@/lib/compare/compareMetricsConfig";

export default function MetricRow({
  metric,
  contexts,
  resolved,
}: {
  metric: CompareMetric;
  contexts: MetricContext[];
  resolved: ResolvedRow;
}) {
  const fmt = metric.format ?? ((x: number) => `${x}`);
  return (
    <tr className="hover:bg-slate-900/30">
      <td className="sticky left-0 z-10 bg-slate-950 p-3 text-slate-500">{metric.label}</td>
      {contexts.map((ctx, i) => {
        if (resolved.locked[i]) {
          return <td key={ctx.listing.id} className="p-3"><LockedCell /></td>;
        }
        const v = resolved.values[i];
        const display = resolved.displayed[i];
        const isBest = resolved.winners.has(i);
        const tag = resolved.tags[i];

        if (metric.cellKind === "dealScore") {
          const d = dealScoreFromDocument(
            ctx.listing,
            ctx.estimate?.estimatedValue && ctx.estimate.confidence
              ? { estimatedValue: ctx.estimate.estimatedValue, confidence: ctx.estimate.confidence }
              : null
          );
          return (
            <td key={ctx.listing.id} className={cn("p-3", isBest && "bg-emerald-500/5")}>
              {d.score != null ? (
                <span className="inline-flex items-center gap-1.5">
                  <DealScoreBadge score={d.score} grade={d.grade} />
                  {isBest && <span className="text-[10px] uppercase text-emerald-500">best</span>}
                </span>
              ) : <span className="text-slate-600">—</span>}
            </td>
          );
        }

        if (metric.cellKind === "estValue") {
          return (
            <td key={ctx.listing.id} className="p-3 font-mono text-slate-200">
              {v != null ? (
                <span className="inline-flex items-center gap-1.5">
                  {formatPrice(v)}
                  {ctx.estimate?.confidence && (
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {ctx.estimate.confidence.toLowerCase()}
                    </span>
                  )}
                </span>
              ) : <span className="text-xs text-slate-600">Insufficient comps</span>}
            </td>
          );
        }

        if (metric.cellKind === "discount") {
          if (v == null) return <td key={ctx.listing.id} className="p-3 text-slate-600">—</td>;
          const under = v >= 0;
          return (
            <td key={ctx.listing.id} className="p-3 font-mono">
              <span className={cn("font-semibold", under ? "text-emerald-400" : "text-amber-400")}>
                {`${Math.abs(v).toFixed(1)}% ${under ? "under" : "over"}`}
              </span>
              {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
            </td>
          );
        }

        // numeric + text
        const delta =
          metric.magnitude && resolved.bestVal != null && v != null && v !== resolved.bestVal
            ? `${v - resolved.bestVal > 0 ? "+" : "−"}${fmt(Math.abs(v - resolved.bestVal))}`
            : null;
        return (
          <td
            key={ctx.listing.id}
            className={cn(
              "p-3",
              metric.cellKind === "numeric" && "font-mono",
              isBest ? "font-bold text-emerald-400" : "text-slate-200"
            )}
          >
            {display ?? <span className="text-slate-600">—</span>}
            {isBest && <span className="ml-1.5 text-[10px] uppercase text-emerald-500">best</span>}
            {tag && <span className="ml-1.5 text-[10px] text-amber-400/80">{tag}</span>}
            {delta && <span className="ml-1.5 text-[10px] text-slate-500">{delta}</span>}
          </td>
        );
      })}
    </tr>
  );
}
