// src/lib/reno/insights.ts
//
// Turns the value-add engine's per-move numbers into "insight/secret" framing for
// the marketing tool: which moves quietly pay back 3×, which popular ones lose money
// at resale, and the plain-language decode of the payback multiple.
//
// DETERMINISTIC only (no AI — CLAUDE.md §4). Everything here is derived from the
// numeric moves the engine already returned; nothing new is inferred from VOW data.

import { Sparkles, AlertTriangle, Target, type LucideIcon } from 'lucide-react';
import type { MoveKey } from '@/lib/avm/valueAdd/types';

/** Moves owners tend to *assume* add value — the interesting ones when they don't. */
const ASSUMED_GOOD = new Set<MoveKey>([
  'finish_basement',
  'build_garage',
  'legal_suite',
  'interior_excellent',
  'build_addition',
]);
/** Cheap, high-ROI moves owners tend to overlook — the "secret" winners. */
const OVERLOOKED = new Set<MoveKey>(['add_parking', 'curb_appeal', 'add_bathroom']);

/** The minimal move shape the insight/decode helpers need (a subset of the display move). */
export interface RenoMoveLike {
  key: string;
  label: string;
  paybackRatio?: number;
  valueAddTyp?: number;
  costLow: number;
  costHigh: number;
  recommended?: boolean;
}

export type RoiTier = 'strong' | 'good' | 'weak' | 'poor';

/** Payback multiple → coarse tier. ≥1 pays back; <1 loses money at resale. */
export function roiTier(r: number): RoiTier {
  if (r >= 2) return 'strong';
  if (r >= 1) return 'good';
  if (r >= 0.5) return 'weak';
  return 'poor';
}

export function roiCents(r: number): number {
  return Math.round(r * 100);
}

/** Plain-language decode of the multiple — legible to a non-investor. */
export function roiDecode(r: number): string {
  if (r >= 1) return `Every $1 you spend adds about $${r.toFixed(2)} in resale value.`;
  return `You recover only about ${roiCents(r)}¢ of every $1 when you sell.`;
}

export interface MoveFlag {
  label: string;
  tone: 'overlooked' | 'weak';
}

/** A small "counter-intuitive" chip for a move, or null when it's unremarkable. */
export function moveFlag(m: RenoMoveLike): MoveFlag | null {
  const r = m.paybackRatio;
  if (!Number.isFinite(r)) return null;
  const key = m.key as MoveKey;
  if (r! >= 1.8 && OVERLOOKED.has(key)) return { label: 'Overlooked', tone: 'overlooked' };
  if (r! < 1 && key === 'legal_suite') return { label: 'Rent play, not resale', tone: 'weak' };
  if (r! < 1 && ASSUMED_GOOD.has(key)) return { label: 'Rarely pays back here', tone: 'weak' };
  return null;
}

export interface RenoInsight {
  kicker: string;
  icon: LucideIcon;
  tone: 'good' | 'watch' | 'neutral';
  headline: string;
  detail: string;
}

/**
 * Up to three "secrets" pulled from the ranked moves: the best-kept winner, the
 * popular-but-weak trap, and the real lesson (concentration beats spend). Each
 * references a distinct move so the strip never repeats itself.
 */
export function deriveRenoInsights(moves: RenoMoveLike[]): RenoInsight[] {
  const priced = moves.filter((m) => Number.isFinite(m.paybackRatio));
  if (priced.length === 0) return [];

  const byPayback = [...priced].sort((a, b) => b.paybackRatio! - a.paybackRatio!);
  const winner = byPayback[0];
  const out: RenoInsight[] = [];

  // 1 — the winner (or, if nothing pays back, an honest "temper expectations").
  if (winner.paybackRatio! >= 1) {
    const overlooked = OVERLOOKED.has(winner.key as MoveKey);
    out.push({
      kicker: overlooked ? 'Most-overlooked win' : 'Best-kept secret',
      icon: Sparkles,
      tone: 'good',
      headline: `${winner.label} pays back ${winner.paybackRatio!.toFixed(1)}×`,
      detail: overlooked
        ? `The highest return of any move here — and the one most owners never think of. ${roiDecode(winner.paybackRatio!)}`
        : `The strongest payback of any move in this area. ${roiDecode(winner.paybackRatio!)}`,
    });
  } else {
    out.push({
      kicker: 'The honest read',
      icon: AlertTriangle,
      tone: 'watch',
      headline: `Even the best move here returns only ${winner.paybackRatio!.toFixed(1)}×`,
      detail:
        'Right now, renovations in this area recover less than they cost at resale. Spend for how you’ll live in the home, not for the sale price.',
    });
  }

  // 2 — the trap: a "sure thing" that quietly loses money (lowest payback among them).
  const traps = byPayback.filter(
    (m) => ASSUMED_GOOD.has(m.key as MoveKey) && m.paybackRatio! < 1 && m.key !== winner.key,
  );
  const trap = traps.length ? traps[traps.length - 1] : null;
  if (trap) {
    const isSuite = trap.key === 'legal_suite';
    out.push({
      kicker: 'Don’t be fooled',
      icon: AlertTriangle,
      tone: 'watch',
      headline: `${trap.label} returns just ${trap.paybackRatio!.toFixed(1)}×`,
      detail: isSuite
        ? `You recover about ${roiCents(trap.paybackRatio!)}¢ per $1 at resale — the rent it earns is the real payoff, not the sale price.`
        : `It feels like a sure thing, but you get back only about ${roiCents(trap.paybackRatio!)}¢ of every $1 when you sell.`,
    });
  }

  // 3 — the real lesson: where you spend beats how much (only if there's a real split).
  const winners = priced.filter((m) => m.paybackRatio! >= 1);
  const losers = priced.filter((m) => m.paybackRatio! < 1);
  if (winners.length > 0 && losers.length > 0 && out.length < 3) {
    out.push({
      kicker: 'The real lesson',
      icon: Target,
      tone: 'neutral',
      headline: 'Where you spend beats how much',
      detail: `${winners.length} ${winners.length === 1 ? 'move' : 'moves'} here pay you back; ${losers.length} quietly ${
        losers.length === 1 ? 'loses' : 'lose'
      } money at resale. Picking the right few matters more than spending big.`,
    });
  }

  return out.slice(0, 3);
}
