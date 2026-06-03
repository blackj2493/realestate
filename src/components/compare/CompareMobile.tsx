"use client";

import Link from "next/link";
import { cn, formatPrice } from "@/lib/utils";
import { rowIsIdentical } from "@/lib/compare/diff";
import {
  COMPARE_METRICS,
  GROUP_LABELS,
  lensGroupOrder,
  resolveRow,
  type MetricContext,
} from "@/lib/compare/compareMetricsConfig";
import CompareMediaCell from "./CompareMediaCell";
import RentInput from "./RentInput";
import LockedCell from "./LockedCell";
import type { ListingDocument } from "@/lib/typesense/client";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function CompareMobile({
  listings,
  contexts,
  lens,
  diffOnly,
  rentById,
  seededRentById,
  onRent,
}: {
  listings: ListingDocument[];
  contexts: MetricContext[];
  lens: PersonaType;
  diffOnly: boolean;
  rentById: Record<string, number>;
  seededRentById: Record<string, number>;
  onRent: (id: string, v: number) => void;
}) {
  return (
    <div className="space-y-6 md:hidden">
      {/* Property identity row */}
      <div className="flex snap-x gap-3 overflow-x-auto pb-1">
        {listings.map((l) => (
          <div key={l.id} className="w-40 shrink-0 snap-start">
            <CompareMediaCell listing={l} />
            <Link href={`/properties/${l.id}`} className="block">
              <p className="font-mono text-sm font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
              <p className="text-[11px] leading-snug text-slate-300">{l.UnparsedAddress || l.City || "—"}</p>
            </Link>
            <RentInput
              value={rentById[l.id]}
              seeded={seededRentById[l.id] ?? 0}
              onChange={(v) => onRent(l.id, v)}
            />
          </div>
        ))}
      </div>

      {lensGroupOrder(lens).map((groupId) => {
        const rows = COMPARE_METRICS.filter((m) => m.group === groupId).map((m) => ({
          metric: m,
          resolved: resolveRow(m, contexts),
        }));
        const visible = diffOnly
          ? rows.filter(({ metric, resolved }) => metric.alwaysShow || !rowIsIdentical(resolved.displayed))
          : rows;
        if (visible.length === 0) return null;

        return (
          <div key={groupId} className="rounded-lg border border-slate-800">
            <div className="border-b border-slate-800 bg-slate-900/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {GROUP_LABELS[groupId]}
            </div>
            <div className="divide-y divide-slate-800/70">
              {visible.map(({ metric, resolved }) => (
                <div key={metric.key} className="px-3 py-2">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">{metric.label}</p>
                  <div className="flex snap-x gap-2 overflow-x-auto">
                    {contexts.map((ctx, i) => (
                      <div
                        key={ctx.listing.id}
                        className={cn(
                          "w-28 shrink-0 snap-start rounded px-2 py-1 font-mono text-sm",
                          resolved.winners.has(i)
                            ? "bg-emerald-500/10 font-bold text-emerald-400"
                            : "text-slate-200"
                        )}
                      >
                        {resolved.locked[i] ? (
                          <LockedCell />
                        ) : (
                          resolved.displayed[i] ?? <span className="text-slate-600">—</span>
                        )}
                        {resolved.tags[i] && (
                          <span className="ml-1 text-[10px] text-amber-400/80">{resolved.tags[i]}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
