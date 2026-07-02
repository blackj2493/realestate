"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X, Plus } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import {
  CORE_METRICS,
  extendedGroupMetrics,
  visibleRows,
  GROUP_LABELS,
  lensGroupOrder,
  type MetricContext,
  type VisibleRow,
} from "@/lib/compare/compareMetricsConfig";
import CompareMediaCell from "./CompareMediaCell";
import RentInput from "./RentInput";
import LockedCell from "./LockedCell";
import InfoDot from "@/components/ui/InfoDot";
import type { ListingDocument } from "@/lib/typesense/client";
import type { PersonaType } from "@/lib/personas/personaConfig";

// Shared column geometry. Every row (identity header + each metric row) uses the
// SAME sticky label width + per-property column width so that, inside one
// horizontal scroll container, all columns stay aligned (no per-row desync).
const LABEL_W = "w-24"; // sticky metric-label column
const COL_W = "w-40"; // each property column

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
  const router = useRouter();
  const searchParams = useSearchParams();

  // Drop a property from the compare set by rewriting the ?ids= URL param.
  const removeId = (id: string) => {
    const current = (searchParams.get("ids") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = current.filter((x) => x !== id);
    const qs = next.length ? `?ids=${next.join(",")}` : "";
    router.replace(`/properties/compare${qs}`);
  };

  // The next-URL anon LockedCells deep-link into so a tap converts.
  const compareNext = `/properties/compare?ids=${listings.map((l) => l.id).join(",")}`;

  const row = ({ metric, resolved }: VisibleRow) => (
    <div key={metric.key} className="flex">
      <div
        className={cn(
          "sticky left-0 z-10 shrink-0 bg-background px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground",
          LABEL_W
        )}
      >
        <span className="inline-flex items-center gap-1">
          {metric.label}
          {metric.glossaryKey && <InfoDot term={metric.glossaryKey} />}
        </span>
      </div>
      <div className="flex gap-2 py-2 pr-3">
        {contexts.map((ctx, i) => (
          <div
            key={ctx.listing.id}
            className={cn(
              "shrink-0 rounded px-2 py-1 font-mono text-sm",
              COL_W,
              resolved.winners.has(i)
                ? "bg-emerald-500/10 font-bold text-emerald-400"
                : "text-foreground"
            )}
          >
            {resolved.locked[i] ? (
              <LockedCell next={compareNext} />
            ) : (
              resolved.displayed[i] ?? <span className="text-muted-foreground">—</span>
            )}
            {resolved.tags[i] && (
              <span className="ml-1 text-[10px] text-amber-400/80">{resolved.tags[i]}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  const coreRows = visibleRows(CORE_METRICS, contexts, diffOnly);
  const groups = lensGroupOrder(lens)
    .filter((groupId) => extendedGroupMetrics(groupId).length > 0)
    .map((groupId) => ({
      groupId,
      visible: visibleRows(extendedGroupMetrics(groupId), contexts, diffOnly),
    }))
    .filter((g) => g.visible.length > 0);

  return (
    <div className="md:hidden">
      {/* ONE horizontal scroll container — identity header + every metric row
          live inside it so all columns share a single scroll offset. */}
      <div className="overflow-x-auto pb-2">
        <div className="min-w-max">
          {/* Property identity row */}
          <div className="flex">
            {/* Sticky spacer aligned with the metric-label column. */}
            <div className={cn("sticky left-0 z-10 shrink-0 bg-background", LABEL_W)} />
            <div className="flex gap-2 pr-3">
              {listings.map((l) => (
                <div key={l.id} className={cn("relative shrink-0", COL_W)}>
                  <button
                    type="button"
                    onClick={() => removeId(l.id)}
                    aria-label={`Remove ${l.UnparsedAddress || "property"} from comparison`}
                    className="absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-background/80 text-foreground hover:bg-card hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <CompareMediaCell listing={l} />
                  <Link href={`/properties/${l.id}`} className="block">
                    <p className="font-mono text-sm font-bold text-emerald-400">{formatPrice(l.ListPrice)}</p>
                    <p className="text-[11px] leading-snug text-foreground">{l.UnparsedAddress || l.City || "—"}</p>
                  </Link>
                  {l.ListOfficeName && (
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{l.ListOfficeName}</p>
                  )}
                  <RentInput
                    value={rentById[l.id]}
                    seeded={seededRentById[l.id] ?? 0}
                    onChange={(v) => onRent(l.id, v)}
                  />
                </div>
              ))}

              {/* Add-another affordance when the set is below the useful minimum. */}
              {listings.length < 2 && (
                <Link
                  href="/properties"
                  className={cn(
                    "flex min-h-[160px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:border-slate-500 hover:text-foreground",
                    COL_W
                  )}
                >
                  <Plus className="h-5 w-5" />
                  Add another property
                </Link>
              )}
            </div>
          </div>

          {/* Core comparison — always visible */}
          {coreRows.length > 0 && (
            <div className="mt-4 divide-y divide-border/70 border-y border-border">
              {coreRows.map(row)}
            </div>
          )}

          {/* Additional metrics — grouped */}
          {groups.map(({ groupId, visible }) => (
            <div key={groupId} className="mt-4 border-y border-border">
              {/* Heading pinned to the left edge while the columns scroll under it. */}
              <div className="sticky left-0 z-10 inline-block bg-card/50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {GROUP_LABELS[groupId]}
              </div>
              <div className="divide-y divide-border/70">{visible.map(row)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
