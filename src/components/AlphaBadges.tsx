/**
 * AlphaBadges.tsx - Builder/Land Development Alpha Badges
 * Displays property badges for severance, covered land, density play, and infrastructure risk
 */

"use client";

import React from 'react';
import { cn } from '@/lib/utils';

interface AlphaBadgesProps {
  severanceCandidate: boolean;
  lotWidth: number;
  isCoveredLand: boolean;
  densityPlay: 'none' | 'LOW' | 'MEDIUM' | 'HIGH';
  infrastructureFlag: 'OK' | 'SEPTIC/WELL_RISK';
}

/**
 * AlphaBadges - Displays builder/land development specific badges
 */
export function AlphaBadges({ 
  severanceCandidate, 
  lotWidth, 
  isCoveredLand, 
  densityPlay, 
  infrastructureFlag 
}: AlphaBadgesProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Severance Badge */}
      {severanceCandidate && (
        <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          ✂ SEVERANCE: {lotWidth}ft+ FRONTAGE
        </span>
      )}

      {/* Covered Land / Tear-Down Badge */}
      {isCoveredLand && (
        <span className="bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          🏚 COVERED LAND / TEAR-DOWN
        </span>
      )}

      {/* Density Play Badge */}
      {densityPlay === 'HIGH' && (
        <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          ⚡ HIGH DENSITY PLAY
        </span>
      )}

      {/* Medium Density Badge */}
      {densityPlay === 'MEDIUM' && (
        <span className="bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          ⚡ MEDIUM DENSITY
        </span>
      )}

      {/* Low Density Badge */}
      {densityPlay === 'LOW' && (
        <span className="bg-slate-500/10 text-slate-400 border border-slate-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          ○ LOW DENSITY
        </span>
      )}

      {/* Utility Risk Badge */}
      {infrastructureFlag === 'SEPTIC/WELL_RISK' && (
        <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-[10px] font-mono px-2 py-0.5 rounded uppercase">
          ⚠ INFRASTRUCTURE RISK
        </span>
      )}
    </div>
  );
}

export default AlphaBadges;