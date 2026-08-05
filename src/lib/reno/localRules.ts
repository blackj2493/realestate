// src/lib/reno/localRules.ts
//
// Static, PUBLIC, NON-VOW local guidance for the renovation-upside tool:
//   • permits — what each kind of work needs before you start,
//   • eligibility ("what your home could become") — Ontario Bill 23 + municipal
//     rules on secondary suites, garden suites, and units-by-right,
//   • "don't over-invest" — common cautions.
//
// Launch markets are all Ontario (GTA + Ottawa), so v1 is province-level with the
// city name surfaced; parcel-specific zoning is a gated fast-follow. NOTHING here
// is derived from VOW listing data — it is all public policy, freely shareable.

export interface PermitRule {
  /** The kind of work. */
  work: string;
  /** What it needs. */
  need: string;
}

export interface EligibilityItem {
  label: string;
  /** Plain area-level status (NOT parcel-specific). */
  status: string;
}

export interface LocalRules {
  cityLabel: string;
  permits: PermitRule[];
  permitReviewNote: string;
  eligibility: EligibilityItem[];
  dontOverInvest: string[];
}

/**
 * Local rules for a city. Ontario-wide content today (accurate for every launch
 * market); the city name is surfaced so it reads as local. `city` is the tree
 * city key resolved from the address.
 */
export function localRulesFor(city: string | null | undefined): LocalRules {
  const cityLabel = city?.trim() || 'your area';
  return {
    cityLabel,
    permits: [
      { work: 'Finish basement · add bedroom · addition', need: 'Building permit' },
      { work: 'New or relocated bathroom', need: 'Plumbing permit' },
      { work: 'Any new wiring', need: 'ESA (electrical) permit' },
      { work: 'Kitchen refresh · paint · landscaping', need: 'Usually none' },
    ],
    permitReviewNote: 'Building-permit review typically runs 2–4 weeks in Ontario before work can start.',
    eligibility: [
      { label: 'Basement / secondary suite', status: 'Most homes qualify' },
      { label: 'Garden suite (backyard unit)', status: 'Permitted across Ontario' },
      { label: 'Up to 3–4 units by right', status: 'On most residential lots (Bill 23)' },
    ],
    dontOverInvest: [
      'A pool rarely returns its cost in most Ontario markets.',
      'Luxury finishes above the neighbourhood norm typically return under 50%.',
      'Over-building past the area’s typical size hits a price ceiling.',
    ],
  };
}
