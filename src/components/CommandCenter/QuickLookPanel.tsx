/**
 * QuickLookPanel — the Command Center's interim "quick look" drawer (desktop only).
 *
 * Mostly zero-fetch: the header, photo, specs, quick tiles and Structural Vitals all
 * render instantly from the Typesense `ListingDocument` already in memory. ONE focused
 * call (/api/property/[id]/deal-score) hydrates the AVM-anchored Deal Score + Estimated
 * Sale so they match the full report /properties/[id] EXACTLY (same engine, same gating).
 * The heavy detail (full media, schools, room map, DOM timeline, sale history, the
 * Underwriting Sandbox) still lives only on the full report.
 *
 * Mobile never mounts this: `useOpenListing` routes phone clicks straight to the full
 * report. See src/hooks/useOpenListing.ts and src/app/properties/page.tsx.
 *
 * Compliance (CLAUDE.md §4): brokerage (`ListOfficeName`) is displayed in the same
 * treatment as the other details; the Deal Score / estimate are deterministic (no LLM)
 * and VOW-gated for anonymous users; the AVM disclaimer renders with the estimate.
 */

"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  X,
  Bed,
  Bath,
  Square,
  Car,
  Home,
  Building2,
  ExternalLink,
  GitCompareArrows,
  Check,
} from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { ListingDocument } from "@/lib/typesense/client";
import { AlphaBadge, detectPropertyBadges } from "./AlphaBadge";
import DealScoreCard from "@/components/Property/DealScoreCard";
import EstimatedSaleCard from "@/components/Property/EstimatedSaleCard";
import InfoDot from "@/components/ui/InfoDot";
import type { GlossaryKey } from "@/lib/glossary";
import Disclaimers from "@/components/hiddenEquity/Disclaimers";
import { capRateOrNull, grossYieldOrNull } from "@/lib/metrics/sanityBand";
import { bedsLabel } from "@/lib/listings/bedsLabel";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import WatchButton from "@/components/watchlist/WatchButton";
import type { SalePriceEstimate } from "@/lib/avm/salePrice";
import type { AVMResult } from "@/lib/avm/types";
import type { DealScoreResult } from "@/lib/dealScore/computeDealScore";

interface QuickLookPanelProps {
  property: ListingDocument;
  onClose: () => void;
}

const pct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "—");

