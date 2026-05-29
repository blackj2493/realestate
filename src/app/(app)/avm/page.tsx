/**
 * AVM Page — Anchor and Adjust Automated Valuation Model
 * 
 * Terminal-style tool for estimating property values using the
 * Coefficient Engine when R² >= 0.50, or fallback anchor pricing otherwise.
 */

import { AVMCalculator } from '@/components/avm';

export default function AVMPage() {
  return (
    <div className="min-h-screen bg-black text-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-mono font-bold text-white">
              AVM TERMINAL
            </h1>
            <span className="text-xs px-2 py-0.5 bg-blue-900 text-blue-300 border border-blue-700 rounded font-mono">
              COEFFICIENT ENGINE
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Anchor and Adjust Automated Valuation Model — Maple, Brampton, and
            surrounding Greater Toronto Area markets
          </p>
        </div>

        {/* Calculator */}
        <AVMCalculator />
      </div>
    </div>
  );
}