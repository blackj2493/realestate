/**
 * QuickLookPanel — the Command Center's interim "quick look" drawer (desktop only).
 *
 * Deliberately ZERO-FETCH: every value renders from the Typesense `ListingDocument`
 * already in memory (the list/map result), plus a client-side Deal Score via
 * `dealScoreFromDocument`. The heavy detail (full media, schools, room map, AVM
 * estimate, DOM timeline, sale history, Underwriting Sandbox) lives on the full
 * server-rendered report at /properties/[id] — reached via "Open Full Report".
 *
 * Mobile never mounts this: `useOpenListing` routes phone clicks straight to the
 * full report. See src/hooks/useOpenListing.ts and src/app/properties/page.tsx.
 *
 * Compliance (CLAUDE.md §4): brokerage (`ListOfficeName`) is displayed in the same
 * treatment as the other details; the Deal Score is deterministic (no LLM); no
 * VOW/AVM-derived numbers are surfaced here (deferred to the gated full report).
 */

"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Bed,
  Bath,
  Square,
  Car,
  Building2,
  ExternalLink,
  GitCompareArrows,
  Check,
} from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import { AlphaBadge, detectPropertyBadges } from "./AlphaBadge";
import { DealScoreBadge } from "@/components/Property/DealScoreCard";
import { dealScoreFromDocument } from "@/lib/dealScore/fromListingDocument";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import WatchButton from "@/components/watchlist/WatchButton";

interface QuickLookPanelProps {
  property: ListingDocument;
  onClose: () => void;
}

const pct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "—");

export default function QuickLookPanel({ property, onClose }: QuickLookPanelProps) {
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const isSelected = useCommandCenterStore((s) => s.selectedIds.has(property.id));

  // Esc closes; lock body scroll while the drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Client-side, deterministic Deal Score from the index doc (no AVM fetch). The
  // full report shows the AVM-anchored authoritative score.
  const deal = dealScoreFromDocument(property, undefined, activePersona);
  const badges = detectPropertyBadges(
    property as Parameters<typeof detectPropertyBadges>[0]
  ).slice(0, 3);

  const dom = property.TrueDom ?? property.calculatedDOM ?? property.DaysOnMarket ?? 0;
  // Longer DOM = more negotiating room (buyer-favourable), so green at the top end.
  const domColor = dom > 45 ? "text-emerald-400" : dom >= 14 ? "text-amber-400" : "text-slate-300";
  const yieldEst = grossYieldOrNull(property.gross_yield_est);
  const capRate = capRateOrNull(property.cap_rate_est);
  const hero = property.primaryImageUrl || property.thumbnailUrl;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden="true" />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Property quick look"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl animate-in slide-in-from-right duration-300"
      >
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-800 px-4">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-400">
            <Search className="h-3.5 w-3.5" />
            Quick Look
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close quick look"
            className="rounded-full border border-slate-700 bg-slate-800 p-2 transition-colors hover:bg-slate-700"
          >
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto no-scrollbar p-4">
          {/* Hero — single primary image from the index (no media fetch) */}
          <div className="relative mb-4 h-44 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            {hero ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={hero}
                alt={property.UnparsedAddress || "Listing photo"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-xs uppercase tracking-widest text-slate-600">
                No photo
              </div>
            )}
            {badges.length > 0 && (
              <div className="absolute inset-x-3 bottom-3 flex flex-wrap gap-1.5">
                {badges.map((b, i) => (
                  <AlphaBadge key={i} variant={b.variant} label={b.label} value={b.value} />
                ))}
              </div>
            )}
          </div>

          {/* Headline */}
          <h1 className="text-lg font-bold leading-snug text-slate-100">
            {property.UnparsedAddress || "Address Unavailable"}
          </h1>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-2xl font-bold text-emerald-400">
              {formatPrice(property.ListPrice)}
            </span>
            <span className="text-xs text-slate-500">
              {property.City}
              {property.City ? " · " : ""}
              {property.PropertySubType || property.PropertyType}
            </span>
          </div>

          {/* Brokerage — §4: same treatment as the other listing details, no visual separation */}
          {property.ListOfficeName && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400">
              <Building2 className="h-3.5 w-3.5 text-slate-500" />
              {property.ListOfficeName}
            </p>
          )}

          {/* Specs */}
          <div className="my-4 grid grid-cols-4 divide-x divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
            <Spec icon={<Bed className="h-4 w-4 text-emerald-400" />} value={bedsLabel(property) ?? (property.BedroomsTotal || 0)} label="Beds" />
            <Spec icon={<Bath className="h-4 w-4 text-cyan-400" />} value={property.BathroomsTotalInteger || 0} label="Baths" />
            <Spec icon={<Square className="h-4 w-4 text-purple-400" />} value={property.BuildingAreaTotal?.toLocaleString() || "N/A"} label="Sqft" />
            <Spec icon={<Car className="h-4 w-4 text-amber-400" />} value={property.ParkingTotal || 0} label="Parking" />
          </div>

          {/* Signal tiles — all from the index doc */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Tile label="True DOM" value={`${dom}d`} valueClass={domColor} />
            <Tile label="Gross Yield" value={pct(yieldEst)} valueClass="text-emerald-400" />
            <Tile label="Cap Rate" value={pct(capRate)} valueClass="text-slate-200" />
          </div>

          {/* Deal Score — deterministic, computed client-side from the doc */}
          {deal.score !== null && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
              <DealScoreBadge score={deal.score} grade={deal.grade} />
              {deal.verdict && <p className="text-xs leading-snug text-slate-400">{deal.verdict}</p>}
            </div>
          )}

          {/* CTAs */}
          <Link
            href={`/properties/${property.id}`}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
          >
            <ExternalLink className="h-4 w-4" />
            Open Full Report
          </Link>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <WatchButton
              item={{
                listing_key: property.id,
                address: property.UnparsedAddress,
                city: property.City,
                list_price: property.ListPrice,
                thumb: property.primaryImageUrl,
                status: property.Status,
              }}
              label="Save"
            />
            <button
              type="button"
              onClick={() => toggleSelected(property.id)}
              aria-pressed={isSelected}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
                isSelected
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
                  : "border-slate-700 text-slate-300 hover:bg-slate-800"
              )}
            >
              {isSelected ? <Check className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
              {isSelected ? "Added" : "Compare"}
            </button>
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-600">
            Full financials, schools, room map, sale history &amp; the Underwriting Sandbox live in the full report.
          </p>
        </div>
      </aside>
    </>
  );
}

function Spec({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-3">
      {icon}
      <span className="font-mono text-sm font-bold text-slate-200">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

function Tile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cn("mt-1 font-mono text-sm font-bold", valueClass)}>{value}</div>
    </div>
  );
}
