/**
 * ListingTerminal - 70/30 Split Terminal for property detail
 * Left panel: Asset details (scrollable)
 * Right panel: Calculator & Ledger (sticky)
 */

"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  X,
  Bed,
  Bath,
  Car,
  Square,
  Home,
  AlertTriangle,
  GraduationCap,
  ExternalLink,
  GitCompareArrows,
  Check,
  Bookmark,
  BookmarkCheck,
  CalendarCheck
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import Logo from '@/components/Logo';
import PrimaryNav from '@/components/layout/PrimaryNav';
import { AlphaBadge, detectPropertyBadges } from './AlphaBadge';
import { bedsLabel } from '@/lib/listings/bedsLabel';
import UnderwritingSandbox from '@/components/Property/UnderwritingSandbox';
import DOMTimelineChart, { type SaleMarker } from './DOMTimelineChart';
import SaleHistorySection from '@/components/Property/SaleHistorySection';
import type { SaleHistory, PriceTimeline } from '@/lib/property/getListingDetail';
import ImageBentoGrid from '@/components/Property/ImageBentoGrid';
import MediaGalleryOverlay from '@/components/Property/MediaGalleryOverlay';
import DealScoreCard, { DealScoreBadge } from '@/components/Property/DealScoreCard';
import ListingEstimateCard from '@/components/Property/ListingEstimateCard';
import Disclaimers from '@/components/hiddenEquity/Disclaimers';
import SocialProofBar from '@/components/Property/SocialProofBar';
import RoomMap from '@/components/Property/RoomMap';
import type { RoomData } from '@/lib/room-utils';
import type { DealScoreResult } from '@/lib/dealScore/computeDealScore';
import type { AVMResult } from '@/lib/avm/types';
import type { ListingDocument } from '@/lib/typesense/client';
import { useCommandCenterStore } from '@/lib/stores/commandCenterStore';
import { useWatchlistStore } from '@/lib/watchlist/useWatchlist';

interface ListingTerminalProps {
  property: ListingDocument;
  isOpen: boolean;
  onClose: () => void;
}

interface NearbySchool {
  id: string;
  name: string;
  level: 'elementary' | 'secondary';
  system: 'public' | 'catholic';
  score: number | null;
  distanceKm: number;
}


