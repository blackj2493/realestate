// src/lib/reno/insights.ts
//
// Per-move decoders for the renovation result's ranked cards: the payback tier, the
// plain-language reading of the multiple, and the counter-intuitive chip.
//
// The 3-card "what the sales quietly tell you" strip these once also fed was removed —
// it restated the cards verbatim (same multiple, same decode, same winner and loser) at
// about a screen of extra height.
//
// DETERMINISTIC only (no AI — CLAUDE.md §4). Everything here is derived from the
// numeric moves the engine already returned; nothing new is inferred from VOW data.

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
