/**
 * LedgerRow — persona-driven property row. Columns come from PERSONA_CONFIG.
 */

"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Heart, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnDef } from "@/lib/personas/personaConfig";
import { getAlphaFlag, ALPHA_FLAG_CLASS } from "@/lib/personas/getAlphaFlag";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreGradePill } from "@/components/Property/DealScoreCard";

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
}

const PLACEHOLDER_IMAGE =
  "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";

function isUsableImage(url?: string) {
  return !!url && !url.includes("example.com");
}

function carryFor(p: ListingDocument): number {
  if (p.MonthlyCarryCost) return Math.round(p.MonthlyCarryCost);
  const principal = (p.ListPrice || 0) * 0.8;
  const r = 0.07 / 12;
  const n = 360;
  const mortgage = principal ? (principal * (r * (1 + r) ** n)) / ((1 + r) ** n - 1) : 0;
  return Math.round(mortgage + (p.TaxAnnualAmount || 0) / 12 + (p.AssociationFee || 0));
}

function alignClass(a: ColumnDef["align"]) {
  return a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";
}

function Cell({ doc, col }: { doc: ListingDocument; col: ColumnDef }) {
  const base = cn("shrink-0 text-xs font-mono", col.width, alignClass(col.align));

  switch (col.type) {
    case "address": {
      const addr = doc.UnparsedAddress?.trim() || doc.City || "Address unavailable";
      return (
        <div className={cn("min-w-0", col.width)}>
          <p className="line-clamp-3 pr-2 font-sans text-sm font-medium leading-snug text-slate-200">{addr}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <span>{doc.City || "—"}</span>
            <span className="text-slate-600">·</span>
            <span>{doc.PropertySubType || doc.PropertyType || "Residential"}</span>
            {doc.ListOfficeName && (
              <>
                <span className="text-slate-600">·</span>
                <span className="truncate normal-case tracking-normal">{doc.ListOfficeName}</span>
              </>
            )}
          </div>
        </div>
      );
    }
    case "trueDom": {
      const dom = doc.TrueDom ?? doc.calculatedDOM ?? doc.DaysOnMarket ?? 0;
      const color = dom > 90 ? "text-rose-400" : dom > 45 ? "text-cyan-400" : dom >= 14 ? "text-amber-400" : "text-slate-400";
      return <div className={cn(base, color, "font-semibold")}>{dom}d</div>;
    }
    case "capRate": {
      const v = doc.ExtrapolatedCapRate ?? doc.cap_rate_est;
      return <div className={cn(base, "text-cyan-400")}>{v ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "yield": {
      const v = doc.targetGrossYield ?? doc.gross_yield_est;
      return <div className={cn(base, "text-cyan-400")}>{v ? `${(v * 100).toFixed(1)}%` : "—"}</div>;
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
      const flag = getAlphaFlag(doc);
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

export default function LedgerRow({ property, columns, onClick, isSelected, isHovered, onHoverChange, isChecked, onToggleSelect }: LedgerRowProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [imageError, setImageError] = useState(false);
  const src = !imageError && isUsableImage(property.thumbnailUrl || property.primaryImageUrl)
    ? (property.thumbnailUrl || property.primaryImageUrl)!
    : PLACEHOLDER_IMAGE;
  const deal = dealScoreFromDocument(property);

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

      {/* Thumbnail */}
      <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-none bg-slate-800">
        <Image
          src={src}
          alt={property.UnparsedAddress || "Property"}
          fill
          className="object-cover"
          unoptimized
          onError={() => setImageError(true)}
        />
        {deal.score !== null && (
          <DealScoreGradePill
            score={deal.score}
            grade={deal.grade}
            className="absolute left-1 top-1 z-10 backdrop-blur-sm"
          />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsSaved(!isSaved);
          }}
          className="absolute right-1 top-1 z-10 rounded-none bg-slate-900/70 p-1 transition-colors hover:bg-slate-900"
        >
          <Heart className={cn("h-3.5 w-3.5", isSaved ? "fill-red-500 text-red-500" : "text-slate-400")} />
        </button>
      </div>

      {columns.map((col) => (
        <Cell key={col.type} doc={property} col={col} />
      ))}
    </div>
  );
}
