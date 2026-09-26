import { describe, it, expect } from 'vitest';
import {
  rentTierConfidence, rentTierLabel, rentTierExplainer, rentProvenanceNote,
  rentDispersion, readRentDispersion, rentSpreadTooWide, rentWithheldExplainer,
  RENT_DISPERSION_CEILING,
} from './rentTier';

describe('rentTierConfidence', () => {
  it('treats the two bath-matched rungs as property-level comps', () => {
    // 5.56% and 8.22% median error respectively.
    expect(rentTierConfidence('nbhd')).toBe('comp');
    expect(rentTierConfidence('city_bath')).toBe('comp');
  });

  it('treats every relaxed rung as an area figure', () => {
    // All three sit at 13-15% median error with a p90 above 42%.
    expect(rentTierConfidence('city')).toBe('area');
    expect(rentTierConfidence('city_family')).toBe('area');
    expect(rentTierConfidence('county')).toBe('area');
  });

  it('demotes the PRE-EXISTING city rung, not only the two added in 124', () => {
    // `city` has been served next to a neighbourhood-grade comp on ~14,883 listings
    // since long before the fallback rungs existed. It is an area figure too.
    expect(rentTierConfidence('city')).not.toBe('comp');
  });

  it('reports none when no rung answered', () => {
    expect(rentTierConfidence(null)).toBe('none');
    expect(rentTierConfidence(undefined)).toBe('none');
    expect(rentTierConfidence('')).toBe('none');
  });

  it('treats an unrecognised rung as unusable rather than guessing', () => {
    // A new rung added upstream must not silently inherit comp-grade presentation.
    expect(rentTierConfidence('some_future_rung')).toBe('none');
  });
});

describe('rentTier labels', () => {
  it('names every rung', () => {
    for (const t of [
      'nbhd_size', 'city_bath_size', 'city_size',
      'nbhd', 'city_bath', 'city', 'city_family', 'county',
    ]) {
      expect(rentTierLabel(t)).toBeTruthy();
      expect(rentTierExplainer(t)).toBeTruthy();
    }
  });

  it('returns null for no rung, so a caller renders nothing rather than "unknown"', () => {
    expect(rentTierLabel(null)).toBeNull();
    expect(rentTierExplainer('')).toBeNull();
  });

  it('explains area rungs in plain language, without insider terms', () => {
    for (const t of ['city', 'city_family', 'county']) {
      const e = rentTierExplainer(t)!;
      expect(e).toMatch(/city-wide|regional/i);      // says what it actually is
      expect(e).not.toMatch(/cohort|rung|tier|comp\b/i); // no internal vocabulary
    }
  });
});

describe('rentProvenanceNote', () => {
  it('states the count and the kind together', () => {
    expect(rentProvenanceNote({ basis: 'closed_12', sampleCount: 24 }))
      .toBe('Based on 24 signed leases from the past year.');
    expect(rentProvenanceNote({ basis: 'closed_24', sampleCount: 7 }))
      .toBe('Based on 7 signed leases from the past two years.');
    expect(rentProvenanceNote({ basis: 'asking', sampleCount: 12 }))
      .toBe('Based on 12 current asking rents.');
  });

  it('agrees in number, so a one-comp cohort does not read as plural', () => {
    expect(rentProvenanceNote({ basis: 'closed_12', sampleCount: 1 }))
      .toBe('Based on 1 signed lease from the past year.');
    expect(rentProvenanceNote({ basis: 'asking', sampleCount: 1 }))
      .toBe('Based on 1 current asking rent.');
    expect(rentProvenanceNote({ sampleCount: 1 })).toBe('Based on 1 comparable rent.');
  });

  it('falls back to whichever half it has', () => {
    expect(rentProvenanceNote({ basis: 'closed_12' })).toBe('Based on signed leases from the past year.');
    expect(rentProvenanceNote({ sampleCount: 9 })).toBe('Based on 9 comparable rents.');
  });

  it('returns null when it knows neither half', () => {
    // An empty provenance line is worse than none: it implies the number has none.
    expect(rentProvenanceNote({})).toBeNull();
    expect(rentProvenanceNote({ basis: null, sampleCount: null })).toBeNull();
  });

  it('treats the transformer sentinels as absent, never as "few"', () => {
    // The document writes '' / 0 where there is no comp, exactly as rent_match_tier
    // does. Reading 0 as a count would publish "Based on 0 comparable rents."
    expect(rentProvenanceNote({ basis: '', sampleCount: 0 })).toBeNull();
    expect(rentProvenanceNote({ basis: 'closed_12', sampleCount: 0 }))
      .toBe('Based on signed leases from the past year.');
  });

  it('ignores a basis this build does not know rather than naming the column', () => {
    expect(rentProvenanceNote({ basis: 'closed_36', sampleCount: 5 }))
      .toBe('Based on 5 comparable rents.');
  });

  it('says nothing a reader needs a glossary for', () => {
    const all = ['closed_12', 'closed_24', 'asking']
      .map((b) => rentProvenanceNote({ basis: b, sampleCount: 5 })!);
    for (const note of all) {
      expect(note).not.toMatch(/cohort|rung|tier|basis|comp_|closed_\d/i);
    }
  });
});