export default function ListingTerminal({ property, isOpen, onClose }: ListingTerminalProps) {
  // School lens target (the school the user searched for, if any) — used to pin and
  // highlight that school in the "Schools near this home" list.
  const targetSchool = useCommandCenterStore((s) => s.school.targetSchool);
  const [nearbySchools, setNearbySchools] = useState<NearbySchool[]>([]);
  const [nearbyTotal, setNearbyTotal] = useState(0);

  // Multi-select (comparison) + real media/rooms hydrated from the Vault on open.
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const isSelected = useCommandCenterStore((s) => s.selectedIds.has(property.id));

  // Cross-device watchlist (same store + payload shape as ListingActions on the full page).
  const watched = useWatchlistStore((s) => !!s.items[property.id]);
  const toggleWatch = useWatchlistStore((s) => s.toggle);
  const [media, setMedia] = useState<string[]>([]);
  const [detailRooms, setDetailRooms] = useState<RoomData[]>([]);
  const [dealScore, setDealScore] = useState<DealScoreResult | null>(null);
  const [estimate, setEstimate] = useState<AVMResult | null>(null);
  const [saleHistory, setSaleHistory] = useState<SaleHistory | null>(null);
  const [priceTimeline, setPriceTimeline] = useState<PriceTimeline | null>(null);
  const [isAuthed, setIsAuthed] = useState(false);
  const [hasEstimate, setHasEstimate] = useState(false);
  const [hasDealScore, setHasDealScore] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  // Fetch all schools near this home (same 2.5 km radius as the NearbySchools filter,
  // so the searched school always appears here on a matched listing).
  useEffect(() => {
    if (!isOpen || !property?.location) return;
    const [lat, lng] = property.location;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/schools/nearby?lat=${lat}&lng=${lng}`);
        const data = await res.json();
        if (cancelled) return;
        setNearbySchools(Array.isArray(data?.results) ? data.results : []);
        setNearbyTotal(typeof data?.total === 'number' ? data.total : 0);
      } catch {
        if (!cancelled) {
          setNearbySchools([]);
          setNearbyTotal(0);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, property?.location]);

  // Hydrate real photos + rooms from the Vault (the search index only carries a
  // single thumbnail and no room ledger). Falls back to index fields while loading.
  useEffect(() => {
    if (!isOpen || !property?.id) return;
    let cancelled = false;
    setMedia([]);
    setDetailRooms([]);
    setDealScore(null);
    setEstimate(null);
    setSaleHistory(null);
    setPriceTimeline(null);
    setIsAuthed(false);
    setHasEstimate(false);
    setHasDealScore(false);
    setIsGalleryOpen(false);
    (async () => {
      try {
        const res = await fetch(`/api/property/${property.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setMedia(Array.isArray(data?.media_urls) ? data.media_urls : []);
        const r = data?.rooms ?? data?.full_payload?.rooms;
        setDetailRooms(Array.isArray(r) ? (r as RoomData[]) : []);
        setDealScore(data?.dealScore ?? null);
        setEstimate(data?.estimate ?? null);
        setSaleHistory(data?.saleHistory ?? null);
        setPriceTimeline(data?.priceTimeline ?? null);
        setIsAuthed(!!data?.isAuthed);
        setHasEstimate(!!data?.hasEstimate);
        setHasDealScore(!!data?.hasDealScore);
      } catch {
        /* keep index-only fallbacks */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, property?.id]);

  if (!isOpen) return null;

  const dom = property.calculatedDOM || property.DaysOnMarket || 0;
  // True DOM (stitched) + prior sold markers come from the API; both fall back gracefully.
  const trueDom = priceTimeline?.trueDom ?? dom;
  const saleMarkers: SaleMarker[] = (saleHistory?.events ?? [])
    .filter((e) => e.close_price && e.close_price > 0 && (e.contract_date || e.close_date))
    .map((e) => ({ date: (e.contract_date || e.close_date) as string, price: e.close_price as number }));
  const badges = detectPropertyBadges(property as Parameters<typeof detectPropertyBadges>[0]);
  const hasMortgageHelper =
    property.hasSecondarySuitePotential ||
    property.SuiteStatus === "EXISTING_SUITE" ||
    property.SuiteStatus === "POTENTIAL_CANDIDATE";

  // "Schools near this home" — searched school pinned first (always shown), then the
  // nearest others. Scores are 0–10 from EQAO open data (see schoolLens / build-schools).
  const scoreColor = (s: number | null) =>
    s === null ? "text-slate-400 bg-slate-700/40"
      : s >= 8 ? "text-emerald-400 bg-emerald-400/10"
      : s >= 6 ? "text-amber-400 bg-amber-400/10"
      : "text-slate-400 bg-slate-700/40";

  const targetRow = targetSchool ? nearbySchools.find((s) => s.id === targetSchool.id) : undefined;
  const otherRows = nearbySchools.filter((s) => s.id !== targetRow?.id).slice(0, targetRow ? 7 : 8);
  const shownIds = new Set([targetRow?.id, ...otherRows.map((s) => s.id)].filter(Boolean));
  const moreCount = Math.max(0, nearbyTotal - shownIds.size);

  const renderSchoolRow = (s: NearbySchool, isTarget: boolean) => (
    <div
      key={s.id}
      className={cn(
        "rounded-lg border p-3",
        isTarget ? "border-emerald-500/60 bg-emerald-500/5" : "border-slate-800 bg-slate-900/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-slate-200 leading-tight">{s.name}</p>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold", scoreColor(s.score))}>
          {s.score === null ? '—' : s.score.toFixed(1)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
        {isTarget && (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            Searched
          </span>
        )}
        <span className="capitalize">{s.system} {s.level}</span>
        <span>·</span>
        <span>{s.distanceKm.toFixed(1)} km away</span>
      </div>
    </div>
  );

  // Real photos from the Vault; fall back to the index thumbnail while loading.
  const galleryImages =
    media.length > 0
      ? media
      : ([property.primaryImageUrl, property.thumbnailUrl].filter(Boolean) as string[]);

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Terminal Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[1400px] flex-col bg-slate-950 border-l border-slate-800 shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header — brand + shared section nav (so you can leave the listing for
            another section without closing first) + close. */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-4">
          <div className="flex items-center gap-3">
            <Link href="/" aria-label="PureProperty.ca home" className="flex shrink-0 items-center">
              <Logo size="md" theme="dark" />
            </Link>
            <PrimaryNav variant="compact" className="hidden sm:flex" />
          </div>
          <button
            onClick={onClose}
            aria-label="Close listing"
            className="rounded-full border border-slate-700 bg-slate-800 p-2 transition-colors hover:bg-slate-700"
          >
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>

        {/* 70/30 Split Layout */}
        <div className="flex w-full min-h-0 flex-1">
          {/* LEFT PANEL - Asset Details (70%, Scrollable) */}
          <div className="w-[70%] h-full overflow-y-auto no-scrollbar p-6">
            {/* Header Section */}
            <div className="mb-6">
              {/* Badges */}
              <div className="flex flex-wrap gap-2 mb-3">
                {badges.map((badge, index) => (
                  <AlphaBadge 
                    key={index}
                    variant={badge.variant}
                    label={badge.label}
                    value={badge.value}
                  />
                ))}
              </div>

              {/* Address & Price */}
              <h1 className="text-2xl font-bold text-slate-100 mb-2">
                {property.UnparsedAddress || 'Address Unavailable'}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="text-3xl font-bold font-mono text-emerald-400">
                  {formatPrice(property.ListPrice)}
                </span>
                <span className="text-sm text-slate-500">
                  {property.City}, {property.PropertySubType || property.PropertyType}
                </span>
                {dealScore && (
                  <DealScoreBadge score={dealScore.score} grade={dealScore.grade} />
                )}
              </div>
            </div>

            {/* Social proof — honest, deterministic activity counters */}
            <SocialProofBar listingId={property.id} className="mb-6" />

            {/* Media Bento Grid (real photos from the Vault) */}
            <div className="mb-6">
              <ImageBentoGrid
                images={galleryImages}
                onClick={() => galleryImages.length > 0 && setIsGalleryOpen(true)}
                className="h-[400px]"
              />
            </div>

            {/* Property Specs Grid */}
            <div className="grid grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-3 text-center">
                <Bed className="h-5 w-5 text-emerald-400 mx-auto mb-1" />
                <span className="text-lg font-bold font-mono text-slate-200">{bedsLabel(property) ?? (property.BedroomsTotal || 0)}</span>
                <span className="text-[10px] text-slate-500 block uppercase">Beds</span>
              </div>
              <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-3 text-center">
                <Bath className="h-5 w-5 text-cyan-400 mx-auto mb-1" />
                <span className="text-lg font-bold font-mono text-slate-200">{property.BathroomsTotalInteger || 0}</span>
                <span className="text-[10px] text-slate-500 block uppercase">Baths</span>
              </div>
              <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-3 text-center">
                <Square className="h-5 w-5 text-purple-400 mx-auto mb-1" />
                <span className="text-lg font-bold font-mono text-slate-200">
                  {property.BuildingAreaTotal?.toLocaleString() || 'N/A'}
                </span>
                <span className="text-[10px] text-slate-500 block uppercase">Sqft</span>
              </div>
              <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-3 text-center">
                <Car className="h-5 w-5 text-amber-400 mx-auto mb-1" />
                <span className="text-lg font-bold font-mono text-slate-200">{property.ParkingTotal || 0}</span>
                <span className="text-[10px] text-slate-500 block uppercase">Parking</span>
              </div>
            </div>

            {/* Structural Vitals Table */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Home className="h-4 w-4 text-emerald-400" />
                Structural Vitals
              </h3>
              <table className="w-full text-sm border-collapse">
                <tbody className="divide-y divide-slate-800">
                  <tr>
                    <td className="py-2 text-slate-500 w-1/3">Lot Dimensions</td>
                    <td className="py-2 text-slate-200 font-mono">
                      {property.LotWidth ? `${property.LotWidth} x ${property.LotDepth || 'N/A'}` : 'N/A'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 text-slate-500">Property Age</td>
                    <td className="py-2 text-slate-200 font-mono">{property.ApproximateAge || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-slate-500">Heating</td>
                    <td className="py-2 text-slate-200">{property.Heating || 'N/A'}</td>
                  </tr>
                  <tr>
                    <td className="py-2 text-slate-500">Cooling</td>
                    <td className="py-2 text-slate-200">
                      {property.Cooling?.join(', ') || 'N/A'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Schools near this home */}
            {(targetRow || otherRows.length > 0) && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <GraduationCap className="h-4 w-4 text-emerald-400" />
                  Schools near this home
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {targetRow && renderSchoolRow(targetRow, true)}
                  {otherRows.map((s) => renderSchoolRow(s, false))}
                </div>
                {moreCount > 0 && (
                  <p className="mt-2 text-[11px] text-slate-500">+{moreCount} more within 2.5 km</p>
                )}
                <p className="mt-2 text-[10px] text-slate-600">
                  PureProperty School Score (0–10) from EQAO data — Government of Ontario, OGL-Ontario.
                  Distances are straight-line to the school; proximity is not a guaranteed catchment.
                </p>
              </div>
            )}

            {/* Room Dimensions — proportional, drawn-to-scale room map */}
            <RoomMap rooms={detailRooms} className="mb-6" />

            {/* Unvarnished Remarks */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Unvarnished Remarks
              </h3>
              <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-4">
                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
                  {property.PublicRemarks || 'No remarks available.'}
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT PANEL - Calculator & Ledger (30%, Sticky) */}
          <div className="w-[30%] h-full overflow-y-auto no-scrollbar bg-slate-900/30 border-l border-slate-800 p-4">
            <div className="space-y-4">
              {/* Deal Score — flagship signal, pinned to the top of the rail */}
              {dealScore ? (
                <DealScoreCard dealScore={dealScore} locked={!isAuthed && hasDealScore} />
              ) : (
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
              )}

              {/* PureProperty Estimate — our AVM, directly under the Deal Score */}
              <ListingEstimateCard
                estimate={estimate}
                listPrice={property.ListPrice}
                cityRegion={property.City}
                locked={!isAuthed && hasEstimate}
              />

              {/* §6.3(i)/(k) disclaimer for the AVM-derived estimate above (parity with the full report). */}
              {(estimate?.estimatedValue ?? 0) > 0 && <Disclaimers />}

              {/* Property Summary Card */}
              <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4">
                <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wider mb-3">
                  Asset Summary
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">List Price</span>
                    <span className="font-mono text-emerald-400">{formatPrice(property.ListPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Annual Taxes</span>
                    <span className="font-mono text-slate-300">
                      {property.TaxAnnualAmount ? formatPrice(property.TaxAnnualAmount) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Monthly Fees</span>
                    <span className="font-mono text-slate-300">
                      {property.AssociationFee ? formatPrice(property.AssociationFee) : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">True DOM</span>
                    <span className={cn(
                      "font-mono",
                      dom > 45 ? "text-emerald-400" : dom >= 14 ? "text-amber-400" : "text-slate-400"
                    )}>
                      {dom} days
                    </span>
                  </div>
                </div>
              </div>

              {/* Underwriting Sandbox */}
              <UnderwritingSandbox
                listingId={property.id}
                listPrice={property.ListPrice}
                annualTaxes={property.TaxAnnualAmount || 0}
                monthlyFees={property.AssociationFee || 0}
                hasSuitePotential={hasMortgageHelper}
              />

              {/* DOM Timeline Chart */}
              <DOMTimelineChart
                currentPrice={property.ListPrice}
                originalPrice={priceTimeline?.originalPrice ?? property.OriginalListPrice}
                priceDrop={priceTimeline?.totalPriceDrop ?? property.TotalPriceDrop}
                dom={trueDom}
                saleMarkers={saleMarkers}
              />

              {/* Sale History — prior sold campaigns (VOW-gated; blurred for anonymous) */}
              {saleHistory && (saleHistory.available || saleHistory.saleCount > 0) && (
                <SaleHistorySection saleHistory={saleHistory} isAuthed={isAuthed} />
              )}

              {/* Actions */}
              <div className="space-y-2 pt-4">
                <Link
                  href={`/properties/${property.id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Full Report
                </Link>
                <button
                  type="button"
                  onClick={() => toggleSelected(property.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                    isSelected
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  )}
                >
                  {isSelected ? <Check className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
                  {isSelected ? 'Added to Comparison' : 'Add to Comparison'}
                </button>
                {/* The viewing-request lead form lives on the full listing page (ScheduleViewingForm). */}
                <Link
                  href={`/properties/${property.id}`}
                  className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                >
                  <CalendarCheck className="h-4 w-4" />
                  Schedule Viewing
                </Link>
                <button
                  type="button"
                  onClick={() =>
                    void toggleWatch({
                      listing_key: property.id,
                      address: property.UnparsedAddress,
                      city: property.City,
                      list_price: property.ListPrice,
                      thumb: property.primaryImageUrl,
                    })
                  }
                  aria-pressed={watched}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                    watched
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25'
                      : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                  )}
                >
                  {watched ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                  {watched ? 'On your Watchlist' : 'Add to Watchlist'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full-screen photo gallery */}
      <MediaGalleryOverlay
        images={galleryImages}
        isOpen={isGalleryOpen}
        onClose={() => setIsGalleryOpen(false)}
      />
    </>
  );
}