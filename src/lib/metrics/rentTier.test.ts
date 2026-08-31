import { describe, it, expect } from 'vitest';
import { rentTierConfidence, rentTierLabel, rentTierExplainer, rentProvenanceNote } from './rentTier';

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
    for (const t of ['nbhd', 'city_bath', 'city', 'city_family', 'county']) {
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
