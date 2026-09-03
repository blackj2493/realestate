import { describe, it, expect } from "vitest";
import { localityMatch, fsaOf, ledgerRowHref } from "./streetLedger";
import { extractListingKey } from "@/lib/listings/listingPath";

const row = (over: Partial<{ listingKey: string; address: string; city: string }> = {}) => ({
  listingKey: "X12639568",
  address: "761 Cappamore Drive",
  city: "Barrhaven",
  ...over,
});

describe("streetLedger locality matching", () => {
  it("regression: geocoder 'Nepean' matches feed 'Barrhaven' via FSA (Cappamore Drive, 2026-07-23)", () => {
    // The profile geocodes to city "Nepean" (K2J 6W3); the VOW feed files the same
    // street's sales under city "Barrhaven" (K2J 6V6). An exact city filter found 0
    // of the street's 10 recorded sales — FSA equality must accept them.
    expect(localityMatch("Nepean", fsaOf("K2J6W3"), "Barrhaven", "", fsaOf("K2J 6V6"))).toBe(true);
  });

  it("accepts exact city and city-prefix matches (Toronto districts, London directionals)", () => {
    expect(localityMatch("Nepean", null, "Nepean", "", null)).toBe(true);
    expect(localityMatch("Toronto", null, "Toronto C01", "", null)).toBe(true);
    expect(localityMatch("London", null, "London South", "", null)).toBe(true);
  });

  it("accepts shared Ottawa-group membership without an FSA", () => {
    expect(localityMatch("Ottawa", null, "Kanata", "", null)).toBe(true);
    expect(localityMatch("Barrhaven", null, "Kanata", "", null)).toBe(true);
  });

  it("rejects the same street name in a different market", () => {
    // "Main Street" exists everywhere — a Hamilton row must not enter an Ottawa ledger.
    expect(localityMatch("Nepean", fsaOf("K2J6W3"), "Hamilton", "", fsaOf("L8P 1A1"))).toBe(false);
    expect(localityMatch("Nepean", null, "Hamilton", "", null)).toBe(false);
  });

  it("fsaOf normalizes and rejects junk", () => {
    expect(fsaOf("K2J 6W3")).toBe("K2J");
    expect(fsaOf("k2j6w3")).toBe("K2J");
    expect(fsaOf("12345")).toBeNull();
    expect(fsaOf(null)).toBeNull();
  });
});

describe("ledgerRowHref", () => {
  it("builds the canonical keyed /address URL from the ROW's own city", () => {
    // Not the subject's city: this street's sales are filed under "Barrhaven" while the
    // profile geocodes to "Nepean" (the regression above). The row's value is the one
    // the record's own canonical URL carries.
    expect(ledgerRowHref(row())).toBe("/address/on/barrhaven/761-cappamore-drive-X12639568");
  });

  it("strips a Toronto district code and folds a directional suffix, as the hub slug does", () => {
    expect(ledgerRowHref(row({ city: "Toronto C06" }))).toBe(
      "/address/on/toronto/761-cappamore-drive-X12639568"
    );
    expect(ledgerRowHref(row({ city: "London South" }))).toBe(
      "/address/on/london/761-cappamore-drive-X12639568"
    );
  });

  it("keeps punctuation-heavy municipalities resolvable", () => {
    expect(ledgerRowHref(row({ city: "St. Catharines" }))).toBe(
      "/address/on/st-catharines/761-cappamore-drive-X12639568"
    );
    expect(ledgerRowHref(row({ city: "Niagara-on-the-Lake" }))).toBe(
      "/address/on/niagara-on-the-lake/761-cappamore-drive-X12639568"
    );
  });

  it("falls back to the province segment when the row carries no city", () => {
    // raw_vow_sold.city is nullable and the fetch coalesces it to "". The key is the only
    // thing the route reads, so a city-less row must still produce a working URL.
    expect(ledgerRowHref(row({ city: "" }))).toBe("/address/on/ontario/761-cappamore-drive-X12639568");
  });

  it("survives a unit number, a comma tail and diacritics in the address", () => {
    expect(ledgerRowHref(row({ address: "3380 Singleton Avenue 107" }))).toBe(
      "/address/on/barrhaven/3380-singleton-avenue-107-X12639568"
    );
    // The fetch already trims at the first comma; if one survives, only the street is used.
    expect(ledgerRowHref(row({ address: "761 Cappamore Drive, Barrhaven, ON" }))).toBe(
      "/address/on/barrhaven/761-cappamore-drive-X12639568"
    );
    expect(ledgerRowHref(row({ address: "12 Rue Beauséjour" }))).toBe(
      "/address/on/barrhaven/12-rue-beausejour-X12639568"
    );
  });

  it("uppercases the key so the URL matches the sitemap's shape", () => {
    expect(ledgerRowHref(row({ listingKey: "x12639568" }))).toBe(
      "/address/on/barrhaven/761-cappamore-drive-X12639568"
    );
  });

  it("refuses to link a key the ROUTE's parser rejects", () => {
    // extractListingKey is what /address/[prov]/[city]/[slug] runs. Anything it returns
    // null for would fall through to the key-less ladder and 404, so it gets no link.
    for (const listingKey of [
      "", // never observed, but String(null) guards produce it
      "12639568", // no board letter
      "X12345", // 5 digits, below the floor
      "X1234567890", // 10 digits, above the ceiling
      "XX12639568", // two leading letters
      "N/A",
    ]) {
      expect(ledgerRowHref(row({ listingKey }))).toBeNull();
    }
  });

  it("does not link the row for the page the reader is already on", () => {
    expect(ledgerRowHref(row(), "X12639568")).toBeNull();
    expect(ledgerRowHref(row(), "x12639568")).toBeNull(); // route param casing is not ours
    expect(ledgerRowHref(row(), " X12639568 ")).toBeNull();
  });

  it("links every other row on the subject's own page", () => {
    expect(ledgerRowHref(row(), "N13485582")).toBe("/address/on/barrhaven/761-cappamore-drive-X12639568");
    // A card with no subject (the key-less /address profile) links everything.
    expect(ledgerRowHref(row(), null)).not.toBeNull();
    expect(ledgerRowHref(row(), undefined)).not.toBeNull();
    // An empty subject key must not silently match a row whose key was also unusable —
    // that pairing returns null on the key check, never on a "" === "" comparison.
    expect(ledgerRowHref(row({ listingKey: "" }), "")).toBeNull();
  });

  it("every URL it emits round-trips back to the same key through the route's parser", () => {
    // The invariant that actually keeps a link live: whatever slug we build, the page
    // must read the original key back out of its last segment.
    for (const over of [
      {},
      { city: "" },
      { city: "Toronto C06" },
      { city: "St. Catharines" },
      { address: "3380 Singleton Avenue 107" },
      { address: "12 Rue Beauséjour" },
      { address: "" }, // slugless: the key becomes the whole segment
      { listingKey: "x12639568" },
    ]) {
      const href = ledgerRowHref(row(over));
      expect(href, JSON.stringify(over)).not.toBeNull();
      const slug = href!.split("/").pop()!;
      expect(extractListingKey(slug), JSON.stringify(over)).toBe("X12639568");
    }
  });
});