describe('the three size rungs (148) are classified, not ignored', () => {
  // They shipped in 148 but reached NEITHER tier set, so rentTierConfidence() answered
  // 'none' for the rung that serves 68% of listings, and every one of them lost its
  // sandbox label and tooltip. This is the regression test for that.
  it('grades all three as property-level comps', () => {
    expect(rentTierConfidence('nbhd_size')).toBe('comp');
    expect(rentTierConfidence('city_bath_size')).toBe('comp');
    expect(rentTierConfidence('city_size')).toBe('comp');
  });

  it('grades city_size above the rungs that were already comp-grade', () => {
    // Backtested blow-up rate: city_size 2.47%, city_bath 3.00%, nbhd 4.62%. It drops the
    // bath axis, so it LOOKS loosest of the three — the measurement says otherwise.
    expect(rentTierConfidence('city_size')).toBe(rentTierConfidence('city_bath'));
  });

  it('names and explains each one', () => {
    for (const t of ['nbhd_size', 'city_bath_size', 'city_size']) {
      expect(rentTierLabel(t)).toBeTruthy();
      expect(rentTierExplainer(t)).toBeTruthy();
      // Same plain-language bar the other rungs are held to.
      expect(rentTierExplainer(t)).not.toMatch(/cohort|rung|tier|percentile|p\d\d/i);
    }
  });
});

describe('rentDispersion', () => {
  it('reports the interquartile spread as a share of the median', () => {
    expect(rentDispersion(3000, 2700, 3300)).toBeCloseTo(0.2, 6);
    expect(rentDispersion(2000, 2000, 2000)).toBe(0);
  });

  it('returns null when the quartiles are unknown, so the gate stays OFF', () => {
    // Every row written before 150 carries NULL quartiles. Null must mean "do not flag",
    // never "wide" — a gate that failed closed would blank the cap rate site-wide the
    // moment these columns went missing, which is the 148 failure wearing a new coat.
    expect(rentDispersion(3000, null, null)).toBeNull();
    expect(rentDispersion(3000, 2700, null)).toBeNull();
    expect(rentDispersion(3000, undefined, 3300)).toBeNull();
  });

  it('returns null rather than a negative spread when the quartiles are transposed', () => {
    expect(rentDispersion(3000, 3300, 2700)).toBeNull();
  });

  it('returns null on a missing or non-positive median', () => {
    expect(rentDispersion(0, 100, 200)).toBeNull();
    expect(rentDispersion(null, 100, 200)).toBeNull();
  });
});

