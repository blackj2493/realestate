'use client';

import React, { useState, useMemo } from 'react';
import { Slider } from '@/components/ui/slider';

/**
 * Shadow MLS - Holding Burn Card
 * 
 * Property panel component displaying max holding cost with override sliders:
 * - Interest Rate: 5-14% (default 7.99%)
 * - Timeline: 1-12 months (default 6)
 * - Secondary output: total_project_capital_risk = monthly * timeline
 */

interface HoldingBurnCardProps {
  maxHoldingCost?: number;
  listPrice?: number;
  className?: string;
}

const DEFAULT_INTEREST_RATE = 0.0799; // 7.99%
const DEFAULT_TIMELINE_MONTHS = 6;

export function HoldingBurnCard({ 
  maxHoldingCost = 0, 
  listPrice = 0,
  className = '' 
}: HoldingBurnCardProps) {
  const [interestRate, setInterestRate] = useState(DEFAULT_INTEREST_RATE);
  const [timelineMonths, setTimelineMonths] = useState(DEFAULT_TIMELINE_MONTHS);

  // Calculate override monthly based on list price
  const overrideMonthly = useMemo(() => {
    if (!listPrice) return maxHoldingCost;
    
    // Same formula as HoldingCostCalculator
    // Interest: (targetPrice * 0.75 * rate) / 12
    const interest = (listPrice * 0.75 * interestRate) / 12;
    // Taxes: 1% estimate / 12
    const taxes = (listPrice * 0.01) / 12;
    // Other fixed costs
    const vacancyInsurance = 250;
    const utilities = 350;
    const maintenance = (listPrice * 0.005) / 12;
    
    return Math.round(interest + taxes + vacancyInsurance + utilities + maintenance);
  }, [listPrice, interestRate, maxHoldingCost]);

  // Total project capital at risk
  const totalProjectCapitalRisk = useMemo(() => {
    return overrideMonthly * timelineMonths;
  }, [overrideMonthly, timelineMonths]);

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  return (
    <div className={`
      bg-background border border-border rounded-lg p-4
      ${className}
    `}>
      {/* Header */}
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
        Projected Holding Cost
      </div>

      {/* Primary: Max Holding Cost */}
      <div className="mb-4">
        <div className="text-xs font-mono text-muted-foreground mb-1">Monthly Burn</div>
        <div className="text-3xl font-mono text-amber-700 dark:text-amber-400 uppercase tracking-tight">
          {formatCurrency(maxHoldingCost)}
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1">per month</div>
      </div>

      {/* Override Section */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
          Override Parameters
        </div>

        {/* Interest Rate Slider */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-mono text-muted-foreground">Interest Rate</span>
            <span className="text-xs font-mono text-amber-700 dark:text-amber-400">
              {(interestRate * 100).toFixed(2)}%
            </span>
          </div>
          <Slider
            value={[interestRate * 100]}
            min={5}
            max={14}
            step={0.25}
            onValueChange={([v]) => setInterestRate(v / 100)}
          />
        </div>

        {/* Timeline Slider */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-mono text-muted-foreground">Timeline</span>
            <span className="text-xs font-mono text-amber-700 dark:text-amber-400">
              {timelineMonths} mo
            </span>
          </div>
          <Slider
            value={[timelineMonths]}
            min={1}
            max={12}
            step={1}
            onValueChange={([v]) => setTimelineMonths(v)}
          />
        </div>
      </div>

      {/* Secondary Output */}
      <div className="border-t border-border pt-3 mt-3">
        <div className="text-xs font-mono text-muted-foreground mb-1">Total Project Capital Risk</div>
        <div className="text-xl font-mono text-rose-700 dark:text-rose-400">
          {formatCurrency(totalProjectCapitalRisk)}
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-1">
          {overrideMonthly}/mo × {timelineMonths} months
        </div>
      </div>
    </div>
  );
}

export default HoldingBurnCard;