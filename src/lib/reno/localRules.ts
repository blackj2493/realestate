// src/lib/reno/localRules.ts
//
// Static, PUBLIC, NON-VOW eligibility rules for the renovation tool's "what your home
// could become" — Ontario Bill 23 + municipal rules on secondary suites, garden suites
// and units-by-right. Each row carries an `evidence` key so the panel can attach what
// actually happened NEARBY (see reno/eligibilityEvidence): the rule is the permission,
// the evidence is the proof the market acts on it.
//
// Launch markets are all Ontario (GTA + Ottawa), so v1 is province-level with the
// city name surfaced; parcel-specific zoning is a gated fast-follow. NOTHING here
// is derived from VOW listing data — it is all public policy, freely shareable.

/** Which local evidence line (if any) belongs under a rule. */
export type EvidenceKey = 'suite' | 'plex';

export interface EligibilityItem {
  label: string;
  /** Plain area-level status (NOT parcel-specific). */
  status: string;
  evidence?: EvidenceKey;
}

export interface LocalRules {
  cityLabel: string;
  eligibility: EligibilityItem[];
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
    eligibility: [
      { label: 'Basement / secondary suite', status: 'Most homes qualify', evidence: 'suite' },
      { label: 'Garden suite (backyard unit)', status: 'Permitted across Ontario' },
      { label: 'Up to 3–4 units by right', status: 'On most residential lots (Bill 23)', evidence: 'plex' },
    ],
  };
}
