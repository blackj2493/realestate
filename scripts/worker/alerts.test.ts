/**
 * alerts.renderDigest — pure email-rendering tests.
 *
 * `main()` is the orchestrator (Supabase + Typesense + Resend); we test
 * renderDigest in isolation because it's the deterministic surface and the
 * one users actually see (subject line, HTML body, plain-text fallback).
 *
 * Intentionally out of scope here: the idempotency dedupe path in main()
 * (`cur.price !== w.last_alerted_price`). That check is inline in main() and
 * would need a small refactor (extract to a pure helper) before it can be
 * tested cleanly — flagged in the Phase 3 wrap-up.
 */

import { describe, it, expect } from 'vitest';
import { renderDigest, type DropAlert } from './alerts';

const ONE_DROP: DropAlert[] = [
  {
    listing_key: 'W12632618',
    address: '40 Rampart Drive',
    city: 'Brampton',
    oldPrice: 1_799_900,
    newPrice: 1_699_900,
    thumb: null,
  },
];

const TWO_DROPS: DropAlert[] = [
  ...ONE_DROP,
  {
    listing_key: 'C9876543',
    address: '88 Yonge Street, Unit 1605',
    city: 'Toronto',
    oldPrice: 925_000,
    newPrice: 875_000,
    thumb: null,
  },
];

describe('renderDigest — subject line', () => {
  it('uses singular "price drop" for one drop', () => {
    expect(renderDigest(ONE_DROP).subject).toBe('1 price drop on your watchlist');
  });

  it('uses plural "price drops" for multiple drops', () => {
    expect(renderDigest(TWO_DROPS).subject).toBe('2 price drops on your watchlist');
  });
});

describe('renderDigest — HTML body', () => {
  it('renders one <tr> per drop', () => {
    const html = renderDigest(TWO_DROPS).html;
    const rowCount = (html.match(/<tr>/g) ?? []).length;
    expect(rowCount).toBe(2);
  });

  it('includes the address, city, and both prices for each drop', () => {
    const { html } = renderDigest(ONE_DROP);
    expect(html).toContain('40 Rampart Drive');
    expect(html).toContain('Brampton');
    expect(html).toContain('$1,799,900');
    expect(html).toContain('$1,699,900');
  });

  it('renders the discount (old - new) as a negative dollar amount', () => {
    const { html } = renderDigest(ONE_DROP);
    expect(html).toContain('−$100,000'); // U+2212 minus sign, en-CA formatting
  });

  it('uses singular "property has" copy for one drop', () => {
    const { html } = renderDigest(ONE_DROP);
    expect(html).toContain('1 of your saved property has');
  });

  it('uses plural "properties have" copy for multiple drops', () => {
    const { html } = renderDigest(TWO_DROPS);
    expect(html).toContain('2 of your saved properties have');
  });

  it('links each property to /properties/{listing_key} on the configured site', () => {
    const { html } = renderDigest(ONE_DROP);
    expect(html).toContain('https://pureproperty.ca/properties/W12632618');
  });

  it('URL-encodes the listing_key (defense against weird MLS keys)', () => {
    const { html } = renderDigest([
      { ...ONE_DROP[0], listing_key: 'odd key/with?chars' },
    ]);
    // encodeURIComponent → %20 for spaces, %2F for /, %3F for ?
    expect(html).toContain('odd%20key%2Fwith%3Fchars');
    expect(html).not.toContain('odd key/with?chars');
  });
});

describe('renderDigest — text body (email client fallback)', () => {
  it('starts with the headline + total count', () => {
    const { text } = renderDigest(TWO_DROPS);
    expect(text.startsWith('Price drops on your watchlist (2):')).toBe(true);
  });

  it('includes a bulleted line per drop with the price delta', () => {
    const { text } = renderDigest(ONE_DROP);
    const lines = text.split('\n');
    const bullet = lines.find((l) => l.startsWith('• '));
    expect(bullet).toBeTruthy();
    expect(bullet).toContain('$1,799,900 -> $1,699,900');
    expect(bullet).toContain('-$100,000');
  });

  it('includes the dashboard link at the end', () => {
    const { text } = renderDigest(ONE_DROP);
    expect(text).toContain('Open your dashboard: https://pureproperty.ca/dashboard');
  });
});

describe('renderDigest — edge cases', () => {
  it('falls back to "Saved property" when the address is empty', () => {
    const { html } = renderDigest([{ ...ONE_DROP[0], address: '' }]);
    expect(html).toContain('Saved property');
  });

  it('rounds non-integer prices for display (no fractional dollars)', () => {
    const { html } = renderDigest([
      { ...ONE_DROP[0], oldPrice: 800_123.4, newPrice: 750_000 },
    ]);
    // Round-half-to-even on $800,123.40 → $800,123; the test asserts no decimal.
    expect(html).toContain('$800,123');
    expect(html).not.toContain('800,123.4');
  });

  it('renders a single sensible row when given exactly one drop (HTML row count)', () => {
    const html = renderDigest(ONE_DROP).html;
    const rowCount = (html.match(/<tr>/g) ?? []).length;
    expect(rowCount).toBe(1);
  });
});
