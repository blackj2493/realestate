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

function Cell({ doc, col, isAuthed }: { doc: ListingDocument; col: ColumnDef; isAuthed: boolean }) {
  const base = cn("shrink-0 text-xs font-mono", col.width, alignClass(col.align));

  switch (col.type) {
    case "address":
      return (
        <div className={cn("min-w-0", col.width)}>
          <ListingCardBody doc={doc} />
        </div>
      );
    case "trueDom": {
      // True DOM is relist-corrected (VOW-derived) — gated for anon (§6.2(f)).
      if (!isAuthed)
        return (
          <div className={cn(base, "text-slate-600")} title="Sign in to view True DOM">
            🔒
          </div>
        );
      const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket ?? 0;
      const color = dom > 90 ? "text-rose-400" : dom > 45 ? "text-cyan-400" : dom >= 14 ? "text-amber-400" : "text-slate-400";
      return <div className={cn(base, color, "font-semibold")}>{dom}d</div>;
    }
    case "capRate": {
      const v = capRateOrNull(doc.cap_rate_est);
      return <div className={cn(base, "text-cyan-400")}>{v != null ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "yield": {
      // gross_yield_est is already a PERCENT — no ×100 (that was for the old fraction targetGrossYield).
      const v = grossYieldOrNull(doc.gross_yield_est);
      return <div className={cn(base, "text-cyan-400")}>{v != null ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "carryCost":
      return (
        <div className={cn(base, "text-cyan-400")}>
          ${carryFor(doc).toLocaleString()}
          <span className="text-[9px] text-slate-500">/mo</span>
        </div>
      );
    case "priceDrop":
      return (
        <div className={cn(base, doc.TotalPriceDrop ? "text-rose-400" : "text-slate-500")}>
          {doc.TotalPriceDrop ? `-$${doc.TotalPriceDrop.toLocaleString()}` : "—"}
        </div>
      );
    case "suite":
      return (
        <div className={cn(base, "text-blue-300")}>
          {doc.SuiteStatus === "EXISTING_SUITE" ? "EXISTING" : doc.SuiteStatus === "POTENTIAL_CANDIDATE" ? "CANDIDATE" : "—"}
        </div>
      );
    case "lotDims": {
      const w = doc.LotWidth ?? doc.lot_width_ft;
      const d = doc.LotDepth ?? doc.lot_depth_ft;
      return <div className={cn(base, "text-slate-300")}>{w ? `${w}′×${d ?? "?"}′` : "—"}</div>;
    }
    case "zoning":
      return <div className={cn(base, doc.multiplex_by_right ? "text-cyan-400" : "text-slate-300")}>{doc.zoning_designation || "—"}</div>;
    case "density":
      return <div className={cn(base, doc.is_density_ready ? "text-cyan-400" : "text-slate-500")}>{doc.is_density_ready ? "YES" : "—"}</div>;
    case "alphaFlag": {
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
    default:
      return null;
  }
}

export default function LedgerRow({ property, columns, onClick, isSelected, isHovered, onHoverChange, isChecked, onToggleSelect, isAuthed = false, compact = false }: LedgerRowProps) {
  const src = property.thumbnailUrl || property.primaryImageUrl;
  const deal = dealScoreFromDocument(property);
  // In compact card mode only the address card renders; the fixed numeric
  // columns are dropped so the price never gets crushed (audit C4).
  const visibleColumns = compact ? columns.filter((c) => c.type === "address") : columns;

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

      {visibleColumns.map((col) => (
        <Cell key={col.type} doc={property} col={col} isAuthed={isAuthed} />
      ))}
    </div>
  );
}
