/**
 * LedgerRow — persona-driven property row. Columns come from PERSONA_CONFIG.
 */

"use client";

import React, { useState } from "react";
import Image from "next/image";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnDef } from "@/lib/personas/personaConfig";
import { getAlphaFlag, ALPHA_FLAG_CLASS } from "@/lib/personas/getAlphaFlag";

interface LedgerRowProps {
  property: ListingDocument;
  columns: ColumnDef[];
  onClick: () => void;
  isSelected?: boolean;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
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
          <p className="truncate pr-2 font-sans text-xs font-medium text-slate-200">{addr}</p>
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] uppercase tracking-wide text-slate-500">
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
      const color = dom > 90 ? "text-rose-400" : dom > 45 ? "text-emerald-400" : dom >= 14 ? "text-amber-400" : "text-slate-400";
      return <div className={cn(base, color, "font-semibold")}>{dom}d</div>;
    }
    case "capRate": {
      const v = doc.ExtrapolatedCapRate ?? doc.cap_rate_est;
      return <div className={cn(base, "text-emerald-400")}>{v ? `${v.toFixed(1)}%` : "—"}</div>;
    }
    case "yield": {
      const v = doc.targetGrossYield ?? doc.gross_yield_est;
      return <div className={cn(base, "text-emerald-400")}>{v ? `${(v * 100).toFixed(1)}%` : "—"}</div>;
    }
    case "carryCost":
      return (
        <div className={cn(base, "text-emerald-400")}>
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
            <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider", ALPHA_FLAG_CLASS[flag.variant])}>
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

export default function LedgerRow({ property, columns, onClick, isSelected, isHovered, onHoverChange }: LedgerRowProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [imageError, setImageError] = useState(false);
  const src = !imageError && isUsableImage(property.thumbnailUrl || property.primaryImageUrl)
    ? (property.thumbnailUrl || property.primaryImageUrl)!
    : PLACEHOLDER_IMAGE;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      className={cn(
        "group flex cursor-pointer items-center gap-3 border-b border-slate-800/50 px-3 py-2 transition-colors hover:bg-slate-800/50",
        isHovered && !isSelected && "bg-slate-800/50 ring-1 ring-inset ring-emerald-500/40",
        isSelected && "border-l-2 border-l-emerald-500 bg-emerald-900/20"
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded bg-slate-800">
        <Image
          src={src}
          alt={property.UnparsedAddress || "Property"}
          fill
          className="object-cover"
          unoptimized
          onError={() => setImageError(true)}
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsSaved(!isSaved);
          }}
          className="absolute right-0.5 top-0.5 z-10 rounded-full bg-slate-900/70 p-1 transition-colors hover:bg-slate-900"
        >
          <Heart className={cn("h-3 w-3", isSaved ? "fill-red-500 text-red-500" : "text-slate-400")} />
        </button>
      </div>

      {columns.map((col) => (
        <Cell key={col.type} doc={property} col={col} />
      ))}
    </div>
  );
}
