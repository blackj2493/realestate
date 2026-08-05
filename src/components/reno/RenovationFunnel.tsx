'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import HiddenEquityForm, { type HEFormState } from '@/components/hiddenEquity/HiddenEquityForm';
import HiddenEquityReport from '@/components/hiddenEquity/HiddenEquityReport';
import RenovationRevealLocked from './RenovationRevealLocked';
import ShareChallengeButton from './ShareChallengeButton';
import type { CohortTree } from '@/lib/avm/cohorts';
import type { AVMResult } from '@/lib/avm/types';
import type { ValueAddReport } from '@/lib/avm/valueAdd/types';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const STASH_KEY = 'reno_funnel_pending';

type Result =
  | { locked: true; catalog: AnonCatalogItem[] }
  | { locked: false; estimate: AVMResult | null; report: ValueAddReport | null };

export default function RenovationFunnel({
  tree,
  initialCity,
  initialCityRegion,
  communitySlug,
  communityLabel,
}: {
  tree: CohortTree;
  initialCity: string;
  initialCityRegion: string;
  communitySlug: string | null;
  communityLabel: string | null;
}) {
  const [form, setForm] = useState<HEFormState>({
    city: initialCity,
    cityRegion: initialCityRegion,
    propertySubType: '',
    bedroomsAboveGrade: 3,
    bathroomsTotalInteger: 2,
    parkingTotal: 1,
    interiorTier: 3,
    exteriorTier: 3,
    basementTier: 5,
    buildingAreaTotal: null,
  });
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const autoTried = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  const canSubmit = !!(form.city && form.cityRegion && form.propertySubType);

  const submit = useCallback(async (f: HEFormState) => {
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    try {
      const res = await fetch('/api/avm/hidden-equity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cityRegion: f.cityRegion,
          city: f.city,
          propertySubType: f.propertySubType,
          bedroomsAboveGrade: f.bedroomsAboveGrade,
          bathroomsTotalInteger: f.bathroomsTotalInteger,
          parkingTotal: f.parkingTotal,
          interiorTier: f.interiorTier,
          exteriorTier: f.exteriorTier,
          basementTier: f.basementTier,
          buildingAreaTotal: f.buildingAreaTotal,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (json.locked) {
        setResult({ locked: true, catalog: json.catalog ?? [] });
      } else {
        setResult({ locked: false, estimate: json.estimate ?? null, report: json.valueAdd ?? null });
      }
    } catch {
      setSubmitError('Unable to reach the service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Rehydrate + auto-submit after returning from sign-in.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    let stashed: HEFormState | null = null;
    try {
      const raw = sessionStorage.getItem(STASH_KEY);
      if (raw) stashed = JSON.parse(raw) as HEFormState;
    } catch {
      stashed = null;
    }
    if (stashed) {
      sessionStorage.removeItem(STASH_KEY);
      // Rehydrate the form from the pre-sign-in stash. setState-in-effect is
      // intentional and SSR-safe: sessionStorage is unavailable during SSR so
      // useState can't be lazy-initialised from it, and the one-shot autoTried
      // ref prevents cascading re-runs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(stashed);
      void submit(stashed);
    }
  }, [submit]);

  const onUnlock = useCallback(() => {
    try {
      sessionStorage.setItem(STASH_KEY, JSON.stringify(form));
    } catch {
      /* storage blocked — unlock still navigates, user re-enters once */
    }
  }, [form]);

  const unlockHref = `/login?next=${encodeURIComponent(
    `/whats-my-home-hiding${communitySlug ? `?community=${communitySlug}` : ''}`,
  )}`;

  // Scroll the result card into view on mobile once it populates.
  useEffect(() => {
    if (result) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [result]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* LEFT — form */}
      <Card className="p-6">
        <div className="space-y-6">
          <div>
            <h2 className="mb-1 font-mono text-lg text-foreground">YOUR HOME</h2>
            <p className="text-xs text-muted-foreground">Pick your neighbourhood and home details.</p>
          </div>
          <HiddenEquityForm tree={tree} value={form} onChange={setForm} />
          <Button
            onClick={() => void submit(form)}
            disabled={!canSubmit || submitting}
            className="h-11 w-full bg-emerald-700 font-mono text-white hover:bg-emerald-600 active:bg-emerald-800 disabled:opacity-40 [touch-action:manipulation]"
          >
            {submitting ? 'Analyzing…' : "See what my home's hiding"}
          </Button>
          {submitError && <p className="text-sm text-red-700 dark:text-red-400">{submitError}</p>}
        </div>
      </Card>

      {/* RIGHT — reveal */}
      <Card className="p-6">
        <div ref={resultRef} className="space-y-6">
          <div>
            <h2 className="mb-1 font-mono text-lg text-foreground">RENOVATION UPSIDE</h2>
            <p className="text-xs text-muted-foreground">What pays back most — for your home.</p>
          </div>

          {!result && (
            <p className="text-sm text-muted-foreground">
              Fill in your home on the left to reveal its renovation upside.
            </p>
          )}

          {result?.locked && (
            <div className="space-y-4">
              <RenovationRevealLocked
                community={communityLabel}
                catalog={result.catalog}
                unlockHref={unlockHref}
                onUnlock={onUnlock}
              />
              {/* Anon-visible curiosity-gap share — carries only the community slug,
                  never a VOW number. Placed here (not just in the unlocked branch) so the
                  loop can spread before sign-in. */}
              <ShareChallengeButton communitySlug={communitySlug} community={communityLabel} />
            </div>
          )}

          {result && !result.locked && (
            <div className="space-y-4">
              <HiddenEquityReport estimate={result.estimate} report={result.report} />
              <ShareChallengeButton communitySlug={communitySlug} community={communityLabel} />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
