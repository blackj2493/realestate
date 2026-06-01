/**
 * LedgerRow — persona-driven property row. Columns come from PERSONA_CONFIG.
 */

"use client";

import React, { useState } from "react";
import { Heart, Check, BedDouble, Bath, Car, Maximize, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import type { ColumnDef } from "@/lib/personas/personaConfig";
import { getAlphaFlag, ALPHA_FLAG_CLASS } from "@/lib/personas/getAlphaFlag";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { DealScoreGradePill } from "@/components/Property/DealScoreCard";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";

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

/** "Listed N days ago" — EntryTimestamp is epoch MILLISECONDS; falls back to DaysOnMarket. */
function daysAgo(p: ListingDocument): number | null {
  if (p.EntryTimestamp && p.EntryTimestamp > 0) {
    return Math.max(0, Math.floor((Date.now() - p.EntryTimestamp) / 86_400_000));
  }
  return p.DaysOnMarket ?? null;
}

/** "4+1" bed label — above grade, plus below-grade when present. Falls back to total. */
function bedsLabel(p: ListingDocument): string | null {
  const above = p.BedroomsAboveGrade && p.BedroomsAboveGrade > 0 ? p.BedroomsAboveGrade : p.BedroomsTotal ?? 0;
  const below = p.BedroomsBelowGrade ?? 0;
  if (!above && !below) return null;
  return below > 0 ? `${above}+${below}` : `${above}`;
}

/** Compact icon + value chip for the bed/bath/parking/sqft strip. */
function StatChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      {label}
    </span>
  );
}

function Cell({ doc, col }: { doc: ListingDocument; col: ColumnDef }) {
  const base = cn("shrink-0 text-xs font-mono", col.width, alignClass(col.align));

  switch (col.type) {
    case "address": {
      const addr = doc.UnparsedAddress?.trim() || doc.City || "Address unavailable";
      const age = daysAgo(doc);
      const beds = bedsLabel(doc);
      const baths = doc.BathroomsTotalInteger;
      const parking = doc.ParkingTotal;
      const sqft = doc.BuildingAreaTotal && doc.BuildingAreaTotal > 0 ? doc.BuildingAreaTotal : null;
      const type = doc.PropertySubType || doc.PropertyType || "Residential";
      return (
        <div className={cn("min-w-0", col.width)}>
          {/* Price + listed-ago */}
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-sans text-sm font-bold text-cyan-300">
              {doc.ListPrice ? `$${doc.ListPrice.toLocaleString()}` : "—"}
            </span>
            {age !== null && (
              <span className="shrink-0 text-[10px] text-slate-500">{age === 0 ? "today" : `${age}d ago`}</span>
            )}
          </div>

          {/* Address */}
          <p className="mt-0.5 line-clamp-2 pr-2 font-sans text-sm font-medium leading-snug text-slate-200">{addr}</p>

          {/* Bed / bath / parking / sqft strip — each chip shown only when present */}
          {(beds || baths || parking || sqft) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-xs text-slate-300">
              {beds && <StatChip icon={BedDouble} label={beds} />}
              {baths ? <StatChip icon={Bath} label={String(baths)} /> : null}
              {parking ? <StatChip icon={Car} label={String(parking)} /> : null}
              {sqft && <StatChip icon={Maximize} label={`${Math.round(sqft).toLocaleString()} ft²`} />}
            </div>
          )}

          {/* MLS# · type · brokerage (brokerage at sibling weight per TRREB §6.3(c)) */}
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] uppercase tracking-wide text-slate-500">
            <span className="normal-case tracking-normal">{doc.id}</span>
            <span className="text-slate-600">·</span>
            <span>{type}</span>
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
  const src = property.thumbnailUrl || property.primaryImageUrl;
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

      {/* Thumbnail + overlays (DealScore pill, save heart). The outer wrapper
          is `relative` so the absolute children position against this box;
          ListingThumbnail fills it via `absolute inset-0`. */}
      <div className="relative h-16 w-24 shrink-0">
        <ListingThumbnail
          src={src}
          alt={property.UnparsedAddress || "Property"}
          className="absolute inset-0"
          sizes="96px"
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
        {property.TransactionType && (
          <span
            className={cn(
              "absolute bottom-1 left-1 z-10 rounded-none px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white",
              /lease/i.test(property.TransactionType) ? "bg-sky-600/90" : "bg-emerald-600/90"
            )}
          >
            {property.TransactionType}
          </span>
        )}
      </div>

      {columns.map((col) => (
        <Cell key={col.type} doc={property} col={col} />
      ))}
    </div>
  );
}
