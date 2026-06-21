import { describe, expect, it } from "vitest";
import {
  slugify,
  buildListingPath,
  extractListingKey,
  deslugCity,
  cityHubSlug,
  cityHubResolves,
} from "./listingPath";

describe("slugify", () => {
  it("lowercases and dash-collapses", () => {
    expect(slugify("3380 Singleton Avenue 107")).toBe("3380-singleton-avenue-107");
  });
  it("strips punctuation and unit symbols", () => {
    expect(slugify("100 King St. W, Unit #5B")).toBe("100-king-st-w-unit-5b");
  });
  it("folds diacritics", () => {
    expect(slugify("Rue Beauprésent")).toBe("rue-beaupresent");
  });
  it("trims and collapses dash runs", () => {
    expect(slugify("  --Lake   Shore-- ")).toBe("lake-shore");
  });
});

describe("buildListingPath", () => {
  it("builds the canonical descriptive path", () => {
    expect(
      buildListingPath({
        ListingKey: "X12639568",
        UnparsedAddress: "3380 Singleton Avenue 107",
        City: "London",
        StateOrProvince: "ON",
      }),
    ).toBe("/property/on/london/3380-singleton-avenue-107-X12639568");
  });

  it("uppercases a lowercase key", () => {
    expect(
      buildListingPath({ ListingKey: "x12639568", UnparsedAddress: "1 A St", City: "London" }),
    ).toBe("/property/on/london/1-a-st-X12639568");
  });

  it("returns null without a valid ListingKey (the only un-synthesizable field)", () => {
    expect(buildListingPath({ ListingKey: "", City: "London" })).toBeNull();
    expect(buildListingPath({ ListingKey: "NOTAKEY", City: "London" })).toBeNull();
    expect(buildListingPath({ City: "London" })).toBeNull();
  });

  it("falls back safely when city/address are missing (still unique via key)", () => {
    expect(buildListingPath({ ListingKey: "W1234567" })).toBe("/property/on/on/W1234567");
  });

  it("defaults province to ON", () => {
    const path = buildListingPath({ ListingKey: "C2345678", City: "Toronto", UnparsedAddress: "5 Bay St" });
    expect(path).toBe("/property/on/toronto/5-bay-st-C2345678");
  });

  it("prefers structured street fields AND strips the TRREB district code from Toronto", () => {
    expect(
      buildListingPath({
        ListingKey: "C12893986",
        StreetNumber: "31",
        StreetName: "Tippett",
        StreetSuffix: "Rd",
        UnitNumber: "607",
        UnparsedAddress: "31 Tippett Rd 607 Toronto C06 ON M3H 0C8",
        City: "Toronto C06",
        StateOrProvince: "ON",
      }),
    ).toBe("/property/on/toronto/31-tippett-rd-607-C12893986");
  });

  it("strips C/E/W Toronto district codes but leaves other cities untouched", () => {
    expect(buildListingPath({ ListingKey: "E1234567", City: "Toronto E04", UnparsedAddress: "9 Foo Ave" }))
      .toBe("/property/on/toronto/9-foo-ave-E1234567");
    expect(buildListingPath({ ListingKey: "W7654321", City: "Toronto W01", UnparsedAddress: "9 Foo Ave" }))
      .toBe("/property/on/toronto/9-foo-ave-W7654321");
    // No code → unchanged (and not a false-positive strip).
    expect(buildListingPath({ ListingKey: "X2223334", City: "Brampton", UnparsedAddress: "9 Foo Ave" }))
      .toBe("/property/on/brampton/9-foo-ave-X2223334");
  });

  it("falls back to the street portion (before the first comma) of UnparsedAddress", () => {
    expect(
      buildListingPath({
        ListingKey: "W7654321",
        UnparsedAddress: "12 Main St, Brampton, ON L6Y 1A1",
        City: "Brampton",
      }),
    ).toBe("/property/on/brampton/12-main-st-W7654321");
  });
});

describe("extractListingKey", () => {
  it("pulls the key from a catch-all segment array", () => {
    expect(extractListingKey(["on", "london", "3380-singleton-avenue-107-X12639568"])).toBe(
      "X12639568",
    );
  });
  it("pulls the key from a raw last segment", () => {
    expect(extractListingKey("5-bay-st-C2345678")).toBe("C2345678");
  });
  it("handles a key-only segment (no descriptive prefix)", () => {
    expect(extractListingKey(["on", "on", "W1234567"])).toBe("W1234567");
  });
  it("is case-insensitive and canonicalizes to uppercase", () => {
    expect(extractListingKey("foo-x12639568")).toBe("X12639568");
  });
  it("returns null when no key is present", () => {
    expect(extractListingKey("just-an-address")).toBeNull();
    expect(extractListingKey([])).toBeNull();
    expect(extractListingKey("")).toBeNull();
  });
});

describe("city hub slug round-trip", () => {
  it("deslugCity title-cases dash-separated slugs", () => {
    expect(deslugCity("mississauga")).toBe("Mississauga");
    expect(deslugCity("richmond-hill")).toBe("Richmond Hill");
  });

  it("cityHubSlug strips Toronto district codes and directional area suffixes", () => {
    expect(cityHubSlug("Mississauga")).toBe("mississauga");
    expect(cityHubSlug("Toronto C06")).toBe("toronto");
    expect(cityHubSlug("London South")).toBe("london"); // directional suffix stripped
    expect(cityHubSlug("Richmond Hill")).toBe("richmond-hill"); // "Hill" is not directional
  });

  it("cityHubResolves for any city with a non-empty hub slug (district-split included)", () => {
    expect(cityHubResolves("Mississauga")).toBe(true);
    expect(cityHubResolves("Toronto C06")).toBe(true); // → /property/on/toronto (facet-grouped, 2b-ii)
    expect(cityHubResolves("St. Catharines")).toBe(true); // → /property/on/st-catharines
    expect(cityHubResolves("")).toBe(false);
    expect(cityHubResolves("   ")).toBe(false);
  });
});
