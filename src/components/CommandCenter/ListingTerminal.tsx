/**
 * ListingTerminal - 70/30 Split Terminal for property detail
 * Left panel: Asset details (scrollable)
 * Right panel: Calculator & Ledger (sticky)
 */

"use client";

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { 
  X, 
  Bed, 
  Bath, 
  Car, 
  Square, 
  Calendar, 
  MapPin,
  ChevronRight,
  Home,
  Ruler,
  Wind,
  Snowflake,
  AlertTriangle
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { AlphaBadge, detectPropertyBadges } from './AlphaBadge';
import CarryCostCalculator from './CarryCostCalculator';
import DOMTimelineChart from './DOMTimelineChart';
import { useCommandCenterStore } from '@/lib/stores/commandCenterStore';
import type { ListingDocument } from '@/lib/typesense/client';

interface ListingTerminalProps {
  property: ListingDocument;
  isOpen: boolean;
  onClose: () => void;
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
  const { smartFilters } = useCommandCenterStore();

  // Fetch full property details when terminal opens
  useEffect(() => {
    if (isOpen && property) {
      setPropertyDetails(property);
    }
  }, [isOpen, property]);

  if (!isOpen) return null;

  const dom = property.calculatedDOM || property.DaysOnMarket || 0;
  const badges = detectPropertyBadges(property as Parameters<typeof detectPropertyBadges>[0]);
  const hasMortgageHelper = smartFilters.mortgageHelperEnabled || property.hasSecondarySuitePotential;

  // Mock room data for demo
  const rooms = [
    { type: 'Living', level: 'Main', dimensions: '20 x 15' },
    { type: 'Kitchen', level: 'Main', dimensions: '12 x 10' },
    { type: 'Primary Bedroom', level: 'Upper', dimensions: '15 x 12' },
    { type: 'Bedroom 2', level: 'Upper', dimensions: '12 x 10' },
    { type: 'Bedroom 3', level: 'Upper', dimensions: '11 x 10' },
    { type: 'Laundry', level: 'Basement', dimensions: '10 x 8' },
  ];

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
              <div className="flex items-baseline gap-4">
                <span className="text-3xl font-bold font-mono text-emerald-400">
                  {formatPrice(property.ListPrice)}
                </span>
                <span className="text-sm text-slate-500">
                  {property.City}, {property.PropertySubType || property.PropertyType}
                </span>
              </div>
            </div>

            {/* Media Bento Grid */}
            <div className="mb-6">
              <div className="grid grid-cols-4 grid-rows-2 gap-2 rounded-lg overflow-hidden h-[400px]">
                {/* Hero Image - spans 2 columns and 2 rows */}
                <div className="col-span-2 row-span-2 relative bg-slate-800">
                  {property.primaryImageUrl || property.thumbnailUrl ? (
                    <Image
                      src={property.primaryImageUrl || property.thumbnailUrl || ''}
                      alt="Property main view"
                      fill
                      className="object-cover"
                      unoptimized={true}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-600">
                      No Image
                    </div>
                  )}
                </div>
                
                {/* Thumbnail 2 */}
                <div className="col-span-1 row-span-1 relative bg-slate-800">
                  {property.primaryImageUrl && (
                    <Image
                      src={property.primaryImageUrl}
                      alt="Property view 2"
                      fill
                      className="object-cover opacity-70"
                      unoptimized={true}
                    />
                  )}
                </div>
                
                {/* Thumbnail 3 */}
                <div className="col-span-1 row-span-1 relative bg-slate-800">
                  {property.primaryImageUrl && (
                    <Image
                      src={property.primaryImageUrl}
                      alt="Property view 3"
                      fill
                      className="object-cover opacity-70"
                      unoptimized={true}
                    />
                  )}
                </div>
                
                {/* Thumbnail 4 */}
                <div className="col-span-1 row-span-1 relative bg-slate-800">
                  {property.primaryImageUrl && (
                    <Image
                      src={property.primaryImageUrl}
                      alt="Property view 4"
                      fill
                      className="object-cover opacity-70"
                      unoptimized={true}
                    />
                  )}
                </div>
                
                {/* Thumbnail 5 */}
                <div className="col-span-1 row-span-1 relative bg-slate-800">
                  {property.primaryImageUrl && (
                    <Image
                      src={property.primaryImageUrl}
                      alt="Property view 5"
                      fill
                      className="object-cover opacity-70"
                      unoptimized={true}
                    />
                  )}
                </div>
              </div>
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
                  {rooms.map((room, index) => (
                    <tr key={index} className="hover:bg-slate-900/30">
                      <td className="py-2 text-slate-200">{room.type}</td>
                      <td className="py-2 text-slate-400">{room.level}</td>
                      <td className="py-2 text-slate-300 font-mono text-right">{room.dimensions}</td>
                    </tr>
                  ))}
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
                <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
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
    </>
  );
}