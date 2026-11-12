/**
 * nonHomeFromAddress — catch a parking spot or storage unit that the listing agent filed
 * as a home (2026-11).
 *
 * Seen 2026-11-12: 13 active listings say "Parking" or "Storage" in the address but carry
 * a home subtype, e.g. "1 Gloucester Street 2 Parking Tandem" filed as a 3-bedroom
 * Condo Apartment at $150,000, or "57 St Joseph Street PARKING SPOT" for lease at $230.
 * The home filters exclude only the 'Parking Space' / 'Locker' subtypes, so these rows
 * reached home lists, boards and condo medians.
 *
 * The rule reads only the first address line (before the first comma), and skips a word
 * that is part of the street name ("5 Locker Drive" is a house).
 */

export type NonHomeSubtype = "Parking Space" | "Locker";

const STREET_SUFFIX =
  "(?:drive|dr|street|st|road|rd|avenue|ave|crescent|cres|court|ct|lane|ln|way|boulevard|blvd|place|pl|circle|cir|trail|trl|terrace|terr|square|sq|gate|gardens|gdns|parkway|pkwy|line|sideroad|hill|heights|hts|grove|mews|path|row)\\b";
const word = (w: string) => new RegExp(`\\b${w}\\b(?!\\s+${STREET_SUFFIX})`, "i");

const PARKING = word("parking");
const STORAGE = word("(?:locker|storage)");

/** The subtype a mislabelled row really is, or null when the address gives no sign. */
export function nonHomeFromAddress(
  unparsedAddress: string | null | undefined,
  propertySubType: string | null | undefined,
  propertyType?: string | null
): NonHomeSubtype | null {
  if (propertySubType === "Parking Space" || propertySubType === "Locker") return null;
  // Commercial rows ("Outside Storage" on an office lease) are excluded from home lists
  // by PropertyType already, and the storage is part of a business lease, not a locker.
  if (propertyType === "Commercial") return null;
  const line = String(unparsedAddress ?? "").split(",")[0];
  if (PARKING.test(line)) return "Parking Space";
  if (STORAGE.test(line)) return "Locker";
  return null;
}

/** The subtype to index: the feed's value, unless the address shows it is not a home. */
export function indexSubtype(
  unparsedAddress: string | null | undefined,
  propertySubType: string | null | undefined,
  propertyType?: string | null
): string {
  return nonHomeFromAddress(unparsedAddress, propertySubType, propertyType) ?? (propertySubType || "");
}
