/**
 * AVM Calculator — Main Container Component
 * 
 * Assembles the property form and result display into a terminal-style layout.
 */

'use client';

import { useRef } from 'react';
import { useAVMStore } from '@/store/useAVMStore';
import { AVMPropertyForm } from './AVMPropertyForm';
import { AVMResultDisplay } from './AVMResultDisplay';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function AVMCalculator() {
  const { isLoading, setResult, setLoading, setError, reset } = useAVMStore();
  const resultRef = useRef<HTMLDivElement>(null);

  async function handleCalculate() {
    const {
      cityRegion,
      propertySubType,
      bedroomsAboveGrade,
      bathroomsTotalInteger,
      parkingTotal,
      interiorTier,
      exteriorTier,
      basementTier,
    } = useAVMStore.getState();

    if (!cityRegion || !propertySubType) {
      setError('City/Region and Property Type are required');
      return;
    }

    setLoading(true);
    setError(null);
    resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const res = await fetch('/api/avm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityRegion,
          propertySubType,
          bedroomsAboveGrade,
          bathroomsTotalInteger,
          parkingTotal,
          interiorTier,
          exteriorTier,
          basementTier,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Calculation failed');
      }

      const result = await res.json();
      setResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calculation failed');
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: Property Form */}
      <Card className="p-4 sm:p-6 bg-card border-border dark:bg-gray-900/50 dark:border-gray-800">
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-foreground mb-1 dark:text-gray-100">PROPERTY PROFILE</h2>
            <p className="text-xs text-muted-foreground dark:text-gray-500">Enter property characteristics</p>
          </div>
          <AVMPropertyForm />
          <div className="flex gap-3">
            <Button
              onClick={handleCalculate}
              disabled={isLoading}
              className="flex-1 min-h-[44px] bg-blue-700 hover:bg-blue-600 text-white font-mono"
            >
              {isLoading ? 'CALCULATING…' : 'CALCULATE ESTIMATE'}
            </Button>
            <Button
              onClick={reset}
              variant="outline"
              className="min-h-[44px] shrink-0 border-input text-muted-foreground hover:text-foreground dark:border-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              RESET
            </Button>
          </div>
        </div>
      </Card>

      {/* Right: Result Display */}
      <Card ref={resultRef} className="p-6 bg-card border-border dark:bg-gray-900/50 dark:border-gray-800">
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-foreground mb-1 dark:text-gray-100">ESTIMATED VALUE</h2>
            <p className="text-xs text-muted-foreground dark:text-gray-500">Automated valuation result</p>
          </div>
          <AVMResultDisplay />
        </div>
      </Card>
    </div>
  );
}