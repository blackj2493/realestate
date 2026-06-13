/**
 * LedgerRow — persona-driven property row. Columns come from PERSONA_CONFIG.
 */

"use client";

import { Check } from "lucide-react";
import WatchHeart from "@/components/watchlist/WatchHeart";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnDef } from "@/lib/personas/personaConfig";
import { getAlphaFlag, ALPHA_FLAG_CLASS } from "@/lib/personas/getAlphaFlag";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreGradePill } from "@/components/Property/DealScoreCard";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import ListingCardBody from "./ListingCardBody";
import { carryFor } from "./columnSort";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";

interface LedgerRowProps {
  property: ListingDocument;
  columns: ColumnDef[];
  onClick: () => void;
  isSelected?: boolean;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  /** Whether this row is part of the multi-select set. */
  isChecked?: boolean;
  /** Toggle this row's membership in the multi-select set. */
  onToggleSelect?: () => void;
  /** Signed-in? Gates VOW-derived row metrics (True DOM, distress flags, deal score) for anon (§6.2(f)). */
  isAuthed?: boolean;
  /** Card mode for narrow panels (audit C4): render only the photo + address
   *  card, dropping the fixed numeric columns that would starve the price. */
  compact?: boolean;
}

function alignClass(a: ColumnDef["align"]) {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

/**
 * ColumnValue — the bare, colored value for a numeric/text column. Shared by the
 * desktop Cell (fixed-width column) and the mobile MetricChip (labeled card chip)
 * so the formatting + color rules live in ONE place and can't drift.
 * (address + alphaFlag are structural and handled by their own renderers.)
 */
function ColumnValue({ doc, col, isAuthed }: { doc: ListingDocument; col: ColumnDef; isAuthed: boolean }) {
  switch (col.type) {
    case "trueDom": {
      // True DOM is relist-corrected (VOW-derived) — gated for anon (§6.2(f)).
      if (!isAuthed)
        return (
          <span className="text-slate-600" title="Sign in to view True DOM">
            🔒
          </span>
        );
      const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket ?? 0;
      const color = dom > 90 ? "text-rose-400" : dom > 45 ? "text-cyan-400" : dom >= 14 ? "text-amber-400" : "text-slate-400";
      return <span className={cn(color, "font-semibold")}>{dom}d</span>;
    }
    case "capRate": {
      const v = capRateOrNull(doc.cap_rate_est);
      return <span className="text-cyan-400">{v != null ? `${v.toFixed(1)}%` : "—"}</span>;
    }
    case "yield": {
      // gross_yield_est is already a PERCENT — no ×100 (that was for the old fraction targetGrossYield).
      const v = grossYieldOrNull(doc.gross_yield_est);
      return <span className="text-cyan-400">{v != null ? `${v.toFixed(1)}%` : "—"}</span>;
    }
    case "carryCost":
      return (
        <span className="text-cyan-400">
          ${carryFor(doc).toLocaleString()}
          <span className="text-[9px] text-slate-500">/mo</span>
        </span>
      );
    case "priceDrop":
      return (
        <span className={doc.TotalPriceDrop ? "text-rose-400" : "text-slate-500"}>
          {doc.TotalPriceDrop ? `-$${doc.TotalPriceDrop.toLocaleString()}` : "—"}
        </span>
      );
    case "suite":
      return (
        <span className="text-blue-300">
          {doc.SuiteStatus === "EXISTING_SUITE" ? "EXISTING" : doc.SuiteStatus === "POTENTIAL_CANDIDATE" ? "CANDIDATE" : "—"}
        </span>
      );
    case "lotDims": {
      const w = doc.LotWidth ?? doc.lot_width_ft;
      const d = doc.LotDepth ?? doc.lot_depth_ft;
      return <span className="text-slate-300">{w ? `${w}′×${d ?? "?"}′` : "—"}</span>;
    }
    case "zoning":
      return <span className={doc.multiplex_by_right ? "text-cyan-400" : "text-slate-300"}>{doc.zoning_designation || "—"}</span>;
    case "density":
      return <span className={doc.is_density_ready ? "text-cyan-400" : "text-slate-500"}>{doc.is_density_ready ? "YES" : "—"}</span>;
    default:
      return null;
  }
}

/** Desktop column cell — value at the persona's fixed width + alignment. */
function Cell({ doc, col, isAuthed }: { doc: ListingDocument; col: ColumnDef; isAuthed: boolean }) {
  if (col.type === "address")
    return (
      <div className={cn("min-w-0", col.width)}>
        <ListingCardBody doc={doc} />
      </div>
    );
  if (col.type === "alphaFlag") {
    const flag = getAlphaFlag(doc, isAuthed);
    return (
      <div className={cn("shrink-0", col.width, alignClass(col.align))}>
        {flag.variant === "none" ? (
          <span className="text-xs text-slate-600">—</span>
        ) : (
          <span className={cn("inline-block rounded-none border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", ALPHA_FLAG_CLASS[flag.variant])}>
            {flag.label}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className={cn("shrink-0 text-xs font-mono", col.width, alignClass(col.align))}>
      <ColumnValue doc={doc} col={col} isAuthed={isAuthed} />
    </div>
  );
}

/**
 * MetricChip — mobile/compact card chip carrying a persona shadow-data metric
 * (e.g. "CAP 6.2%", "DOM 142d", "DROP -$40k"). Self-labels because the column
 * headers are hidden in card mode. This is what keeps the moat visible on mobile.
 */
function MetricChip({ doc, col, isAuthed }: { doc: ListingDocument; col: ColumnDef; isAuthed: boolean }) {
  if (col.type === "alphaFlag") {
    const flag = getAlphaFlag(doc, isAuthed);
    if (flag.variant === "none") return null;
    return (
      <span className={cn("inline-block rounded-none border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", ALPHA_FLAG_CLASS[flag.variant])}>
        {flag.label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-baseline gap-1 rounded-sm bg-slate-800/50 px-1.5 py-0.5 font-mono text-xs">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{col.header}</span>
      <ColumnValue doc={doc} col={col} isAuthed={isAuthed} />
    </span>
  );
}

export default function LedgerRow({ property, columns, onClick, isSelected, isHovered, onHoverChange, isChecked, onToggleSelect, isAuthed = false, compact = false }: LedgerRowProps) {
  const src = property.thumbnailUrl || property.primaryImageUrl;
  const deal = dealScoreFromDocument(property);
  // Compact (mobile / narrow panel): render the address card PLUS a wrapping strip
  // of persona shadow-data chips. Dropping the columns entirely (audit C4) also hid
  // the moat on mobile — chips put the differentiating numbers back without crushing
  // the price, since they flow vertically instead of as fixed-width columns.
  const analyticalColumns = columns.filter((c) => c.type !== "address");

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        "group flex cursor-pointer items-center gap-3 border-b border-slate-800/50 px-3 py-2.5 transition-colors hover:bg-slate-800/50",
        isHovered && !isSelected && "bg-slate-800/50 ring-1 ring-inset ring-cyan-500/40",
        isSelected && "border-l-2 border-l-cyan-500 bg-cyan-900/20",
        isChecked && !isSelected && "bg-cyan-900/10"
      )}
    >
      {/* Multi-select checkbox */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect?.();
        }}
        aria-label={isChecked ? "Remove from selection" : "Add to selection"}
        aria-pressed={isChecked}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-none border transition-colors",
          isChecked
            ? "border-cyan-500 bg-cyan-500 text-slate-950"
            : "border-slate-600 text-transparent hover:border-cyan-400"
        )}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>

      {/* Thumbnail + overlays (DealScore pill, save heart). The outer wrapper
          is `relative` so the absolute children position against this box;
          ListingThumbnail fills it via `absolute inset-0`. */}
      <div className="relative h-20 w-24 shrink-0 overflow-hidden rounded-sm">
        <ListingThumbnail
          src={src}
          alt={property.UnparsedAddress || "Property"}
          className="absolute inset-0"
          sizes="96px"
        />
        {deal.score !== null && isAuthed && (
          <DealScoreGradePill
            score={deal.score}
            grade={deal.grade}
            className="absolute left-1 top-1 z-10 backdrop-blur-sm"
          />
        )}
        <WatchHeart
          item={{ listing_key: property.id, address: property.UnparsedAddress, city: property.City, thumb: src, list_price: property.ListPrice, status: property.Status }}
          className="absolute right-1 top-1 z-10 rounded-none bg-slate-900/70 p-1 transition-colors hover:bg-slate-900"
          iconClassName="h-3.5 w-3.5 text-slate-400"
        />
      </div>

      {compact ? (
        <div className="min-w-0 flex-1">
          <ListingCardBody doc={property} />
          {analyticalColumns.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {analyticalColumns.map((col) => (
                <MetricChip key={col.type} doc={property} col={col} isAuthed={isAuthed} />
              ))}
            </div>
          )}
        </div>
      ) : (
        columns.map((col) => <Cell key={col.type} doc={property} col={col} isAuthed={isAuthed} />)
      )}
    </div>
  );
}
