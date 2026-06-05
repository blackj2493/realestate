import { describe, it, expect } from 'vitest';
import { parsePostalFromAddress } from './parsePostal';

describe('parsePostalFromAddress', () => {
  it('pulls the full postal from an address', () => {
    expect(parsePostalFromAddress('1860 Burnhamthorpe Road E, Mississauga, ON L4X 2S5')).toBe('L4X 2S5');
    expect(parsePostalFromAddress('23 Chambery Street, Bracebridge, ON P1L 0N4')).toBe('P1L 0N4');
  });
  it('handles no-space and lowercase', () => {
    expect(parsePostalFromAddress('x, ON l4x2s5')).toBe('L4X 2S5');
  });
  it('takes the last match (postal is at the end)', () => {
    expect(parsePostalFromAddress('Unit A1B 2C3 something, ON M5V 1H2')).toBe('M5V 1H2');
  });
  it('returns null when absent', () => {
    expect(parsePostalFromAddress('123 Main St, Toronto, ON')).toBeNull();
    expect(parsePostalFromAddress(null)).toBeNull();
  });
});
