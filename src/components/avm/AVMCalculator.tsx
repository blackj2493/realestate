/**
 * AVM Calculator — Main Container Component
 * 
 * Assembles the property form and result display into a terminal-style layout.
 */

'use client';

import { useAVMStore } from '@/store/useAVMStore';
import { AVMPropertyForm } from './AVMPropertyForm';
import { AVMResultDisplay } from './AVMResultDisplay';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export function AVMCalculator() {
  const { cityRegion, propertySubType, setResult, setLoading, setError, reset } =
    useAVMStore();

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
      <Card className="p-6 bg-gray-900/50 border-gray-800">
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-gray-100 mb-1">PROPERTY PROFILE</h2>
            <p className="text-xs text-gray-500">Enter property characteristics</p>
          </div>
          <AVMPropertyForm />
          <div className="flex gap-3">
            <Button
              onClick={handleCalculate}
              className="flex-1 bg-blue-700 hover:bg-blue-600 text-white font-mono"
            >
              CALCULATE ESTIMATE
            </Button>
            <Button
              onClick={reset}
              variant="outline"
              className="border-gray-700 text-gray-400 hover:text-gray-200"
            >
              RESET
            </Button>
          </div>
        </div>
      </Card>

      {/* Right: Result Display */}
      <Card className="p-6 bg-gray-900/50 border-gray-800">
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-gray-100 mb-1">ESTIMATED VALUE</h2>
            <p className="text-xs text-gray-500">Automated valuation result</p>
          </div>
          <AVMResultDisplay />
        </div>
      </Card>
    </div>
  );
}