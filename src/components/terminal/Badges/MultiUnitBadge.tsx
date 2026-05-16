import React from 'react';

const BADGE_STYLES: Record<string, string> = {
  'PRIME_CANDIDATE': 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
  'EXISTING_MULTI_UNIT': 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  'MARGINAL_CANDIDATE': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'INHERITED_TENANT_RISK': 'text-red-400 bg-red-400/10 border-red-400/20',
  'OVER_ASSESSED': 'text-red-400 bg-red-400/10 border-red-400/20',
  'UNDER_ASSESSED_RISK': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  'PRICE_DISCOVERY': 'text-amber-400 bg-amber-400/10 border-amber-400/20',
};

const BADGE_LABELS: Record<string, string> = {
  'PRIME_CANDIDATE': 'ALPHA: PRIME DUPLEX CANDIDATE',
  'EXISTING_MULTI_UNIT': 'EXISTING DUPLEX/MULTI-UNIT',
  'MARGINAL_CANDIDATE': 'MARGINAL SUITE POTENTIAL',
  'INHERITED_TENANT_RISK': '⚠ INHERITED TENANT RISK',
  'OVER_ASSESSED': 'OVER ASSESSED',
  'UNDER_ASSESSED_RISK': 'UNDER ASSESSED',
  'PRICE_DISCOVERY': 'PRICE DISCOVERY',
};

interface AlphaBadgeProps {
  status: string;
  className?: string;
}

export function AlphaBadge({ status, className = '' }: AlphaBadgeProps) {
  if (!status || status === 'NOT_VIABLE' || status === 'MARKET_AVERAGE') return null;

  const style = BADGE_STYLES[status] || BADGE_STYLES['PRICE_DISCOVERY'];
  const label = BADGE_LABELS[status] || status;

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono border rounded ${style} ${className}`}>
      {label}
    </span>
  );
}

interface PropertyBadgesProps {
  multiUnitStatus?: string;
  suiteConfidence?: string | null;
  assessmentStatus?: string;
  priceDiscoveryFlag?: boolean;
  isDensityReady?: boolean;
  surplusParkingCount?: number;
}

export function PropertyBadges({
  multiUnitStatus,
  suiteConfidence,
  assessmentStatus,
  priceDiscoveryFlag,
  isDensityReady,
  surplusParkingCount = 0,
}: PropertyBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {multiUnitStatus && <AlphaBadge status={multiUnitStatus} />}
      {suiteConfidence && <AlphaBadge status={suiteConfidence} />}
      {assessmentStatus && assessmentStatus !== 'MARKET_AVERAGE' && (
        <AlphaBadge status={assessmentStatus} />
      )}
      {priceDiscoveryFlag && <AlphaBadge status="PRICE_DISCOVERY" />}
      {isDensityReady && (
        <span className="px-2 py-0.5 text-xs font-mono text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded">
          AS-OF-RIGHT DENSITY COMPLIANT
        </span>
      )}
      {surplusParkingCount > 0 && (
        <span className="px-2 py-0.5 text-xs font-mono text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded">
          +{surplusParkingCount} SPACES
        </span>
      )}
    </div>
  );
}