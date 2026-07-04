'use client';

import React from 'react';

export type DealType = 'STANDARD' | 'LEGAL_DISTRESS' | 'FIXER_UPPER' | 'ASSIGNMENT_SALE' | 'MOTIVATED_SELLER';

interface DealTypeBadgeProps {
  dealTypeFlag: DealType | string;
  className?: string;
}

/**
 * Shadow MLS - Deal Type Badge
 * 
 * Displays a styled badge for flipper deal classification.
 */
export function DealTypeBadge({ dealTypeFlag, className = '' }: DealTypeBadgeProps) {
  switch (dealTypeFlag) {
    case 'LEGAL_DISTRESS':
      return (
        <div className={`
          animate-pulse bg-rose-500/10 border border-rose-500/30 
          text-rose-600 dark:text-rose-400 font-mono text-xs px-2 py-0.5 rounded
          ${className}
        `}>
          ⚠️ POWER OF SALE / BANK FORECLOSURE
        </div>
      );
    
    case 'FIXER_UPPER':
      return (
        <div className={`
          bg-amber-500/10 border border-amber-500/30 
          text-amber-600 dark:text-amber-400 font-mono text-xs px-2 py-0.5 rounded
          ${className}
        `}>
          🔨 AS-IS / CONTRACTOR SPECIAL
        </div>
      );
    
    case 'ASSIGNMENT_SALE':
      return (
        <div className={`
          bg-amber-500/10 border border-amber-500/30 
          text-amber-600 dark:text-amber-400 font-mono text-xs px-2 py-0.5 rounded
          ${className}
        `}>
          📋 ASSIGNMENT SALE
        </div>
      );
    
    case 'MOTIVATED_SELLER':
      return (
        <div className={`
          bg-blue-500/10 border border-blue-500/30 
          text-blue-600 dark:text-blue-400 font-mono text-xs px-2 py-0.5 rounded
          ${className}
        `}>
          💸 MOTIVATED SELLER
        </div>
      );
    
    case 'STANDARD':
    default:
      return null; // Don't render badge for standard deals
  }
}

export default DealTypeBadge;