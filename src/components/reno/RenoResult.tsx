'use client';

import Link from 'next/link';
import { Lock, Home, TrendingUp, TrendingDown, LineChart } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import type { AVMResult } from '@/lib/avm/types';
import type { ValueAddReport } from '@/lib/avm/valueAdd/types';
import type { AnonCatalogItem } from '@/lib/avm/valueAdd/anonCatalog';
import { localRulesFor } from '@/lib/reno/localRules';
import { useRenoCohort } from '@/lib/reno/useRenoCohort';
import { deriveEligibilityEvidence } from '@/lib/reno/eligibilityEvidence';
import MarketGrids from '@/components/address/MarketGrids';
import RenoMoveCard, { type RenoMoveDisplay } from './RenoMoveCard';
import RenoInsightStrip from './RenoInsights';
import RenoMarketBridge from './RenoMarketBridge';
import RenoCarousels from './RenoCarousels';
import ShareChallengeButton from './ShareChallengeButton';
import { RenoGuidePanel } from './RenoPanels';

export type RenoResultData =
  | { locked: true; catalog: AnonCatalogItem[] }
  | { locked: false; estimate: AVMResult | null; report: ValueAddReport | null };

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

  const movesHeader = (
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-foreground">
        <TrendingUp className="h-[18px] w-[18px] text-cyan-700 dark:text-cyan-400" aria-hidden /> Every dollar, ranked
      </h2>
      <span className="font-mono text-[11.5px] text-muted-foreground">for a typical {typeLabel.toLowerCase()}</span>
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
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Sign in to reveal your number
            </span>
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
          {estimate && estimate.estimatedValue > 0 && (
            <p className="mt-2 border-t border-border pt-2 font-mono text-[12.5px] text-muted-foreground">
              Est. value {formatPrice(estimate.estimatedValue)}
              {estimate.lowBand > 0 && estimate.highBand > 0 && (
                <> · range {formatPrice(estimate.lowBand)}–{formatPrice(estimate.highBand)}</>
              )}
            </p>
          )}
        </div>
      )}

      {/* ANON only — the one card that says what the locked numbers are. Signed-in users
          go straight to the ranked cards; the old 3-card insight strip repeated them. */}
      {result.locked && <RenoInsightStrip where={where} unlockHref={unlockHref} onUnlock={onUnlock} />}

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        These are typical numbers for a {typeLabel.toLowerCase()} in {where}. For a specific home’s own
        estimate and details, open its listing page.
      </p>

      {/* two-column: moves + rail */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* MOVES */}
        <div className="space-y-2.5">
          {movesHeader}

          {moves.length === 0 ? (
            <p className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
              Renovation modelling isn’t available for this neighbourhood yet — try a nearby community.
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
            <Link
              href={unlockHref}
              onClick={onUnlock}
              className="mt-1 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation]"
            >
              <Lock className="h-4 w-4" /> Unlock which pays back most — free →
            </Link>
          ) : (
            <Link
              href="/properties"
              className="mt-1 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700 [touch-action:manipulation]"
            >
              <LineChart className="h-4 w-4" aria-hidden /> Track this home’s value →
            </Link>
          )}
          <ShareChallengeButton communitySlug={communitySlug} community={community} />
          {report?.basis && <p className="text-xs text-muted-foreground">{report.basis}</p>}
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
