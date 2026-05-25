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
  Ruler,
  AlertTriangle,
  GraduationCap,
  ExternalLink,
  GitCompareArrows,
  Check
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AlphaBadge, detectPropertyBadges } from './AlphaBadge';
import CarryCostCalculator from './CarryCostCalculator';
import DOMTimelineChart from './DOMTimelineChart';
import ImageBentoGrid from '@/components/Property/ImageBentoGrid';
import MediaGalleryOverlay from '@/components/Property/MediaGalleryOverlay';
import DealScoreCard, { DealScoreBadge } from '@/components/Property/DealScoreCard';
import SocialProofBar from '@/components/Property/SocialProofBar';
import type { DealScoreResult } from '@/lib/dealScore/computeDealScore';
import type { ListingDocument } from '@/lib/typesense/client';
import { useCommandCenterStore } from '@/lib/stores/commandCenterStore';

interface TerminalRoom {
  RoomType?: string;
  RoomLevel?: string;
  RoomDimensions?: string | null;
  RoomLength?: number;
  RoomWidth?: number;
}

function terminalRoomDims(r: TerminalRoom): string {
  if (r.RoomDimensions) return r.RoomDimensions;
  if (r.RoomLength && r.RoomWidth) return `${r.RoomLength} x ${r.RoomWidth}`;
  return '—';
}

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

// Highlight NLP flags in text (motivated, as-is, TLC, handyman special, etc.)
function highlightNLPFlags(text: string): React.ReactNode {
  if (!text) return null;
  
  const flags = [
    { pattern: /\b(motivated|need to sell|moving|relocating)\b/gi, className: 'text-rose-400 bg-rose-400/10' },
    { pattern: /\b(TLC|as-is|handyman special)\b/gi, className: 'text-amber-400 bg-amber-400/10' },
    { pattern: /\b(income suite|basement|nicolite potential)\b/gi, className: 'text-emerald-400 bg-emerald-400/10' },
  ];
  
  // Split text by flag patterns
  const parts: { text: string; isFlag: boolean; flagClass?: string }[] = [];
  let remaining = text;
  
  flags.forEach(flag => {
    const regex = new RegExp(flag.pattern);
    remaining = remaining.replace(regex, (match) => {
      parts.push({ text: match, isFlag: true, flagClass: flag.className });
      return '';
    });
  });
  
  // For simplicity, just return the text with basic highlighting
  // In production, you'd want more sophisticated text processing
  return text;
}

export default function ListingTerminal({ property, isOpen, onClose }: ListingTerminalProps) {
  const [propertyDetails, setPropertyDetails] = useState<ListingDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // School lens target (the school the user searched for, if any) — used to pin and
  // highlight that school in the "Schools near this home" list.
  const targetSchool = useCommandCenterStore((s) => s.school.targetSchool);
  const [nearbySchools, setNearbySchools] = useState<NearbySchool[]>([]);
  const [nearbyTotal, setNearbyTotal] = useState(0);

  // Multi-select (comparison) + real media/rooms hydrated from the Vault on open.
  const toggleSelected = useCommandCenterStore((s) => s.toggleSelected);
  const isSelected = useCommandCenterStore((s) => s.selectedIds.has(property.id));
  const [media, setMedia] = useState<string[]>([]);
  const [detailRooms, setDetailRooms] = useState<TerminalRoom[]>([]);
  const [dealScore, setDealScore] = useState<DealScoreResult | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);

  // Fetch full property details when terminal opens
  useEffect(() => {
    if (isOpen && property) {
      setPropertyDetails(property);
    }
  }, [isOpen, property]);

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
    setIsGalleryOpen(false);
    (async () => {
      try {
        const res = await fetch(`/api/property/${property.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setMedia(Array.isArray(data?.media_urls) ? data.media_urls : []);
        const r = data?.full_payload?.rooms;
        setDetailRooms(Array.isArray(r) ? (r as TerminalRoom[]) : []);
        setDealScore(data?.dealScore ?? null);
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
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[1400px] bg-slate-950 border-l border-slate-800 shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 rounded-full bg-slate-800 border border-slate-700 hover:bg-slate-700 transition-colors"
        >
          <X className="h-5 w-5 text-slate-400" />
        </button>

        {/* 70/30 Split Layout */}
        <div className="flex w-full h-full">
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
                <span className="text-lg font-bold font-mono text-slate-200">{property.BedroomsTotal || 0}</span>
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

            {/* Room Ledger */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Ruler className="h-4 w-4 text-emerald-400" />
                Room Ledger
              </h3>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-800">
                    <th className="py-2 text-left">Room</th>
                    <th className="py-2 text-left">Level</th>
                    <th className="py-2 text-right">Dimensions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {detailRooms.length > 0 ? (
                    detailRooms.map((room, index) => (
                      <tr key={index} className="hover:bg-slate-900/30">
                        <td className="py-2 text-slate-200">{room.RoomType || '—'}</td>
                        <td className="py-2 text-slate-400">{room.RoomLevel || '—'}</td>
                        <td className="py-2 text-slate-300 font-mono text-right">{terminalRoomDims(room)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="py-3 text-center text-xs text-slate-500">
                        Room details unavailable for this listing.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

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
                <DealScoreCard dealScore={dealScore} />
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

              {/* Carry Cost Calculator */}
              <CarryCostCalculator
                listPrice={property.ListPrice}
                annualTaxes={property.TaxAnnualAmount || 0}
                monthlyFees={property.AssociationFee || 0}
                hasSuitePotential={hasMortgageHelper}
              />

              {/* DOM Timeline Chart */}
              <DOMTimelineChart
                currentPrice={property.ListPrice}
                originalPrice={property.OriginalListPrice}
                dom={dom}
              />

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
                <Button className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100">
                  Schedule Viewing
                </Button>
                <Button variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800">
                  Add to Watchlist
                </Button>
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