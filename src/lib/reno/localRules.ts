// src/lib/reno/localRules.ts
//
// Static, PUBLIC, NON-VOW local guidance for the renovation-upside tool:
//   • eligibility ("what your home could become") — Ontario Bill 23 + municipal
//     rules on secondary suites, garden suites, and units-by-right,
//   • "don't over-invest" — the FALLBACK cautions, used only when the area's own
//     numbers can't produce specific ones (see deriveCeilingNotes in reno/insights).
//
// The per-work permit table was removed: every move card already carries the permit it
// needs, so the table only restated it in a second place.
//
// Launch markets are all Ontario (GTA + Ottawa), so v1 is province-level with the
// city name surfaced; parcel-specific zoning is a gated fast-follow. NOTHING here
// is derived from VOW listing data — it is all public policy, freely shareable.

export interface EligibilityItem {
  label: string;
  /** Plain area-level status (NOT parcel-specific). */
  status: string;
}

export interface LocalRules {
  cityLabel: string;
  eligibility: EligibilityItem[];
  /** Fallback cautions — only rendered when no area-specific ones could be derived. */
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
