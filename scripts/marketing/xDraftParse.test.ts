import { describe, it, expect } from 'vitest';
import { parseXDrafts, unquote } from './xDraftParse';

/**
 * Trimmed from the real content-queue/2026-09-06.md so the fixture is the routine's
 * actual output, not a guess at it. If ROUTINE.md changes shape this test is the thing
 * that should go red — the delivery silently sending nothing is the failure to avoid.
 */
const FIXTURE = `# Content drafts — 2026-09-06

## ⭐ Post this one today

**Platform: X (single chart).** Today's most surprising angle.

## Angle 1 — Whitby price cuts

- **Figure (verbatim):** \`32%\` — 32% of active Whitby listings have cut their asking price
- **Region:** Whitby · **Sample:** n=454
- **Source URL:** https://www.pureproperty.ca/data/price-cuts

### (a) Reddit — r/TorontoRealEstate

**Title:** Whitby has the highest price-cut share.

### (b) X — single chart

**Chart spec**

- **Capture:** \`https://www.pureproperty.ca/data/price-cuts\`, sorted descending.
- **Highlight:** Whitby's \`32%\` cell.

**Post text**

> 32% of active Whitby listings have already cut their asking price (n=454).
>
> Cut = share of listings that dropped their ask, not a same-home price change.
>
> pureproperty.ca/data/price-cuts

**Alt text**

> Table of Ontario markets ranked by share of active listings that have cut their ask.

*Self-score: 86/100 — this is also the ⭐ pick.*

### (c) Video (9:16)

Hook in three seconds.

## Angle 2 — Richmond Hill days on market

- **Figure (verbatim):** \`41 days\` — median time to sell
- **Source URL:** https://www.pureproperty.ca/data/days-on-market

### (a) Reddit — r/TorontoRealEstate

**Title:** Richmond Hill is slow.

### (b) X — thread

**Post text**

> Richmond Hill homes now take 41 days to sell.

**Alt text**

> Chart of median days on market.

### (c) Video (9:16)

Something.

## Anomaly note

LinkedIn rotation does not come up today.
`;

describe('parseXDrafts', () => {
  const { drafts, warnings } = parseXDrafts(FIXTURE);

  it('finds one draft per angle and no others', () => {
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.angle)).toEqual([1, 2]);
    expect(drafts[0].title).toBe('Whitby price cuts');
    expect(warnings).toEqual([]);
  });

  it('reproduces the post VERBATIM, line breaks and all', () => {
    // ROUTINE.md's first hard rule is that figures are cited exactly as given. Reflowing
    // or re-wrapping here would edit the number on its way to the operator.
    expect(drafts[0].post).toBe(
      '32% of active Whitby listings have already cut their asking price (n=454).\n\n' +
        'Cut = share of listings that dropped their ask, not a same-home price change.\n\n' +
        'pureproperty.ca/data/price-cuts',
    );
  });

  it('does not let the Reddit or Video section bleed into the X one', () => {
    expect(drafts[0].post).not.toContain('Hook in three seconds');
    expect(drafts[0].post).not.toContain('highest price-cut share');
    expect(drafts[0].altText).not.toContain('Hook in three seconds');
  });

  it('keeps the chart spec, and stops it at the next label', () => {
    expect(drafts[0].chartSpec).toContain('**Capture:**');
    expect(drafts[0].chartSpec).toContain("Whitby's `32%` cell.");
    expect(drafts[0].chartSpec).not.toContain('Post text');
  });

  it('carries the angle header fields through', () => {
    expect(drafts[0].figure).toContain('32%');
    expect(drafts[0].sourceUrl).toBe('https://www.pureproperty.ca/data/price-cuts');
    expect(drafts[1].sourceUrl).toBe('https://www.pureproperty.ca/data/days-on-market');
  });

  it('reads the heading label, including the documented thread exception', () => {
    expect(drafts[0].format).toBe('single chart');
    expect(drafts[1].format).toBe('thread');
  });

  it('returns the routine pick block verbatim rather than guessing an angle', () => {
    const { pick } = parseXDrafts(FIXTURE);
    expect(pick).toContain("**Platform: X (single chart).** Today's most surprising angle.");
    expect(pick).not.toContain('## Angle 1');
  });

  it('survives an angle with no chart spec', () => {
    expect(drafts[1].chartSpec).toBeNull();
    expect(drafts[1].post).toBe('Richmond Hill homes now take 41 days to sell.');
  });
});

