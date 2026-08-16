// src/lib/reno/moveMeta.ts
//
// Static, NON-VOW presentation metadata for each renovation move — an icon, a
// typical timeline, the permit it needs, and a plain "why it tends to pay back"
// line. The dollars (cost, value-add, payback) come from the value-add engine;
// this only decorates the card and never derives anything from VOW listing data.
// Ontario-oriented (launch markets are the GTA + Ottawa).

import {
  Layers,
  KeyRound,
  Bath,
  BedDouble,
  Ruler,
  Sparkles,
  Car,
  Warehouse,
  Trees,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { MoveKey } from '@/lib/avm/valueAdd/types';

export type PermitKind = 'building' | 'plumbing' | 'electrical' | 'none';

export interface MoveMeta {
  /** Icon shown on the move card. */
  icon: LucideIcon;
  /** Typical duration, plain language. */
  timeline: string;
  permit: PermitKind;
  /** Short permit line for the card badge. */
  permitNote: string;
  /** Non-VOW, general reason the move tends to pay back. */
  why: string;
}

export const MOVE_META: Record<MoveKey, MoveMeta> = {
  finish_basement: {
    icon: Layers,
    timeline: '4–6 weeks',
    permit: 'building',
    permitNote: 'Building permit',
    why: 'Adds finished living space — usually the biggest value-add on a home with an unfinished basement.',
  },
  legal_suite: {
    icon: KeyRound,
    timeline: '8–12 weeks',
    permit: 'building',
    permitNote: 'Building + zoning',
    why: 'A legal second unit adds rental income and widens who will buy the home.',
  },
  add_bathroom: {
    icon: Bath,
    timeline: '2–3 weeks',
    permit: 'plumbing',
    permitNote: 'Plumbing permit',
    why: 'Homes with more bathrooms sell at a premium; a 2→3 bath jump is often the sweet spot.',
  },
  add_bedroom: {
    icon: BedDouble,
    timeline: '3–5 weeks',
    permit: 'building',
    permitNote: 'Building permit',
    why: 'An extra bedroom moves a home into a higher size bracket that buyers pay up for.',
  },
  build_addition: {
    icon: Ruler,
    timeline: '3–5 months',
    permit: 'building',
    permitNote: 'Building permit',
    why: 'More square footage is the most direct lift to value — but the priciest and slowest move.',
  },
  interior_excellent: {
    icon: Sparkles,
    timeline: '3–6 weeks',
    permit: 'none',
    permitNote: 'Usually none',
    why: 'A modern kitchen and finishes sell homes — but spending above the neighbourhood norm rarely returns.',
  },
  add_parking: {
    icon: Car,
    timeline: '1–2 weeks',
    permit: 'none',
    permitNote: 'Curb cut may need approval',
    why: 'Off-street parking is a real premium in dense areas where it is scarce.',
  },
  build_garage: {
    icon: Warehouse,
    timeline: '3–6 weeks',
    permit: 'building',
    permitNote: 'Building permit',
    why: 'A garage adds parking plus the storage and weatherproofing buyers value.',
  },
  curb_appeal: {
    icon: Trees,
    timeline: '1–2 weeks',
    permit: 'none',
    permitNote: 'No permit',
    why: 'The cheapest lift on the list — strong first-impression return for a small spend.',
  },
};

/** Safe lookup: unknown keys get a neutral default so the card still renders. */
export function moveMetaFor(key: string): MoveMeta {
  return (
    MOVE_META[key as MoveKey] ?? {
      icon: Wrench,
      timeline: 'Varies',
      permit: 'none',
      permitNote: 'Check locally',
      why: 'A common value-add move for homes in this area.',
    }
  );
}
