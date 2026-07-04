/**
 * ZoningCard — the dedicated, ATTRIBUTED surface for a property's zoning.
 *
 * Zoning is municipal open data (harvested per scripts/admin/zoning-sources.json), NOT the
 * MLS/listing feed — so it is shown here as its own card, visually distinct (amber, a
 * "Municipal open data" tag), never blended into the MLS-derived metrics. Every value carries
 * its source + by-law, the licence's required attribution, and a "not a legal survey"
 * disclaimer (src/lib/zoning/attribution.ts).
 *
 * Presentational + null-safe: renders nothing until zoning has been harvested/backfilled for
 * this listing (today the field is empty everywhere), so it is safe to mount unconditionally.
 */

import { Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { zoningSource, zoningLabel, ZONING_DISCLAIMER } from "@/lib/zoning/attribution";

export default function ZoningCard({
  code,
  desc,
  sourceKey,
  className,
}: {
  /** Municipal zone code, e.g. "RD" (listing.zoning_designation). */
  code?: string | null;
  /** Plain-language zone name, e.g. "Residential Detached" (listing.zoning_desc). */
  desc?: string | null;
  /** Provenance key resolving to source/by-law/attribution (listing.zoning_source). */
  sourceKey?: string | null;
  className?: string;
}) {
  const zone = code?.trim();
  if (!zone) return null; // no zoning harvested for this listing yet — show nothing

  const src = zoningSource(sourceKey);
  const label = desc?.trim();

  return (
    <div className={cn("rounded-lg border border-slate-800 bg-slate-900/50 p-4", className)}>
      {/* Header — the "Municipal open data" tag marks this as NOT MLS data. */}
      <div className="mb-3 flex items-center gap-2">
        <Landmark className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-semibold uppercase tracking-wider text-slate-200">Zoning</span>
        <span className="ml-auto rounded bg-slate-800/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-400">
          Municipal open data
        </span>
      </div>

      {/* Zone code (hero) + plain-language name. */}
      <div className="mb-3 rounded-lg border border-amber-800/40 bg-amber-900/15 p-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-mono text-2xl font-bold text-amber-300">{zone}</span>
          {label && <span className="text-right text-xs leading-tight text-slate-300">{label}</span>}
        </div>
      </div>

      {/* Provenance. */}
      {src && (
        <p className="text-[11px] text-slate-400">
          Source: <span className="text-slate-300">{zoningLabel(src)}</span>
        </p>
      )}

      {/* Disclaimer + licence attribution (required). */}
      <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
        {ZONING_DISCLAIMER}
        {src ? ` ${src.attribution}` : ""}
      </p>
    </div>
  );
}
