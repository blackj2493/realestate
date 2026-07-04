'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import HiddenEquityForm, { type HEFormState } from './HiddenEquityForm';
import HiddenEquityReport from './HiddenEquityReport';
import type { CohortTree } from '@/lib/avm/cohorts';
import type { AVMResult } from '@/lib/avm/types';
import type { ValueAddReport } from '@/lib/avm/valueAdd/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const DEFAULT_FORM: HEFormState = {
  city: '',
  cityRegion: '',
  propertySubType: '',
  bedroomsAboveGrade: 3,
  bathroomsTotalInteger: 2,
  parkingTotal: 1,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 5,
  buildingAreaTotal: null,
};

export default function HiddenEquityTool() {
  // ── Cohort tree ──────────────────────────────────────────────────────────
  const [tree, setTree] = useState<CohortTree>({});
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/avm/cohorts');
        if (cancelled) return;
        if (res.status === 401) {
          setTreeError('Please sign in to access the Hidden Equity tool.');
          setTreeLoading(false);
          return;
        }
        if (!res.ok) {
          setTreeError('Unable to load neighbourhood data. Please try again later.');
          setTreeLoading(false);
          return;
        }
        const json = await res.json();
        setTree(json.tree ?? {});
      } catch {
        if (!cancelled) {
          setTreeError('Unable to load neighbourhood data. Please try again later.');
        }
      } finally {
        if (!cancelled) setTreeLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Form state ───────────────────────────────────────────────────────────
  const [form, setForm] = useState<HEFormState>(DEFAULT_FORM);

  // ── Result state ─────────────────────────────────────────────────────────
  const [result, setResult] = useState<{
    estimate: AVMResult | null;
    report: ValueAddReport | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── Result scroll ref ────────────────────────────────────────────────────
  const resultRef = useRef<HTMLDivElement>(null);

  // Scroll the result card into view on mobile once it populates.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  const canSubmit = !!(form.city && form.cityRegion && form.propertySubType);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch('/api/avm/hidden-equity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityRegion: form.cityRegion,
          city: form.city,
          propertySubType: form.propertySubType,
          bedroomsAboveGrade: form.bedroomsAboveGrade,
          bathroomsTotalInteger: form.bathroomsTotalInteger,
          parkingTotal: form.parkingTotal,
          interiorTier: form.interiorTier,
          exteriorTier: form.exteriorTier,
          basementTier: form.basementTier,
          buildingAreaTotal: form.buildingAreaTotal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? 'Valuation failed. Please try again.');
        return;
      }
      setResult({ estimate: json.estimate ?? null, report: json.valueAdd ?? null });
    } catch {
      setSubmitError('Unable to reach the valuation service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, submitting, form]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* LEFT — form + controls */}
      <Card className="p-6 bg-gray-900/50 border-gray-800">
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-gray-100 mb-1">HIDDEN EQUITY ANALYSIS</h2>
            <p className="text-xs text-gray-500">
              Model your home&apos;s untapped value based on neighbourhood comps
            </p>
          </div>

          {treeLoading ? (
            <p className="text-sm text-gray-500">Loading neighbourhoods…</p>
          ) : treeError ? (
            <p className="text-sm text-red-700 dark:text-red-400">{treeError}</p>
          ) : (
            <HiddenEquityForm tree={tree} value={form} onChange={setForm} />
          )}

          {!treeLoading && !treeError && (
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
              className="h-11 w-full bg-emerald-700 font-mono text-white hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 [touch-action:manipulation]"
            >
              {submitting ? 'Calculating…' : 'Reveal my hidden equity'}
            </Button>
          )}

          {submitError && (
            <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>
          )}
        </div>
      </Card>

      {/* RIGHT — report or placeholder */}
      <Card className="p-6 bg-gray-900/50 border-gray-800">
        <div ref={resultRef} className="space-y-6">
          <div>
            <h2 className="text-lg font-mono text-gray-100 mb-1">EQUITY REPORT</h2>
            <p className="text-xs text-gray-500">Estimated value + renovation uplift potential</p>
          </div>

          {result ? (
            <HiddenEquityReport estimate={result.estimate} report={result.report} />
          ) : (
            <p className="text-sm text-gray-500">
              Pick your neighbourhood and home details, then reveal your hidden equity.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
