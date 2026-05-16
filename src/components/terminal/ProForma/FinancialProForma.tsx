'use client';

import { useState } from 'react';

interface ProFormaProps {
  property: {
    ListPrice: number;
    cap_rate_est: number;
    cap_rate_floor: number;
    gross_yield_est: number;
    net_monthly_cashflow: number;
    cashflow_floor: number;
    tax_burden_ratio: number;
    assessment_status: string;
    annual_revenue: number;
    annual_opex: number;
    vacancy_loss: number;
    mortgage_monthly: number;
    multi_unit_status: string;
    suite_confidence: string;
    price_discovery_flag: boolean;
  };
}

export function FinancialProForma({ property }: ProFormaProps) {
  const [mortgageRate, setMortgageRate] = useState(4.04);
  const [downPaymentPct, setDownPaymentPct] = useState(20);

  const isPositive = property.net_monthly_cashflow > 0;
  const isPrimeSuite = property.multi_unit_status === 'PRIME_CANDIDATE';

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-900 border border-slate-700 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-mono text-slate-300 uppercase tracking-wider">
          Pro Forma
        </h3>
        {property.price_discovery_flag && (
          <span className="px-2 py-0.5 text-xs font-mono text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded">
            PRICE DISCOVERY
          </span>
        )}
      </div>

      {/* Primary Cashflow */}
      <div className="p-3 bg-slate-950 rounded border border-slate-800">
        <div className="text-xs text-slate-400 font-mono mb-1">NET MONTHLY CASHFLOW</div>
        <div className={`text-2xl font-mono font-bold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
          {isPositive ? '+' : ''}${(property.net_monthly_cashflow || 0).toLocaleString('en-CA')}
          <span className="text-sm text-slate-400 font-normal">/mo</span>
        </div>
        <div className="text-xs text-slate-500 font-mono mt-1">
          FLOOR ${(property.cashflow_floor || 0).toLocaleString('en-CA')}/mo
        </div>
      </div>

      {/* Cap Rates */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-slate-950 rounded border border-slate-800">
          <div className="text-xs text-slate-400 font-mono mb-1">CAP RATE (EST)</div>
          <div className="text-xl font-mono text-slate-50">
            {(property.cap_rate_est || 0).toFixed(2)}%
          </div>
        </div>
        <div className="p-3 bg-slate-950 rounded border border-slate-800">
          <div className="text-xs text-slate-400 font-mono mb-1">CAP RATE (FLOOR)</div>
          <div className="text-xl font-mono text-amber-400">
            {(property.cap_rate_floor || 0).toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Interactive Sliders */}
      {isPrimeSuite && (
        <div className="p-3 bg-slate-950 rounded border border-emerald-400/20">
          <div className="text-xs text-emerald-400 font-mono mb-2 uppercase tracking-wider">
            + Suite Potential
          </div>
          <div className="text-sm font-mono text-slate-300">
            Target post-conversion yield shown
          </div>
        </div>
      )}

      {/* Assessment X-Ray */}
      {property.assessment_status !== 'MARKET_AVERAGE' && (
        <div className={`p-3 rounded border ${
          property.assessment_status === 'OVER_ASSESSED'
            ? 'bg-red-400/5 border-red-400/20'
            : 'bg-amber-400/5 border-amber-400/20'
        }`}>
          <div className="text-xs text-slate-400 font-mono mb-1">ASSESSMENT X-RAY</div>
          <div className={`text-sm font-mono ${
            property.assessment_status === 'OVER_ASSESSED' ? 'text-red-400' : 'text-amber-400'
          }`}>
            {property.assessment_status === 'OVER_ASSESSED' ? '⚠ OVER ASSESSED — Review MPAC' : '⚠ UNDER ASSESSED — Review carefully'}
          </div>
          <div className="text-xs text-slate-500 font-mono mt-1">
            Tax Burden: {property.tax_burden_ratio?.toFixed(3)}%
          </div>
        </div>
      )}

      {/* CTA */}
      <button className="w-full py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono text-sm font-bold rounded transition-colors">
        ROUTE TO ADVISOR
      </button>
    </div>
  );
}