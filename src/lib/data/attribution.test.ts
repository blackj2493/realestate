/**
 * The attribution label is the text that ends up burned into every screenshot of a
 * tracker table, so it is worth a test even though it is four lines of string work.
 * A label carrying `https://www.` reads as a pasted URL rather than a citation, and
 * a trailing slash before `/data` produces a dead double-slash link when someone
 * types it back in.
 */
import { describe, it, expect } from 'vitest';
import { attributionLabel } from '@/lib/data/attribution';

describe('attributionLabel', () => {
  it('drops the protocol and www so it reads as a citation', () => {
    expect(attributionLabel('https://www.pureproperty.ca', 'over-asking')).toBe(
      'pureproperty.ca/data/over-asking',
    );
  });

  it('handles a bare host, http, and a trailing slash', () => {
    expect(attributionLabel('pureproperty.ca', 'rents')).toBe('pureproperty.ca/data/rents');
    expect(attributionLabel('http://pureproperty.ca/', 'rents')).toBe('pureproperty.ca/data/rents');
    expect(attributionLabel('https://www.pureproperty.ca/', 'rents')).toBe(
      'pureproperty.ca/data/rents',
    );
  });

  it('never emits a double slash, which would break a retyped URL', () => {
    for (const site of ['https://www.pureproperty.ca/', 'https://pureproperty.ca', 'pureproperty.ca/']) {
      expect(attributionLabel(site, 'days-on-market')).not.toMatch(/\/\//);
    }
  });

  it('keeps a preview host intact rather than mangling it', () => {
    // Vercel previews set NEXT_PUBLIC_SITE_URL to the deployment host; the label
    // should still be truthful about where the screenshot came from.
    expect(attributionLabel('https://realestate-abc123.vercel.app', 'price-cuts')).toBe(
      'realestate-abc123.vercel.app/data/price-cuts',
    );
  });
});