describe('readRentDispersion decodes the document sentinel', () => {
  it('reads -1 as unknown, not as a tight cohort', () => {
    // 0 is a REAL reading and the best one there is. If -1 leaked through as a number the
    // gate would read every pre-150 document as maximally reliable.
    expect(readRentDispersion(-1)).toBeNull();
    expect(readRentDispersion(0)).toBe(0);
  });

  it('reads absent and non-finite values as unknown', () => {
    expect(readRentDispersion(undefined)).toBeNull();
    expect(readRentDispersion(null)).toBeNull();
    expect(readRentDispersion(Number.NaN)).toBeNull();
  });
});

describe('rentTierConfidence with a cohort spread (150)', () => {
  const wide = RENT_DISPERSION_CEILING + 0.01;
  const tight = RENT_DISPERSION_CEILING - 0.01;

  it('withholds a close rung whose own rents disagree too much', () => {
    // 18.1% of these answers are more than 50% wrong, against 0.87% elsewhere.
    expect(rentTierConfidence('nbhd_size', wide)).toBe('wide');
    expect(rentTierConfidence('nbhd', wide)).toBe('wide');
    expect(rentTierConfidence('city', wide)).toBe('wide');
  });

  it('keeps the pre-150 answer for a tight cohort', () => {
    expect(rentTierConfidence('nbhd_size', tight)).toBe('comp');
    expect(rentTierConfidence('county', tight)).toBe('area');
  });

  it('is exclusive at the ceiling, so the measured boundary is the retained side', () => {
    // The backtest measured "> 0.5" as the flagged population. Exactly 0.5 is kept.
    expect(rentTierConfidence('nbhd', RENT_DISPERSION_CEILING)).toBe('comp');
  });

  it('behaves exactly as before when the spread is unknown', () => {
    // This is what makes the change safe to deploy BEFORE the index carries quartiles.
    for (const tier of ['nbhd_size', 'nbhd', 'city_bath', 'city', 'city_family', 'county']) {
      expect(rentTierConfidence(tier, null)).toBe(rentTierConfidence(tier));
      expect(rentTierConfidence(tier, undefined)).toBe(rentTierConfidence(tier));
    }
  });

  it('does not promote an unknown rung to wide', () => {
    // 'wide' claims we measured this cohort's spread and found it too broad. An
    // unrecognised rung is unusable for a different reason and must keep saying so.
    expect(rentTierConfidence('some_future_rung', wide)).toBe('none');
    expect(rentTierConfidence(null, wide)).toBe('none');
  });
});

describe('rentSpreadTooWide', () => {
  it('withholds only the population the backtest measured', () => {
    expect(rentSpreadTooWide('wide')).toBe(true);
    expect(rentSpreadTooWide('comp')).toBe(false);
    expect(rentSpreadTooWide('area')).toBe(false);
  });

  it('does NOT withhold on a missing rung', () => {
    // `rent_match_tier` is absent on any document not re-transformed since 124, and those
    // carry a working cap_rate_est. Treating 'none' as a reason to hide would blank a good
    // figure on every stale document — a regression the measurement never asked for, and
    // the one compareMetricsConfig.test.ts caught when this gate was first written.
    expect(rentSpreadTooWide('none')).toBe(false);
  });
});

describe('rentWithheldExplainer', () => {
  it('distinguishes "nothing to compare" from "the comps contradict each other"', () => {
    const wide = rentWithheldExplainer('wide')!;
    const none = rentWithheldExplainer('none')!;
    expect(wide).toBeTruthy();
    expect(none).toBeTruthy();
    expect(wide).not.toBe(none);
  });

  it('says nothing where a figure IS published', () => {
    expect(rentWithheldExplainer('comp')).toBeNull();
    expect(rentWithheldExplainer('area')).toBeNull();
  });

  it('never quotes a spread the reader could average back into an estimate', () => {
    for (const c of ['wide', 'none'] as const) {
      const note = rentWithheldExplainer(c)!;
      expect(note).not.toMatch(/cohort|rung|tier|percentile|p25|p75|0\.\d/i);
      expect(note).not.toMatch(/\$/);
    }
  });
});