export default function QuickLookPanel({ property, onClose }: QuickLookPanelProps) {
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const isSelected = useCommandCenterStore((s) => s.selectedIds.has(property.id));
  // Carry the active lens to the full report so it opens on the same persona.
  const activePersona = useCommandCenterStore((s) => s.activePersona);

  // Authoritative, AVM-anchored Deal Score + Estimated Sale — fetched so they match the
  // full report exactly (the index doc alone has no AVM, so a local compute would diverge).
  const [dealScore, setDealScore] = useState<DealScoreResult | null>(null);
  const [estimate, setEstimate] = useState<AVMResult | null>(null);
  const [salePrice, setSalePrice] = useState<SalePriceEstimate | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [hasDealScore, setHasDealScore] = useState(false);
  const [hasEstimate, setHasEstimate] = useState(false);
  const [hasExpectedSale, setHasExpectedSale] = useState(false);
  const [loadingScore, setLoadingScore] = useState(true);

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

  // Single focused fetch for the AVM-anchored score slice. The panel is keyed by
  // listing id in the parent, so it remounts fresh per property — no manual reset needed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/property/${property.id}/deal-score`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setDealScore(data?.dealScore ?? null);
        setEstimate(data?.estimate ?? null);
        setSalePrice(data?.salePrice ?? null);
        setIsAuthed(!!data?.isAuthed);
        setHasDealScore(!!data?.hasDealScore);
        setHasEstimate(!!data?.hasEstimate);
        setHasExpectedSale(!!data?.hasExpectedSale);
      } catch {
        /* keep the lean header — score cards simply stay hidden */
      } finally {
        if (!cancelled) setLoadingScore(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [property.id]);

  const badges = detectPropertyBadges(
    property as Parameters<typeof detectPropertyBadges>[0]
  ).slice(0, 3);

  const dom = property.TrueDom ?? property.calculatedDOM ?? property.DaysOnMarket ?? 0;
  const domColor = dom > 45 ? "text-emerald-400" : dom >= 14 ? "text-amber-400" : "text-slate-300";
  const yieldEst = grossYieldOrNull(property.gross_yield_est);
  const capRate = capRateOrNull(property.cap_rate_est);
  const hero = property.primaryImageUrl || property.thumbnailUrl;
  const sqft = property.BuildingAreaTotal && property.BuildingAreaTotal > 0
    ? property.BuildingAreaTotal.toLocaleString()
    // BuildingAreaTotal is ~never filled for houses; fall back to the TRREB
    // LivingAreaRange band ("2500-3000") so houses show sqft instead of a dash.
    : property.LivingAreaRange?.trim() || "—";
  const lot = property.LotWidth
    ? `${property.LotWidth} × ${property.LotDepth || "?"}`
    : property.LotSqftTotal
      ? `${property.LotSqftTotal.toLocaleString()} sqft`
      : "—";
  const cooling = Array.isArray(property.Cooling) ? property.Cooling.join(", ") : property.Cooling;
  const showEstimate = !loadingScore && (!!salePrice || (!isAuthed && (hasEstimate || hasExpectedSale)));
  const showDisclaimer =
    !loadingScore && ((salePrice?.value ?? 0) > 0 || (estimate?.estimatedValue ?? 0) > 0);

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

          {/* Primary actions — kept near the top so the full report is one click away,
              without scrolling past the analysis below. */}
          <div className="mt-4 space-y-2">
            <Link
              href={`/properties/${property.id}?lens=${activePersona}`}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <ExternalLink className="h-4 w-4" />
              Open Full Report
            </Link>
            <div className="grid grid-cols-2 gap-2">
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
          </div>

          {/* Specs */}
          <div className="my-4 grid grid-cols-4 divide-x divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/40">
            <Spec icon={<Bed className="h-4 w-4 text-emerald-400" />} value={bedsLabel(property) ?? (property.BedroomsTotal || 0)} label="Beds" />
            <Spec icon={<Bath className="h-4 w-4 text-cyan-400" />} value={property.BathroomsTotalInteger || 0} label="Baths" />
            <Spec icon={<Square className="h-4 w-4 text-purple-400" />} value={sqft} label="Sqft" />
            <Spec icon={<Car className="h-4 w-4 text-amber-400" />} value={property.ParkingTotal || 0} label="Parking" />
          </div>

          {/* Signal tiles — instant from the index doc, while the score cards hydrate */}
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Tile label="True DOM" value={`${dom}d`} valueClass={domColor} term="dom" />
            <Tile label="Gross Yield" value={pct(yieldEst)} valueClass="text-emerald-400" term="grossYield" />
            <Tile label="Cap Rate" value={pct(capRate)} valueClass="text-slate-200" term="capRate" />
          </div>

          {/* Deal Score — AVM-anchored, fetched so it matches the full report exactly */}
          <div className="mb-4">
            {loadingScore ? (
              <ScoreSkeleton />
            ) : dealScore ? (
              <DealScoreCard dealScore={dealScore} locked={!isAuthed && hasDealScore} />
            ) : null}
          </div>

          {/* Estimated Sale — flagship "shadow data" valuation */}
          {showEstimate && (
            <div className="mb-4">
              <EstimatedSaleCard
                salePrice={salePrice}
                listPrice={property.ListPrice}
                city={property.City}
                propertySubType={property.PropertySubType}
                locked={!isAuthed && (hasEstimate || hasExpectedSale)}
              />
              {showDisclaimer && <Disclaimers />}
            </div>
          )}

          {/* Structural Vitals — zero-fetch, scannable facts from the index doc */}
          <div className="mb-4">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-200">
              <Home className="h-4 w-4 text-emerald-400" />
              Structural Vitals
            </h3>
            <table className="w-full border-collapse text-sm">
              <tbody className="divide-y divide-slate-800">
                <Vital k="Lot" v={lot} />
                <Vital k="Property Age" v={property.ApproximateAge || "—"} />
                <Vital k="Heating" v={property.Heating || "—"} />
                <Vital k="Cooling" v={cooling || "—"} />
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-600">
            The full report adds schools, room map, sale history &amp; the Underwriting Sandbox.
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

function Tile({
  label,
  value,
  valueClass,
  term,
}: {
  label: string;
  value: string;
  valueClass?: string;
  term?: GlossaryKey;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2.5 text-center">
      <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wide text-slate-500">
        {label}
        {term && <InfoDot term={term} />}
      </div>
      <div className={cn("mt-1 font-mono text-sm font-bold", valueClass)}>{value}</div>
    </div>
  );
}

function Vital({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <td className="w-1/3 py-2 text-slate-500">{k}</td>
      <td className="py-2 font-mono text-slate-200">{v}</td>
    </tr>
  );
}

function ScoreSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-3 h-3 w-24 rounded bg-slate-800" />
      <div className="flex items-center gap-4">
        <div className="h-[88px] w-[88px] rounded-full bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-full rounded bg-slate-800" />
          <div className="h-3 w-2/3 rounded bg-slate-800" />
        </div>
      </div>
    </div>
  );
}
