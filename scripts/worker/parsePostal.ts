/**
 * Extract a full 6-char Canadian postal code from a free-text address. The VOW
 * `postal_code` column is often just the FSA (e.g. "L4X"), but the full code
 * (e.g. "L4X 2S5") is in the address — geocoding off the full code is block-level
 * accurate, off the FSA it's a town-centroid blob. Takes the LAST match (the postal
 * sits at the end of the address).
 */
const FULL_POSTAL = /([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)/g;
export function parsePostalFromAddress(address: string | null | undefined): string | null {
  const matches = [...(address || '').matchAll(FULL_POSTAL)];
  const m = matches[matches.length - 1];
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}
