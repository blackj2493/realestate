/**
 * LedgerRow - High-density property row for the Command Center Ledger
 * Displays scannable property summary with Alpha badges
 */

"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { 
  Bed, 
  Bath, 
  Square, 
  Heart,
  ChevronRight,
  MapPin
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { AlphaBadge, detectPropertyBadges } from './AlphaBadge';
import type { ListingDocument } from '@/lib/typesense/client';

interface LedgerRowProps {
  property: ListingDocument;
  onClick: () => void;
  isSelected?: boolean;
}

// Fallback image placeholder
const PLACEHOLDER_IMAGE = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=200&h=150&fit=crop";

export default function LedgerRow({ property, onClick, isSelected }: LedgerRowProps) {
  const [isSaved, setIsSaved] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Calculate estimated carry cost (simplified monthly burn)
  // In a real implementation, this would use actual mortgage calculations
  const estimatedCarryCost = calculateCarryCost(property);
  
  // Get DOM with color logic
  const dom = property.calculatedDOM || property.DaysOnMarket || 0;
  const domColor = dom > 45 ? 'text-emerald-400' : dom >= 14 ? 'text-amber-400' : 'text-slate-400';
  
  // Detect badges for this property
  const badges = detectPropertyBadges(property as Parameters<typeof detectPropertyBadges>[0]);

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative flex items-center gap-3 px-3 py-2 border-b border-slate-800/50 cursor-pointer transition-all hover:bg-slate-800/50",
        isSelected && "bg-emerald-900/20 border-l-2 border-l-emerald-500"
      )}
    >
      {/* Thumbnail */}
      <div className="relative w-16 h-12 rounded overflow-hidden shrink-0 bg-slate-800">
        <Image
          src={imageError ? PLACEHOLDER_IMAGE : (property.thumbnailUrl || property.primaryImageUrl || PLACEHOLDER_IMAGE)}
          alt={property.UnparsedAddress || 'Property'}
          fill
          className="object-cover"
          unoptimized={true}
          onError={() => setImageError(true)}
        />
        
        {/* Save Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsSaved(!isSaved);
          }}
          className="absolute top-0.5 right-0.5 p-1 rounded-full bg-slate-900/70 hover:bg-slate-900 z-10 transition-colors"
        >
          <Heart className={cn(
            "h-3 w-3",
            isSaved ? "fill-red-500 text-red-500" : "text-slate-400"
          )} />
        </button>
      </div>

      {/* Property Basics */}
      <div className="flex-1 min-w-0">
        {/* Address */}
        <p className="text-xs text-slate-200 font-medium truncate pr-2">
          {property.UnparsedAddress || 'Address Unavailable'}
        </p>
        
        {/* City + Property Type */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">
            {property.City || 'Unknown'}
          </span>
          <span className="text-[10px] text-slate-600">·</span>
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">
            {property.PropertySubType || property.PropertyType || 'Residential'}
          </span>
        </div>
      </div>

      {/* Property Specs */}
      <div className="hidden md:flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Bed className="h-3 w-3" />
          <span className="font-mono">{property.BedroomsTotal || 0}</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          <Bath className="h-3 w-3" />
          <span className="font-mono">{property.BathroomsTotalInteger || 0}</span>
        </div>
        {property.BuildingAreaTotal && (
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <Square className="h-3 w-3" />
            <span className="font-mono">{property.BuildingAreaTotal.toLocaleString()}</span>
          </div>
        )}
      </div>

      {/* Primary Metric: Carry Cost */}
      <div className="hidden lg:block w-20 text-right shrink-0">
        <span className="text-xs font-bold font-mono text-emerald-400">
          ${estimatedCarryCost.toLocaleString()}
        </span>
        <span className="text-[10px] text-slate-500 block">/mo</span>
      </div>

      {/* Secondary Metric: True DOM */}
      <div className="hidden sm:block w-14 text-right shrink-0">
        <span className={cn("text-xs font-mono font-semibold", domColor)}>
          {dom}d
        </span>
      </div>

      {/* Alpha Badges */}
      <div className="hidden xl:flex items-center gap-1 shrink-0 max-w-[180px]">
        {badges.slice(0, 2).map((badge, index) => (
          <AlphaBadge 
            key={index}
            variant={badge.variant}
            label={badge.label}
            value={badge.value}
          />
        ))}
        {badges.length > 2 && (
          <span className="text-[10px] text-slate-500">+{badges.length - 2}</span>
        )}
      </div>

      {/* Price */}
      <div className="w-28 text-right shrink-0">
        <span className="text-sm font-bold font-mono text-emerald-400">
          {formatPrice(property.ListPrice)}
        </span>
      </div>

      {/* Arrow */}
      <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
    </div>
  );
}

/**
 * Calculate estimated monthly carry cost
 * This is a simplified calculation - real implementation would use actual mortgage formulas
 */
function calculateCarryCost(property: ListingDocument): number {
  const listPrice = property.ListPrice || 0;
  const annualTaxes = property.TaxAnnualAmount || 0;
  const monthlyFees = property.AssociationFee || 0;

  // Simplified estimation assuming 20% down, 7% rate, 30yr amort
  // Monthly mortgage payment ≈ P * [r(1+r)^n] / [(1+r)^n - 1] / 12
  const principal = listPrice * 0.8; // 80% LTV
  const annualRate = 0.07;
  const monthlyRate = annualRate / 12;
  const numPayments = 30 * 12; // 30 years

  const monthlyMortgage = principal * 
    (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / 
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  // Monthly property taxes
  const monthlyTax = annualTaxes / 12;

  // Total monthly carry cost
  return Math.round(monthlyMortgage + monthlyTax + monthlyFees);
}