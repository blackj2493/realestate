'use client';

/**
 * Renovation-upside experience (redesign) — address + property type, nothing else.
 *
 * The old 11-field form is gone. You type an address (auto-resolves the neighbourhood),
 * tap a property type, and we show the renovation upside for a TYPICAL home like that
 * in the area — the engine runs on sensible defaults (3 bed / 2 bath / standard), which
 * is exactly a "typical" home. Anyone who wants a precise, personalised read opens the
 * "Add your details" escape hatch. Anon sees the free result + a gated payoff; signing
 * in reveals the payback and value. VOW-safe: the anon path never renders a VOW number.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import RenoAddressField from './RenoAddressField';
import RenoResult, { type RenoResultData } from './RenoResult';
import { FoundingSeatsBanner } from './FoundingSeats';
import { shouldShowSeats, type SeatSummary } from '@/lib/founding/seats';
import type { HEFormState } from '@/components/hiddenEquity/HiddenEquityForm';
import type { CohortTree } from '@/lib/avm/cohorts';
import { normalizeCityRegion } from '@/lib/avm/cohorts';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const STASH_KEY = 'reno_funnel_pending';

const INTERIOR_LABELS = ['', 'Executive (luxury)', 'Premium (updated)', 'Standard (average)', 'Economy (dated)', 'Minimal (original)'];
const BASEMENT_LABELS = ['', 'Finished — high-end', '', 'Finished — standard', '', 'Unfinished', '', 'Partial / crawl space', '', 'None'];

const TYPICAL: Omit<HEFormState, 'city' | 'cityRegion' | 'propertySubType'> = {
  bedroomsAboveGrade: 3,
  bathroomsTotalInteger: 2,
  parkingTotal: 1,
  interiorTier: 3,
  exteriorTier: 3,
  basementTier: 5,
  buildingAreaTotal: null,
};

export default function RenovationFunnel({
  tree,
  initialCity,
  initialCityRegion,
  communitySlug,
  communityLabel,
  initialSeats,
}: {
  tree: CohortTree;
  initialCity: string;
  initialCityRegion: string;
  communitySlug: string | null;
  communityLabel: string | null;
  /** Server-rendered seat count; kept live from each API response. */
  initialSeats: SeatSummary;
}) {
  const [form, setForm] = useState<HEFormState>({
    city: initialCity,
    cityRegion: initialCityRegion,
    propertySubType: '',
    ...TYPICAL,
  });
  const [result, setResult] = useState<RenoResultData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [seats, setSeats] = useState<SeatSummary>(initialSeats);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const autoTried = useRef(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const community = tree[form.city]?.find((c) => c.cityRegion === form.cityRegion);
  const types = community?.types ?? [];
  const communityDisplay = communityLabel ?? (form.cityRegion ? normalizeCityRegion(form.cityRegion) : null);

  const submit = useCallback(async (f: HEFormState) => {
    if (!f.city || !f.cityRegion || !f.propertySubType) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/avm/hidden-equity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Campaign tag, so a founding seat can be traced back to the send that
          // earned it. AVMInputSchema strips it; the route reads the raw body.
          source:
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('ref')
              : null,
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
        setError(json.error ?? 'Something went wrong. Please try again.');
        return;
      }
      // Carry the seat data into the result — without this the offer strip and the
      // "your seat is #N" confirmation silently never render, because both fields
      // are optional on RenoResultData and so nothing type-errors when they're
      // dropped. The API returns `seats` on BOTH branches, and the count it returns
      // on the consumer branch is post-claim, so the banner below stays live too.
      if (json.seats) setSeats(json.seats);
      if (json.locked) {
        setResult({ locked: true, catalog: json.catalog ?? [], seats: json.seats ?? null });
      } else {
        setResult({
          locked: false,
          estimate: json.estimate ?? null,
          report: json.valueAdd ?? null,
          seats: json.seats ?? null,
          seat: json.seat ?? null,
        });
      }
    } catch {
      setError('Unable to reach the service. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Rehydrate + auto-submit after returning from sign-in.
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(STASH_KEY);
    } catch {
      raw = null;
    }
    if (raw) {
      sessionStorage.removeItem(STASH_KEY);
      try {
        const parsed = JSON.parse(raw) as {
          form?: HEFormState;
          coords?: { lat: number; lng: number } | null;
        } & Partial<HEFormState>;
        const f = (parsed.form ?? (parsed as HEFormState));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setForm(f);
        if (parsed.coords) setCoords(parsed.coords);
        void submit(f);
      } catch {
        /* corrupt stash — ignore */
      }
    }
  }, [submit]);

  const onUnlock = useCallback(() => {
    try {
      sessionStorage.setItem(STASH_KEY, JSON.stringify({ form, coords }));
    } catch {
      /* storage blocked — unlock still navigates */
    }
  }, [form, coords]);

  const unlockHref = `/login?next=${encodeURIComponent(
    `/whats-my-home-hiding${communitySlug ? `?community=${communitySlug}` : ''}`,
  )}`;

  // Pick a type → submit immediately with typical defaults (or current detail overrides).
  const pickType = (propertySubType: string) => {
    const next = { ...form, propertySubType };
    setForm(next);
    void submit(next);
  };

  const patch = (p: Partial<HEFormState>) => setForm((f) => ({ ...f, ...p }));

  const numSel = (label: string, value: number, on: (n: number) => void) => (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Select value={String(value)} onValueChange={(v) => on(Number(v))}>
        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
        <SelectContent>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <SelectItem key={n} value={String(n)}>{n}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  return (
    <div className="space-y-6">
      {shouldShowSeats(seats) && <FoundingSeatsBanner seats={seats} />}

      {/* ── INPUT ── */}
      <Card ref={inputRef} className="p-5">
        <div className="space-y-4">
          <RenoAddressField
            tree={tree}
            onResolve={(r) => {
              setResult(null);
              setCoords(r.lat != null && r.lng != null ? { lat: r.lat, lng: r.lng } : null);
              setForm((f) => ({ ...f, city: r.city || f.city, cityRegion: r.cityRegion, propertySubType: '' }));
            }}
          />

          {form.city && (tree[form.city]?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                NEIGHBOURHOOD{' '}
                <span className="font-normal text-muted-foreground/70">— we guessed this; change if it&apos;s off</span>
              </Label>
              <Select
                value={form.cityRegion}
                onValueChange={(cr) => {
                  setResult(null);
                  setForm((f) => ({ ...f, cityRegion: cr, propertySubType: '' }));
                }}
              >
                <SelectTrigger className="h-10"><SelectValue placeholder="Select neighbourhood" /></SelectTrigger>
                <SelectContent>
                  {tree[form.city].map((c) => (
                    <SelectItem key={c.cityRegion} value={c.cityRegion}>{c.community}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {types.length > 0 ? (
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">PROPERTY TYPE</Label>
              <div className="flex flex-wrap gap-2">
                {types.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => pickType(t)}
                    aria-pressed={form.propertySubType === t}
                    className={cn(
                      'min-h-[42px] rounded-lg border px-3.5 py-2 text-sm font-semibold transition-colors [touch-action:manipulation]',
                      form.propertySubType === t
                        ? 'border-cyan-500 bg-cyan-500/10 text-foreground shadow-[inset_0_0_0_1px] shadow-cyan-500/60'
                        : 'border-border bg-card text-muted-foreground hover:border-cyan-500/40 hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Enter your address to choose a property type.</p>
          )}

          {/* escape hatch — precise, personalised read */}
          {form.propertySubType && !showDetails && (
            <button
              type="button"
              onClick={() => setShowDetails(true)}
              className="text-xs font-semibold text-cyan-700 hover:underline dark:text-cyan-400"
            >
              Not a typical home? Add your details →
            </button>
          )}

          {showDetails && (
            <div className="space-y-3 rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">Fine-tune for a precise read, then update.</p>
              <div className="grid grid-cols-3 gap-2">
                {numSel('Beds', form.bedroomsAboveGrade, (n) => patch({ bedroomsAboveGrade: n }))}
                {numSel('Baths', form.bathroomsTotalInteger, (n) => patch({ bathroomsTotalInteger: n }))}
                {numSel('Parking', form.parkingTotal, (n) => patch({ parkingTotal: n }))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Interior condition</Label>
                  <Select value={String(form.interiorTier)} onValueChange={(v) => patch({ interiorTier: Number(v) })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((t) => (
                        <SelectItem key={t} value={String(t)}>{INTERIOR_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] text-muted-foreground">Basement</Label>
                  <Select value={String(form.basementTier)} onValueChange={(v) => patch({ basementTier: Number(v) })}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 3, 5, 7, 9].map((t) => (
                        <SelectItem key={t} value={String(t)}>{BASEMENT_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Square footage (optional)</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={form.buildingAreaTotal ?? ''}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/[^\d.]/g, '');
                    const n = parseFloat(cleaned);
                    patch({ buildingAreaTotal: cleaned === '' || !Number.isFinite(n) || n <= 0 ? null : n });
                  }}
                  placeholder="e.g. 1800"
                  className="h-10"
                />
              </div>
              <button
                type="button"
                onClick={() => void submit(form)}
                disabled={submitting || !form.propertySubType}
                className="h-10 w-full rounded-md bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40 [touch-action:manipulation]"
              >
                Update result
              </button>
            </div>
          )}

          {submitting && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Analysing a typical home like yours…
            </p>
          )}
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
        </div>
      </Card>

      {/* ── RESULT ── */}
      {result && (
        <div ref={resultRef}>
          <RenoResult
            result={result}
            city={form.city}
            community={communityDisplay}
            typeLabel={form.propertySubType}
            unlockHref={unlockHref}
            onUnlock={onUnlock}
            communitySlug={communitySlug}
            cityRegion={form.cityRegion}
            lat={coords?.lat ?? null}
            lng={coords?.lng ?? null}
          />
        </div>
      )}
    </div>
  );
}
