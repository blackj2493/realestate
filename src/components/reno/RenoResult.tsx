'use client';

import Link from 'next/link';
import { Lock, Home, TrendingUp, TrendingDown, LineChart } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { AVMResult } from '@/lib/avm/types';
import type { ValueAddReport } from '@/lib/avm/valueAdd/types';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';
import { localRulesFor } from '@/lib/reno/localRules';
import { normalizePropertySubType } from '@/lib/avm/normalizeType';
import { useRenoCohort } from '@/lib/reno/useRenoCohort';
import { deriveEligibilityEvidence } from '@/lib/reno/eligibilityEvidence';
import MarketGrids from '@/components/address/MarketGrids';
import RenoMoveCard, { type RenoMoveDisplay } from './RenoMoveCard';
import RenoInsightStrip from './RenoInsights';
import RenoMethodNote from './RenoMethodNote';
import RenoMarketBridge from './RenoMarketBridge';
import RenoCarousels from './RenoCarousels';
import ShareChallengeButton from './ShareChallengeButton';
import { RenoGuidePanel } from './RenoPanels';

export type RenoResultData =
  | { locked: true; catalog: AnonCatalogItem[] }
  | {
      locked: false;
      estimate: AVMResult | null;
      report: ValueAddReport | null;
    };

export default function RenoResult({
  result,
  city,
  community,
  typeLabel,
  unlockHref,
  onUnlock,
  communitySlug,
  cityRegion,
  lat,
  lng,
}: {
  result: RenoResultData;
  city: string;
  community: string | null;
  typeLabel: string;
  unlockHref: string;
  onUnlock: () => void;
  communitySlug: string | null;
  /** RAW city_region value — what the market RPCs and /analytics match on. */
  cityRegion?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const where = community || city || 'your area';
  const rules = localRulesFor(city);
  const isApartment = normalizePropertySubType(typeLabel) === 'Condo Apartment';

  // Normalise both API shapes into one ranked move list for the cards.
  let moves: RenoMoveDisplay[];
  if (result.locked) {
    moves = result.catalog.map((m, i) => ({
      key: m.key,
      rank: i + 1,
      label: m.label,
      costLow: m.costLow,
      costHigh: m.costHigh,
      locked: true,
    }));
  } else {
    // Priced moves, dropping trivial non-recommended ones (e.g. a "+$27" move is
    // noise that undermines the result). Recommended moves always stay.
    const priced = (result.report?.moves ?? []).filter(
      (m) => m.status === 'priced' && (m.recommended || m.valueAddTyp >= 1000),
    );
    priced.sort(
      (a, b) => Number(b.recommended) - Number(a.recommended) || b.paybackRatio - a.paybackRatio,
    );
    moves = priced.map((m, i) => ({
      key: m.key,
      rank: i + 1,
      label: m.label,
      costLow: m.costLow,
      costHigh: m.costHigh,
      locked: false,
      valueAddTyp: m.valueAddTyp,
      paybackRatio: m.paybackRatio,
      recommended: m.recommended,
    }));
  }

  const report = result.locked ? null : result.report;
  const estimate = result.locked ? null : result.estimate;

  // The counter-intuitive split: moves that pay back vs popular ones that don't.
  const winners = result.locked ? [] : moves.filter((m) => (m.paybackRatio ?? 0) >= 1);
  const losers = result.locked ? [] : moves.filter((m) => Number.isFinite(m.paybackRatio) && (m.paybackRatio ?? 0) < 1);
  const splitMoves = winners.length > 0 && losers.length > 0;

  // The beds × type grids for this location — the same "what homes sell/rent for here"
  // tables the listing pages show. We render the WHOLE grid rather than assert a size:
  // unless the owner opened "Add your details", we don't know if their home is 3, 4 or 5
  // bed, so the table lets them find their own row.
  const { cohort } = useRenoCohort(lat, lng);

  // Local proof for the eligibility rules: second units actually leased nearby (with the
  // rent RANGE across sizes — never one blended figure, since the suite's size is exactly
  // what we don't know) and plex-type homes actually sold nearby.
  const evidence = deriveEligibilityEvidence({
    rentMatrix: cohort?.rent?.matrix,
    rentSource: cohort?.rent?.source,
    sellMatrix: cohort?.sell?.matrix,
    sellSource: cohort?.sell?.source,
    radiusKm: cohort?.sell?.radiusKm ?? cohort?.rent?.radiusKm ?? null,
  });

  // The hero's credibility line: how much evidence is behind the number. Cohort sales
  // first (what the model was fitted on), then the nearby comparables the anchor weighed.
  const sampleLine = (() => {
    const bits: string[] = [];
    const cohortN = report?.salesAnalyzed ?? null;
    if (cohortN && cohortN > 0) {
      bits.push(`${cohortN.toLocaleString('en-CA')} closed ${typeLabel.toLowerCase()} sales analyzed in ${where}`);
    }
    if (estimate?.comps && estimate.comps > 0) {
      bits.push(`${estimate.comps.toLocaleString('en-CA')} nearby comparables weighted`);
    }
    return bits.length ? bits.join(' · ') : null;
  })();

  const movesHeader = (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground">
          <TrendingUp className="h-[18px] w-[18px] text-cyan-700 dark:text-cyan-400" aria-hidden /> Every dollar, ranked
        </h2>
        <span className="font-mono text-[11.5px] text-muted-foreground">for a typical {typeLabel.toLowerCase()}</span>
      </div>
      {/* Say the withheld thing out loud, with a COUNT. "Every dollar, ranked" over an
          unranked grey list is a promise the anon view visibly fails to keep, and the
          per-card locks are too quiet to explain why. The count is derived from the home's
          own attributes (buildAnonCatalog), never from sold data, so it is honest to show
          a signed-out visitor — and a specific number is a better reason to sign in than
          a padlock. */}
      {result.locked && moves.length > 0 && (
        <>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground">
              {moves.length} move{moves.length === 1 ? '' : 's'} appl{moves.length === 1 ? 'ies' : 'y'} to this home.
            </span>{' '}
            The payback on every one is hidden.
          </p>
          {/* The same unlock, repeated at the top of the list ON PHONES ONLY. The hero CTA
              has scrolled away by the time the cards are in view, and the one below the list
              is up to nine cards further down — so the moment the gate becomes obvious was
              also the moment with nothing to press. Desktop keeps a single CTA: the hero and
              the rail are both still on screen there.
              NOT a fixed bottom bar: the feature-guide launcher is fixed bottom-right at
              z-[130] (DiscoveryRoot), so a full-width bar would sit under it on exactly the
              viewport this is meant to help. */}
          <Link
            href={unlockHref}
            onClick={onUnlock}
            className="mt-2.5 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation] sm:hidden"
          >
            <Lock className="h-4 w-4" aria-hidden /> Unlock all {moves.length} &mdash; free &rarr;
          </Link>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* context */}
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-[13px] text-muted-foreground">
        <Home className="h-4 w-4" aria-hidden /> A <span className="font-semibold text-foreground">typical {typeLabel.toLowerCase()}</span> in {where}
      </div>

      {/* HERO */}
      {result.locked ? (
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent p-5 text-center">
          <p className="text-[13px] text-muted-foreground">
            How much a smart reno could add to a typical {typeLabel.toLowerCase()} here
          </p>
          <p className="my-1 select-none text-4xl font-extrabold tracking-tight text-emerald-700 blur-[7px] dark:text-emerald-400" aria-hidden>
            $•••,•••
          </p>
          {/* This was a bare <span> styled as a pill — it looked exactly like a button,
              sat directly under the blurred number (the most compelling thing on the
              screen), and did nothing when tapped. It is the primary action at this
              moment, so it is now a real link, at a real touch size. */}
          <div className="mt-4 flex flex-col items-center gap-2.5">
            <Link
              href={unlockHref}
              onClick={onUnlock}
              className="inline-flex min-h-[48px] w-full max-w-[280px] items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-[15px] font-bold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation]"
            >
              <Lock className="h-4 w-4" aria-hidden /> Sign in to reveal your number
            </Link>
            <span className="rounded-full border border-cyan-600/35 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-700 dark:text-cyan-400">
              Based on recent {city} sales
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/12 to-transparent p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[13px] text-muted-foreground">A focused reno here could add up to</p>
              <p className="my-0.5 text-4xl font-extrabold tracking-tight text-emerald-700 dark:text-emerald-400">
                +{formatPrice(report?.headlineUpsideGross ?? 0)}
              </p>
              <p className="text-[13px] text-muted-foreground">
                ≈ <b className="text-emerald-700 dark:text-emerald-400">+{formatPrice(report?.headlineUpside ?? 0)}</b> left over after you pay for the work
              </p>
            </div>
            {report && report.valueAddScore > 0 && (
              <span className="rounded-full border border-emerald-600/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                Score {report.valueAddScore}/100
              </span>
            )}
          </div>
          {/* What the number was built FROM — the sample, not the home's own value. The
              owner came for the reno upside, not an appraisal; the sale price they'd get
              is a different question, and quoting it here invited it to be read as one. */}
          {sampleLine && (
            <p className="mt-2 border-t border-border pt-2 font-mono text-[12.5px] text-muted-foreground">
              {sampleLine}
            </p>
          )}
        </div>
      )}

      {/* ANON only — the one card that says what the locked numbers are. Signed-in users
          go straight to the ranked cards; the old 3-card insight strip repeated them. */}
      {result.locked && <RenoInsightStrip where={where} unlockHref={unlockHref} onUnlock={onUnlock} />}

      {/* CREDIBILITY — the engine's own diagnostics, collapsed by default. */}
      <RenoMethodNote
        locked={result.locked}
        typeLabel={typeLabel}
        where={where}
        stats={{
          r2Score: estimate?.r2Score ?? null,
          comps: estimate?.comps ?? null,
          nEff: estimate?.nEff ?? null,
          confidence: report?.confidence ?? estimate?.confidence ?? null,
          estimatedValue: estimate?.estimatedValue ?? null,
          lowBand: estimate?.lowBand ?? null,
          highBand: estimate?.highBand ?? null,
        }}
      />

      {/* two-column: moves + rail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* MOVES */}
        <div className="space-y-2.5">
          {movesHeader}

          {moves.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
              {/* Don't blame the neighbourhood for a property-type filter: an apartment
                  has most of the catalogue ruled out on feasibility (no basement, no
                  envelope to extend), which is a different fact from "we have no data
                  here", and sending them to a nearby community would not help. */}
              {isApartment
                ? 'Most renovation moves we model — basements, additions, exterior work — aren’t available to an apartment owner. Interior work is, but there isn’t enough local evidence to price it yet.'
                : 'Renovation modelling isn’t available for this neighbourhood yet — try a nearby community.'}
            </p>
          ) : splitMoves ? (
            <>
              <div className="space-y-2.5">
                {winners.map((m) => <RenoMoveCard key={m.key} m={m} />)}
              </div>
              <div className="flex items-center gap-2 pt-2 text-[12.5px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-500">
                <TrendingDown className="h-4 w-4" aria-hidden /> Popular here — but they don’t pay back
              </div>
              <div className="space-y-2.5">
                {losers.map((m) => <RenoMoveCard key={m.key} m={m} />)}
              </div>
            </>
          ) : (
            moves.map((m) => <RenoMoveCard key={m.key} m={m} />)
          )}

          {result.locked ? (
            <>
              <Link
                href={unlockHref}
                onClick={onUnlock}
                className="mt-1 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation]"
              >
                <Lock className="h-4 w-4" /> Unlock which pays back most — free →
              </Link>
            </>
          ) : (
            <Link
              href="/properties"
              className="mt-1 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 [touch-action:manipulation]"
            >
              <LineChart className="h-4 w-4" aria-hidden /> Track this home’s value →
            </Link>
          )}
          <ShareChallengeButton communitySlug={communitySlug} community={community} />
        </div>

        {/* RAIL — free over-deliver, one calm capsule */}
        <div>
          <RenoGuidePanel
            rules={rules}
            unlockHref={unlockHref}
            onUnlock={onUnlock}
            isAuthed={!result.locked}
            evidence={evidence}
          />
        </div>
      </div>

      {/* WHAT HOMES SELL / RENT FOR HERE — the same beds × type tables as the listing
          pages. Every size is on screen, so nobody has to take our "typical" on faith. */}
      {(cohort?.sell || cohort?.rent) && (
        <MarketGrids sell={cohort.sell} rent={cohort.rent} showSignInNudge={result.locked} />
      )}

      {/* MARKET TRENDS — the second primary action, personalized to THIS region + type. */}
      <RenoMarketBridge where={where} region={cityRegion || city} city={city} typeLabel={typeLabel} />

      {lat != null && lng != null && (
        <RenoCarousels lat={lat} lng={lng} type={typeLabel} where={where} />
      )}
    </div>
  );
}
