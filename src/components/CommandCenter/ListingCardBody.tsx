/**
 * ListingCardBody — the shared text block of a property card: status + freshness,
 * price, address, bed/bath/parking strip, and the MLS# · type · brokerage footer.
 *
 * Single source of truth so the ledger list (LedgerRow) and the map popup
 * (ListingMapPopup) render identical card content. The caller owns the width
 * wrapper; this component just fills it (uses truncate/line-clamp, so the parent
 * must be `min-w-0`).
 */

"use client";

import React from "react";
import { BedDouble, Bath, Car, Layers, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { statusBadge, type BadgeTone } from "@/lib/listings/statusBadge";
import { layerStatus, LAYER_TONE_CLASS } from "@/lib/listings/layerStatus";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { basementLabel } from "@/lib/listings/basementLabel";
import { soldVsAsk } from "@/lib/sold/delta";
import { isDelistedDealType } from "@/lib/sold/dealType";
import type { ListingDocument } from "@/lib/typesense/client";

/** "Listed N days ago" — EntryTimestamp is epoch MILLISECONDS; falls back to DaysOnMarket. */
export function daysAgo(p: ListingDocument): number | null {
  if (p.EntryTimestamp && p.EntryTimestamp > 0) {
    return Math.max(0, Math.floor((Date.now() - p.EntryTimestamp) / 86_400_000));
  }
  return p.DaysOnMarket ?? null;
}

const BADGE_TONE: Record<BadgeTone, string> = {
  warn: "bg-amber-500/15 text-amber-300",
  info: "bg-sky-500/15 text-sky-300",
  neutral: "bg-slate-500/15 text-slate-300",
};

/** Compact icon + value chip for the bed/bath/parking strip. */
function StatChip({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      {label}
    </span>
  );
}

export default function ListingCardBody({ doc }: { doc: ListingDocument }) {
  const addr = doc.UnparsedAddress?.trim() || doc.City || "Address unavailable";
  const age = daysAgo(doc);
  const beds = bedsLabel(doc);
  const baths = doc.BathroomsTotalInteger;
  const parking = doc.ParkingTotal;
  const type = doc.PropertySubType || doc.PropertyType || "Residential";
  // Only surface basement when it carries real info ("None" = condo/no data): the
  // chip strip is dense, so we don't spend a slot on a non-signal.
  const basementLbl = basementLabel(doc);
  const basement = basementLbl !== "None" ? basementLbl : null;

  const chips = [
    beds ? <StatChip key="beds" icon={BedDouble} label={beds} /> : null,
    baths ? <StatChip key="baths" icon={Bath} label={String(baths)} /> : null,
    parking ? <StatChip key="parking" icon={Car} label={String(parking)} /> : null,
    basement ? <StatChip key="basement" icon={Layers} label={basement} /> : null,
  ].filter(Boolean);

  const badge = statusBadge(doc.Status);

  if (doc.compKind || doc.IsSoldComp) {
    const status = layerStatus(doc);
    const isLeased = doc.compKind === "leased";
    const isDelisted = isDelistedDealType(doc.compKind);
    const delta = isDelisted ? null : soldVsAsk(doc.ListPrice, doc.OriginalListPrice ?? null);
    // De-listed: ListPrice = final ask, OriginalListPrice = original ask → the
    // cut the seller made during the failed campaign.
    const askCut =
      isDelisted && doc.OriginalListPrice && doc.ListPrice && doc.OriginalListPrice > doc.ListPrice
        ? Math.round(((doc.OriginalListPrice - doc.ListPrice) / doc.OriginalListPrice) * 100)
        : null;
    const onIso = isLeased ? doc.LeasedDate : isDelisted ? doc.DelistedDate : doc.SoldDate;
    const on = onIso ? new Date(onIso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : null;
    const deltaTone =
      delta?.direction === "over" ? "text-rose-300" : delta?.direction === "under" ? "text-emerald-300" : "text-slate-300";
    return (
      <>
        <div className="flex items-center gap-1.5 text-[10px]">
          <span className={cn("shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide", LAYER_TONE_CLASS[status.tone])}>
            {status.label}
          </span>
          {on && <span className="text-slate-500">{on}</span>}
          {isDelisted && (doc.DaysOnMarket ?? 0) > 0 && (
            <span className="text-slate-500">· survived {doc.DaysOnMarket}d</span>
          )}
        </div>
        <p className="mt-0.5 font-sans text-base font-bold text-cyan-300">
          {doc.ListPrice ? `$${doc.ListPrice.toLocaleString()}${isLeased ? "/mo" : ""}` : "—"}
        </p>
        {delta && (
          <p className={cn("mt-0.5 font-mono text-xs font-semibold", deltaTone)}>
            {delta.direction === "at" ? "At ask" : `${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct}% ${delta.direction} ask`}
            <span className="ml-1 text-slate-500">(asked ${(doc.OriginalListPrice ?? 0).toLocaleString()})</span>
          </p>
        )}
        {isDelisted && (
          <p className="mt-0.5 font-mono text-xs font-semibold text-amber-300">
            {askCut !== null
              ? `Cut ${askCut}% during campaign (from $${(doc.OriginalListPrice ?? 0).toLocaleString()})`
              : doc.OriginalListPrice && doc.OriginalListPrice === doc.ListPrice
                ? "No cuts during campaign — did not sell"
                : "Last ask — did not sell"}
          </p>
        )}
        <p className="mt-0.5 line-clamp-2 pr-2 font-sans text-sm font-medium leading-snug text-slate-200">{addr}</p>
        {chips.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-300">
            {chips.map((chip, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="text-slate-600">·</span>}
                {chip}
              </React.Fragment>
            ))}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] uppercase tracking-wide text-slate-500">
          <span className="normal-case tracking-normal">{doc.id}</span>
          <span className="text-slate-600">·</span>
          <span>{type}</span>
          {/* TRREB §6.3(c): brokerage must always be displayed — fallback, never omit */}
          <span className="text-slate-600">·</span>
          <span className="truncate normal-case tracking-normal">{doc.ListOfficeName || "Brokerage unavailable"}</span>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Status chip + freshness (small line above the price) */}
      {(doc.TransactionType || badge || age !== null) && (
        <div className="flex items-center gap-1.5 text-[10px]">
          {doc.TransactionType && (
            <span
              className={cn(
                "shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide",
                /lease/i.test(doc.TransactionType) ? "bg-sky-500/15 text-sky-300" : "bg-emerald-500/15 text-emerald-300"
              )}
            >
              {doc.TransactionType}
            </span>
          )}
          {badge && (
            <span
              className={cn(
                "shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide",
                BADGE_TONE[badge.tone]
              )}
            >
              {badge.label}
            </span>
          )}
          {age !== null && <span className="text-slate-500">{age === 0 ? "today" : `${age}d ago`}</span>}
        </div>
      )}

      {/* Price — own line so it never gets squeezed by the chip/freshness.
          No `truncate`: a price must never be ellipsis-clipped to "$8…" (audit C4). */}
      <p className="mt-0.5 font-sans text-base font-bold text-cyan-300">
        {doc.ListPrice ? `$${doc.ListPrice.toLocaleString()}` : "—"}
      </p>

      {/* Address */}
      <p className="mt-0.5 line-clamp-2 pr-2 font-sans text-sm font-medium leading-snug text-slate-200">{addr}</p>

      {/* Bed / bath / parking strip — present chips joined by · separators */}
      {chips.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-slate-300">
          {chips.map((chip, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-slate-600">·</span>}
              {chip}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* MLS# · type · brokerage (brokerage at sibling weight per TRREB §6.3(c)) */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] uppercase tracking-wide text-slate-500">
        <span className="normal-case tracking-normal">{doc.id}</span>
        <span className="text-slate-600">·</span>
        <span>{type}</span>
        {/* TRREB §6.3(c): brokerage must always be displayed — fallback, never omit */}
        <span className="text-slate-600">·</span>
        <span className="truncate normal-case tracking-normal">{doc.ListOfficeName || "Brokerage unavailable"}</span>
      </div>
    </>
  );
}
