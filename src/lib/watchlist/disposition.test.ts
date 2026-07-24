import { describe, expect, it } from "vitest";
import {
  addressesMatch,
  classifyDisposition,
  parseAddress,
  resolveDealType,
  streetNamesMatch,
  streetNamesMatchPrefix,
  vaultTransaction,
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

describe("vaultTransaction", () => {
  it("maps a firm closed sale/lease from the raw MlsStatus", () => {
    expect(vaultTransaction("Sold")).toBe("sold");
    expect(vaultTransaction("Closed Sale")).toBe("sold");
    expect(vaultTransaction("Leased")).toBe("leased");
  });

  it("does NOT treat a Sold Conditional as a firm disposition", () => {
    expect(vaultTransaction("Sold Conditional")).toBeNull();
  });

  it("returns null for de-lists and live statuses", () => {
    for (const s of ["Terminated", "Expired", "Suspended", "New", "Active", "Price Change", "", null, undefined]) {
      expect(vaultTransaction(s)).toBeNull();
    }
  });
});

describe("resolveDealType", () => {
  it("an exact sold_listings sale/lease is final", () => {
    expect(resolveDealType({ exact: "sold", vault: null, addr: "terminated" })).toBe("sold");
    expect(resolveDealType({ exact: "leased", vault: null, addr: null })).toBe("leased");
  });

  it("the saved key's own vault sale beats a terminated predecessor at the address (363 Maria Antonia)", () => {
    // Saved the sold relist (not in sold_listings); the only address record is its
    // terminated predecessor. Vault says Sold → Sold wins.
    expect(resolveDealType({ exact: null, vault: "sold", addr: "terminated" })).toBe("sold");
  });

  it("an address-recovered sale beats a de-list when there is no exact/vault signal", () => {
    expect(resolveDealType({ exact: null, vault: null, addr: "sold" })).toBe("sold");
  });

  it("surfaces the de-list reason only when no transaction is found anywhere", () => {
    expect(resolveDealType({ exact: "terminated", vault: null, addr: null })).toBe("terminated");
    expect(resolveDealType({ exact: null, vault: null, addr: "expired" })).toBe("expired");
    expect(resolveDealType({ exact: null, vault: null, addr: null })).toBeNull();
  });
});

describe("streetNamesMatchPrefix", () => {
  it("matches a mid-keystroke street fragment as a prefix", () => {
    expect(streetNamesMatchPrefix("via to", "via toscana n a")).toBe(true);
    expect(streetNamesMatchPrefix("via toscana", "via toscana n a")).toBe(true);
  });

  it("requires every non-final token to match exactly", () => {
    expect(streetNamesMatchPrefix("vista toscana", "via toscana")).toBe(false);
  });

  it("rejects a fragment of a different street", () => {
    expect(streetNamesMatchPrefix("via tor", "via toscana")).toBe(false);
    expect(streetNamesMatchPrefix("cappamore", "coldstream")).toBe(false);
  });

  it("empty inputs never match", () => {
    expect(streetNamesMatchPrefix("", "via toscana")).toBe(false);
  });
});