describe('parseXDrafts — drift is reported, never silent', () => {
  it('warns when the file has no angles at all', () => {
    const { drafts, warnings } = parseXDrafts('# Nothing here\n\nSome prose.\n');
    expect(drafts).toEqual([]);
    expect(warnings.join(" ")).toMatch(/No "## Angle/);
  });

  it('warns about an angle whose X section is missing', () => {
    const md = '## Angle 1 — Solo\n\n### (a) Reddit — r/x\n\nBody.\n';
    const { drafts, warnings } = parseXDrafts(md);
    expect(drafts).toEqual([]);
    expect(warnings.join(" ")).toMatch(/no X section/);
  });

  it('warns about an X section with no post text, but still returns the angle', () => {
    const md = '## Angle 1 — Solo\n\n### (b) X — single chart\n\n**Chart spec**\n\n- Capture something.\n';
    const { drafts, warnings } = parseXDrafts(md);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].post).toBeNull();
    expect(drafts[0].chartSpec).toContain('Capture something.');
    expect(warnings.join(" ")).toMatch(/no post text/);
  });

  it('does not care which letter the routine gives the X section', () => {
    const md = '## Angle 1 — Solo\n\n### (d) X — single chart\n\n**Post text**\n\n> Hello.\n';
    expect(parseXDrafts(md).drafts[0].post).toBe('Hello.');
  });
});

describe('unquote', () => {
  it('strips markers, keeps blank lines, and collapses runs', () => {
    expect(unquote('> one\n>\n> two')).toBe('one\n\ntwo');
  });

  it('leaves an unquoted line alone', () => {
    expect(unquote('plain')).toBe('plain');
  });
});

/**
 * The 2026-09-07 shape, one day after the fixture above and materially different: bare
 * `### (b) X`, colons inside every label, bullets with no blank line after the marker,
 * and an angle title that is the whole claim. Both are the same routine.
 */
const FIXTURE_0907 = `# Content drafts — 2026-09-07

## ⭐ Post this one today

**Platform: X.** Whitby at 2.8 months of supply.

## Angle 1 — Brampton: 32% of active listings have cut their price

- **Figure (verbatim):** \`32%\`
- **Source URL:** https://www.pureproperty.ca/data/price-cuts

### (a) Reddit — r/TorontoRealEstate

**Title:** 32% of active Brampton listings have cut.

### (b) X

**Chart spec:**
- **Capture:** \`https://www.pureproperty.ca/data/price-cuts\` — ranking view.
- **Watermark:** \`pureproperty.ca/data/price-cuts\`, bottom-right, small.

**Post text:**

> 32% of active Brampton listings have already cut their asking price.
>
> Typical reduction: 7.9%.

**Alt text:**

> Ranking of 15 Ontario markets by share of active listings that cut their ask.

**Self-score: 80/100.** Clean chart-first post.

### (c) Video (9:16)

Hook.
`;

describe('parseXDrafts — the 2026-09-07 shape parses too', () => {
  const { pick, drafts, warnings } = parseXDrafts(FIXTURE_0907);

  it('handles a bare "### (b) X" heading without eating the next paragraph', () => {
    expect(drafts).toHaveLength(1);
    // The bug this pins: `\s*` in the heading regex crossed newlines and captured
    // `**Chart spec:**` as the format.
    expect(drafts[0].format).toBe('');
    expect(warnings).toEqual([]);
  });

  it('accepts labels written with a colon', () => {
    expect(drafts[0].post).toBe(
      '32% of active Brampton listings have already cut their asking price.\n\n' +
        'Typical reduction: 7.9%.',
    );
    expect(drafts[0].altText).toMatch(/^Ranking of 15 Ontario markets/);
  });

  it('takes chart-spec bullets that start on the very next line', () => {
    expect(drafts[0].chartSpec).toContain('**Capture:**');
    expect(drafts[0].chartSpec).toContain('**Watermark:**');
    expect(drafts[0].chartSpec).not.toContain('Post text');
  });

  it('keeps a long claim-style angle title intact', () => {
    expect(drafts[0].title).toBe('Brampton: 32% of active listings have cut their price');
  });

  it('still finds the pick block', () => {
    expect(pick).toContain('Whitby at 2.8 months of supply');
  });
});
