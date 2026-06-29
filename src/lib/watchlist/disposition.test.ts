import { describe, expect, it } from "vitest";
import {
  addressesMatch,
  classifyDisposition,
  parseAddress,
  streetNamesMatch,
  type RelistTarget,
} from "./disposition";

describe("parseAddress", () => {
  it("parses a full TRREB address with an N/A unit placeholder", () => {
    expect(parseAddress("127 Via Toscana N/A, Vaughan, ON L4H 3C1")).toEqual({
      streetNumber: "127",
      streetName: "via toscana",
      city: "vaughan",
      postal: "L4H3C1",
    });
  });

  it("parses a plain street address (no unit)", () => {
    expect(parseAddress("2363 Maria Antonia Road, Vaughan, ON L4H 0X5")).toEqual({
      streetNumber: "2363",
      streetName: "maria antonia road",
      city: "vaughan",
      postal: "L4H0X5",
    });
  });

  it("strips an explicit unit/suite token from the street name", () => {
    const p = parseAddress("45 Penbridge Circle Unit 12, Brampton, ON L7A 2R1");
    expect(p.streetNumber).toBe("45");
    expect(p.streetName).toBe("penbridge circle");
    expect(p.postal).toBe("L7A2R1");
  });

  it("keeps a civic number suffix letter", () => {
    expect(parseAddress("12A King St, Toronto, ON M5V 1A1").streetNumber).toBe("12a");
  });

  it("returns empty components for junk / empty input", () => {
    expect(parseAddress("")).toEqual({ streetNumber: "", streetName: "", city: "", postal: "" });
    expect(parseAddress(null)).toEqual({ streetNumber: "", streetName: "", city: "", postal: "" });
  });
});

describe("streetNamesMatch", () => {
  it("matches across a missing/extra street-type suffix", () => {
    expect(streetNamesMatch("via toscana", "via toscana rd")).toBe(true);
    expect(streetNamesMatch("maria antonia road", "maria antonia")).toBe(true);
  });
  it("rejects different streets", () => {
    expect(streetNamesMatch("via toscana", "via roma")).toBe(false);
    expect(streetNamesMatch("", "via toscana")).toBe(false);
  });
});

describe("addressesMatch", () => {
  const saved = parseAddress("127 Via Toscana N/A, Vaughan, ON L4H 3C1");

  it("matches a relist with the same number + postal (street suffix differs)", () => {
    expect(addressesMatch(saved, parseAddress("127 Via Toscana Rd, Vaughan, ON L4H 3C1"))).toBe(true);
  });

  it("matches on number + city + street name when a postal is absent", () => {
    expect(addressesMatch(saved, parseAddress("127 Via Toscana, Vaughan, ON"))).toBe(true);
  });

  it("rejects a different civic number at the same postal", () => {
    expect(addressesMatch(saved, parseAddress("129 Via Toscana, Vaughan, ON L4H 3C1"))).toBe(false);
  });

  it("rejects a matching number at a different postal", () => {
    expect(addressesMatch(saved, parseAddress("127 Via Toscana, Vaughan, ON L4H 9Z9"))).toBe(false);
  });

  it("never matches when a civic number is missing on either side", () => {
    expect(addressesMatch(saved, parseAddress("Via Toscana, Vaughan, ON L4H 3C1"))).toBe(false);
  });
});

describe("classifyDisposition", () => {
  const relist: RelistTarget = { newKey: "N9999999", newPrice: 1750000, newAddress: "127 Via Toscana, Vaughan" };

  it("a confirmed sale is final, even if an active listing coincidentally matches", () => {
    expect(classifyDisposition({ soldDealType: "sold", relist })).toEqual({ kind: "sold" });
  });

  it("a confirmed lease is final", () => {
    expect(classifyDisposition({ soldDealType: "leased", relist: null })).toEqual({ kind: "leased" });
  });

  it("a live relist beats a recorded de-list reason (terminate-then-relist)", () => {
    expect(classifyDisposition({ soldDealType: "terminated", relist })).toEqual({
      kind: "relisted",
      ...relist,
    });
  });

  it("a relist beats an unexplained vanish", () => {
    expect(classifyDisposition({ soldDealType: null, relist })).toEqual({ kind: "relisted", ...relist });
  });

  it("surfaces the specific de-list reason when there is no relist", () => {
    expect(classifyDisposition({ soldDealType: "expired", relist: null })).toEqual({
      kind: "off-market",
      reason: "expired",
    });
  });

  it("falls back to a generic 'gone' when nothing is known", () => {
    expect(classifyDisposition({ soldDealType: null, relist: null })).toEqual({
      kind: "off-market",
      reason: "gone",
    });
  });
});
