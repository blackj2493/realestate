/**
 * CarryCostCalculator - Interactive mortgage calculator for the terminal
 * Calculates total monthly carry cost based on user inputs
 */

"use client";

import React, { useState, useMemo } from 'react';
import { 
  DollarSign,
  Percent,
  Calculator,
  TrendingDown,
  Home
} from 'lucide-react';
import { cn, formatPrice } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CarryCostCalculatorProps {
  listPrice: number;
  annualTaxes: number;
  monthlyFees: number;
  hasSuitePotential?: boolean;
  className?: string;
}

// Default values
const DEFAULT_DOWNPAYMENT = 20;
const DEFAULT_INTEREST_RATE = 7.0;
const DEFAULT_AMORTIZATION = 30;

export default function CarryCostCalculator({
  listPrice,
  annualTaxes,
  monthlyFees,
  hasSuitePotential = false,
  className
}: CarryCostCalculatorProps) {
  // Mortgage inputs
  const [downpaymentPercent, setDownpaymentPercent] = useState(DEFAULT_DOWNPAYMENT);
  const [interestRate, setInterestRate] = useState(DEFAULT_INTEREST_RATE);
  const [amortization, setAmortization] = useState(DEFAULT_AMORTIZATION);
  
  // Suite offset (for Mortgage Helper)
  const [basementRent, setBasementRent] = useState(1500);

  // Calculate mortgage payment
  const { monthlyMortgage, monthlyTax, totalCarry, netCarry } = useMemo(() => {
    const principal = listPrice * (1 - downpaymentPercent / 100);
    const monthlyRate = interestRate / 100 / 12;
    const numPayments = amortization * 12;

    // Monthly mortgage payment using amortization formula
    const monthlyPayment = monthlyRate === 0 
      ? principal / numPayments 
      : principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);

    // Monthly property taxes
    const monthlyTaxAmount = annualTaxes / 12;

    // Total monthly carry cost
    const total = Math.round(monthlyPayment + monthlyTaxAmount + monthlyFees);

    // Net carry cost (after suite income)
    const net = hasSuitePotential ? total - basementRent : total;

    return {
      monthlyMortgage: Math.round(monthlyPayment),
      monthlyTax: Math.round(monthlyTaxAmount),
      totalCarry: total,
      netCarry: net,
    };
  }, [listPrice, downpaymentPercent, interestRate, amortization, annualTaxes, monthlyFees, basementRent, hasSuitePotential]);

  return (
    <div className={cn("bg-slate-900/50 rounded-lg border border-slate-800 p-4", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Calculator className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Carry Cost Calculator
        </span>
      </div>

      {/* Auto-populated values */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-800/50 rounded p-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">List Price</span>
          <p className="text-sm font-bold font-mono text-emerald-400">{formatPrice(listPrice)}</p>
        </div>
        <div className="bg-slate-800/50 rounded p-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">Annual Taxes</span>
          <p className="text-sm font-bold font-mono text-slate-300">{formatPrice(annualTaxes)}</p>
        </div>
        {monthlyFees > 0 && (
          <div className="bg-slate-800/50 rounded p-2 col-span-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">Monthly Fees</span>
            <p className="text-sm font-bold font-mono text-slate-300">{formatPrice(monthlyFees)}</p>
          </div>
        )}
      </div>

      {/* Downpayment Slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-slate-400 flex items-center gap-1">
            <Home className="h-3 w-3" />
            Downpayment
          </Label>
          <span className="text-xs font-mono text-emerald-400">{downpaymentPercent}%</span>
        </div>
        <Slider
          value={[downpaymentPercent]}
          onValueChange={([val]) => setDownpaymentPercent(val)}
          min={5}
          max={50}
          step={1}
          className="w-full"
        />
      </div>

      {/* Interest Rate Slider */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-slate-400 flex items-center gap-1">
            <Percent className="h-3 w-3" />
            Interest Rate
          </Label>
          <span className="text-xs font-mono text-emerald-400">{interestRate.toFixed(2)}%</span>
        </div>
        <Slider
          value={[interestRate]}
          onValueChange={([val]) => setInterestRate(val)}
          min={3}
          max={12}
          step={0.125}
          className="w-full"
        />
      </div>

      {/* Amortization Dropdown */}
      <div className="mb-4">
        <Label className="text-xs text-slate-400 mb-1 block">Amortization</Label>
        <select
          value={amortization}
          onChange={(e) => setAmortization(Number(e.target.value))}
          className="w-full h-8 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 px-2"
        >
          <option value={15}>15 years</option>
          <option value={20}>20 years</option>
          <option value={25}>25 years</option>
          <option value={30}>30 years</option>
        </select>
      </div>

      {/* Monthly Breakdown */}
      <div className="border-t border-slate-800 pt-3 mt-3">
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-slate-500">Mortgage</span>
            <span className="font-mono text-slate-300">{formatPrice(monthlyMortgage)}/mo</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Property Tax</span>
            <span className="font-mono text-slate-300">{formatPrice(monthlyTax)}/mo</span>
          </div>
        </div>
      </div>

      {/* Total Monthly Carry */}
      <div className="mt-4 bg-emerald-900/20 border border-emerald-800/50 rounded-lg p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-emerald-400 uppercase tracking-wider">Total Monthly</span>
          <span className="text-xl font-bold font-mono text-emerald-400">
            {formatPrice(totalCarry)}
          </span>
        </div>
        <span className="text-[10px] text-slate-500">/mo</span>
      </div>

      {/* Suite Offset (if Mortgage Helper enabled) */}
      {hasSuitePotential && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-3 w-3 text-blue-400" />
            <span className="text-xs text-blue-400 uppercase tracking-wider">Suite Offset</span>
          </div>
          
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs text-slate-400">Est. Basement Rent</Label>
              <span className="text-xs font-mono text-blue-400">-{formatPrice(basementRent)}</span>
            </div>
            <Slider
              value={[basementRent]}
              onValueChange={([val]) => setBasementRent(val)}
              min={500}
              max={4000}
              step={50}
              className="w-full"
            />
          </div>

          {/* Net Monthly Burn */}
          <div className="bg-blue-900/20 border border-blue-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-blue-400 uppercase tracking-wider">Net Carry</span>
              <span className="text-xl font-bold font-mono text-blue-400">
                {formatPrice(netCarry)}
              </span>
            </div>
            <span className="text-[10px] text-slate-500">/mo after suite income</span>
          </div>
        </div>
      )}
    </div>
  );
}