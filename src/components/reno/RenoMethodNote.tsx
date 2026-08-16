'use client';

import { FlaskConical } from 'lucide-react';
import { buildMethodRows, type MethodStatsInput } from '@/lib/reno/methodStats';

/**
 * "How this number is built" — the credibility block under the headline.
 *
 * It QUALIFIES the evidence the hero has already counted: how much of the sample really
 * counted after weighting, how well the model fits, how wide the predictive band is, how
 * fresh the feed is. A technical reader can see the number is FITTED, not guessed, while
 * nothing here gives away how the model works. The raw sample size stays in the hero —
 * one fact, one place.
 *
 * Anonymous callers see the method rows the engine can state without a cohort (data
 * source + determinism); no VOW-derived diagnostic renders behind the gate.
 */
export default function RenoMethodNote({
  stats,
  typeLabel,
  where,
  locked,
}: {
  stats: MethodStatsInput;
  typeLabel: string;
  where: string;
  locked: boolean;
}) {
  // Behind the gate we still state the pipeline (a policy fact, no VOW value in it);
  // every cohort diagnostic is withheld because each one is derived from sold data.
  const rows = buildMethodRows(locked ? {} : stats);

  return (
    <details className="group rounded-xl border border-border bg-card/60 open:bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3.5 text-[13px] font-semibold text-foreground [&::-webkit-details-marker]:hidden">
        <FlaskConical className="h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
        How this number is built
        <span className="ml-auto text-[12px] font-medium text-muted-foreground transition-transform group-open:rotate-180" aria-hidden>
          ▾
        </span>
      </summary>

      <div className="border-t border-border px-3.5 pb-3.5 pt-3">
        {rows.length > 0 && (
          <dl className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.label} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[13px] text-muted-foreground">{r.label}</dt>
                  <dd className="shrink-0 text-right font-mono text-[13px] font-semibold text-foreground">{r.value}</dd>
                </div>
                {r.note && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{r.note}</p>}
              </div>
            ))}
          </dl>
        )}

        <p className="mt-2.5 border-t border-border pt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Every figure here is computed by fixed formulas over closed sales — the same home returns
          the same numbers every time, and nothing is written or invented for you. These are typical
          numbers for a {typeLabel.toLowerCase()} in {where}; open a listing page for a specific
          home&rsquo;s own estimate.
        </p>
      </div>
    </details>
  );
}
