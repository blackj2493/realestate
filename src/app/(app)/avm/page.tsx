/**
 * AVM Page — Anchor and Adjust Automated Valuation Model
 * 
 * Terminal-style tool for estimating property values using the
 * Coefficient Engine when R² >= 0.50, or fallback anchor pricing otherwise.
 */

import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { AVMCalculator } from '@/components/avm';

export default async function AVMPage() {
  if (!(await getCurrentUser())) {
    redirect('/hidden-equity?next=/avm');
  }

  return (
    <div className="min-h-app bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            {/* Was text-white on bg-background — invisible once light became the default.
                The tokens resolve to the same shades this page used in dark. */}
            <h1 className="text-2xl font-mono font-bold text-foreground">
              AVM TERMINAL
            </h1>
            <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 border border-blue-300 rounded font-mono dark:bg-blue-900 dark:text-blue-300 dark:border-blue-700">
              COEFFICIENT ENGINE
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
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