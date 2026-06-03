// src/components/Property/forceAppreciationView.ts
import type { ValueAddReport, ValueAddMove, SuppressReason } from '@/lib/avm/valueAdd/types';

export interface LedgerRow {
  key: string;
  label: string;
  valueTyp: number;
  costTyp: number;
  payback: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}
export interface SuppressedRow {
  key: string;
  label: string;
  reason: string;
}
export interface ForceAppreciationView {
  score: number;
  headlineGross: number;
  headlineNet: number;
  insight: string;
  basis: string;
  /** The greedy positive-payback set the headline sums (engine `recommended` flag). */
  recommendedRows: LedgerRow[];
  /** Σ costTyp of recommendedRows — the Total row's Costs cell. */
  totalCosts: number;
  /** Priced-but-not-recommended moves (the "Why not the others?" disclosure). */
  moreRows: LedgerRow[];
  suppressed: SuppressedRow[];
}

const REASON_COPY: Record<SuppressReason, string> = {
  negative_beta: "local sales don't show a reliable premium",
  placeholder: 'not enough local signal to price this',
  low_r2: 'too few comparable sales to model this area',
  thin_cohort: 'too few comparable sales to model this area',
  at_ceiling: 'this home is already top-of-market on this',
  null_baseline: 'this home is missing the data needed',
  already_present: 'already present in this home',
  no_estimate: 'no estimate available for this home',
};

export function suppressReasonCopy(reason: SuppressReason): string {
  return REASON_COPY[reason];
}

export function shouldRender(report: ValueAddReport | null): report is ValueAddReport {
  return (
    report !== null &&
    report.subjectEstimate > 0 &&
    report.moves.some((m) => m.status === 'priced')
  );
}

function toRow(m: ValueAddMove): LedgerRow {
  return {
    key: m.key,
    label: m.label,
    valueTyp: m.valueAddTyp,
    costTyp: m.costTyp,
    payback: m.paybackRatio,
    confidence: m.confidence,
  };
}

export function buildView(report: ValueAddReport): ForceAppreciationView {
  const priced = report.moves.filter((m) => m.status === 'priced'); // sorted by net gain
  const recommended = priced.filter((m) => m.recommended);
  const more = priced.filter((m) => !m.recommended);
  const suppressed: SuppressedRow[] = report.moves
    .filter((m) => m.status === 'suppressed')
    .map((m) => ({ key: m.key, label: m.label, reason: suppressReasonCopy(m.suppressReason ?? 'no_estimate') }));
  return {
    score: report.valueAddScore,
    headlineGross: report.headlineUpsideGross,
    headlineNet: report.headlineUpside,
    insight: report.neighbourhoodInsight,
    basis: `${report.basis} · modeled, not appraised`,
    recommendedRows: recommended.map(toRow),
    totalCosts: recommended.reduce((a, m) => a + m.costTyp, 0),
    moreRows: more.map(toRow),
    suppressed,
  };
}
