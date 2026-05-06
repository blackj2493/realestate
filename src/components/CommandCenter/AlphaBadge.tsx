/**
 * AlphaBadge - Military-style HUD badges for property flags
 * These badges are rendered in the ledger panel to indicate property status
 */

import { cn } from '@/lib/utils';

// Badge variants based on the design spec
export type BadgeVariant = 
  | 'income-suite'      // text-emerald-400 bg-emerald-400/10 border-emerald-400/20
  | 'suite-potential'   // text-blue-400 bg-blue-400/10 border-blue-400/20
  | 'distressed'        // text-rose-400 bg-rose-400/10 border-rose-400/20
  | 'holding-offers'    // text-amber-400 bg-amber-400/10 border-amber-400/20
  | 'price-drop'        // text-emerald-400 bg-emerald-400/10 border-emerald-400/20
  | 'top-school-zone'   // text-purple-400 bg-purple-400/10 border-purple-400/20
  | 'new-listing'       // text-cyan-400 bg-cyan-400/10 border-cyan-400/20
  | 'motivated-seller'; // text-orange-400 bg-orange-400/10 border-orange-400/20

interface AlphaBadgeProps {
  variant: BadgeVariant;
  label: string;
  value?: string | number; // Optional value to show after label (e.g., "-8%")
  className?: string;
}

// Badge styling configurations
const badgeStyles: Record<BadgeVariant, { 
  text: string; 
  bg: string; 
  border: string; 
}> = {
  'income-suite': {
    text: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
  },
  'suite-potential': {
    text: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/20',
  },
  'distressed': {
    text: 'text-rose-400',
    bg: 'bg-rose-400/10',
    border: 'border-rose-400/20',
  },
  'holding-offers': {
    text: 'text-amber-400',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/20',
  },
  'price-drop': {
    text: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/20',
  },
  'top-school-zone': {
    text: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/20',
  },
  'new-listing': {
    text: 'text-cyan-400',
    bg: 'bg-cyan-400/10',
    border: 'border-cyan-400/20',
  },
  'motivated-seller': {
    text: 'text-orange-400',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/20',
  },
};

export function AlphaBadge({ variant, label, value, className }: AlphaBadgeProps) {
  const styles = badgeStyles[variant];
  
  return (
    <span
      className={cn(
        // Base styles
        'inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider rounded-full px-2 py-0.5 border',
        // Variant styles
        styles.text,
        styles.bg,
        styles.border,
        className
      )}
    >
      {label}
      {value !== undefined && (
        <span className="font-mono">{value}</span>
      )}
    </span>
  );
}

// Helper to detect badges from property data
export interface PropertyBadge {
  variant: BadgeVariant;
  label: string;
  value?: string | number;
}

export function detectPropertyBadges(property: {
  isDistressed?: boolean;
  hasSecondarySuitePotential?: boolean;
  KitchensBelowGrade?: number;
  PublicRemarks?: string;
  ListPrice?: number;
  OriginalListPrice?: number;
  calculatedDOM?: number;
  DaysOnMarket?: number;
  SchoolZone?: boolean;
}): PropertyBadge[] {
  const badges: PropertyBadge[] = [];

  // Income Suite badge - has secondary suite or basement kitchen
  if (property.hasSecondarySuitePotential || (property.KitchensBelowGrade && property.KitchensBelowGrade > 0)) {
    badges.push({ variant: 'income-suite', label: 'INCOME SUITE' });
  }

  // Suite Potential badge - has unfinished basement potential
  if (property.PublicRemarks?.toLowerCase().includes('basement') && 
      property.PublicRemarks?.toLowerCase().includes('potential')) {
    badges.push({ variant: 'suite-potential', label: 'SUITE POTENTIAL' });
  }

  // Distressed badge
  if (property.isDistressed) {
    badges.push({ variant: 'distressed', label: 'DISTRESSED' });
  }

  // Holding Offers badge - check remarks for bidding war indicators
  const remarks = property.PublicRemarks?.toLowerCase() || '';
  if (remarks.includes('offers reviewed') || remarks.includes('holding offers') || remarks.includes('presentation date')) {
    badges.push({ variant: 'holding-offers', label: 'HOLDING OFFERS' });
  }

  // Price Drop badge
  if (property.OriginalListPrice && property.ListPrice && property.OriginalListPrice > property.ListPrice) {
    const dropPercent = Math.round(((property.OriginalListPrice - property.ListPrice) / property.OriginalListPrice) * 100);
    badges.push({ variant: 'price-drop', label: `-${dropPercent}% PRICE DROP` });
  }

  // Top School Zone badge
  if (property.SchoolZone) {
    badges.push({ variant: 'top-school-zone', label: 'TOP SCHOOL ZONE' });
  }

  // New listing badge (fresh on market < 7 days)
  const dom = property.calculatedDOM || property.DaysOnMarket || 0;
  if (dom <= 7) {
    badges.push({ variant: 'new-listing', label: 'NEW' });
  }

  // Motivated Seller badge - check for keywords in remarks
  const motivatedKeywords = ['motivated', 'need to sell', 'moving', 'relocating', 'quick sale', 'price to sell'];
  if (motivatedKeywords.some(keyword => remarks.includes(keyword))) {
    badges.push({ variant: 'motivated-seller', label: 'MOTIVATED' });
  }

  return badges;
}

export default AlphaBadge;