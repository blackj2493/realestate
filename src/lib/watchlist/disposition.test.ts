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
      unit: "",
      city: "vaughan",
      postal: "L4H3C1",
    });
  });

  it("parses a plain street address (no unit)", () => {
    expect(parseAddress("2363 Maria Antonia Road, Vaughan, ON L4H 0X5")).toEqual({
      streetNumber: "2363",
      streetName: "maria antonia road",
      unit: "",
      city: "vaughan",
      postal: "L4H0X5",
    });
  });

  it("strips an explicit unit/suite token from the street name", () => {
    const p = parseAddress("45 Penbridge Circle Unit 12, Brampton, ON L7A 2R1");
    expect(p.streetNumber).toBe("45");
    expect(p.streetName).toBe("penbridge circle");
    expect(p.unit).toBe("12");
    expect(p.postal).toBe("L7A2R1");
  });

  it("keeps a civic number suffix letter", () => {
    expect(parseAddress("12A King St, Toronto, ON M5V 1A1").streetNumber).toBe("12a");
  });

  it("returns empty components for junk / empty input", () => {
    expect(parseAddress("")).toEqual({ streetNumber: "", streetName: "", unit: "", city: "", postal: "" });
    expect(parseAddress(null)).toEqual({ streetNumber: "", streetName: "", unit: "", city: "", postal: "" });
  });
});

describe("parseAddress — unit extraction", () => {
  // The shape TRREB's UnparsedAddress actually uses, and the one that caused the bug:
  // every unit in the block shares "2945" + "L5M 6C1".
  it("reads a trailing bare unit and keeps it out of the street name", () => {
    const p = parseAddress("2945 Thomas Street 86, Mississauga, ON L5M 6C1");
    expect(p.streetNumber).toBe("2945");
    expect(p.streetName).toBe("thomas street");
    expect(p.unit).toBe("86");
  });

  it("reads the Ontario unit-first dash form", () => {
    const p = parseAddress("86-2945 Thomas Street, Mississauga, ON L5M 6C1");
    expect(p.streetNumber).toBe("2945"); // the STREET number, not the unit
    expect(p.streetName).toBe("thomas street");
    expect(p.unit).toBe("86");
  });

  it("reads a hash unit, with or without the dash form", () => {
    expect(parseAddress("2945 Thomas Street #86, Mississauga").unit).toBe("86");
    expect(parseAddress("#1210-395 Square One Drive, Mississauga").unit).toBe("1210");
  });

  it("reads a unit that sits in its own comma part without eating the city", () => {
    const p = parseAddress("2945 Thomas St, Unit 86, Mississauga, ON L5M 6C1");
    expect(p.unit).toBe("86");
    expect(p.city).toBe("mississauga"); // NOT "unit 86"
    expect(p.streetName).toBe("thomas st");
  });

  it("treats every spelling of the same unit as equal", () => {
    const forms = [
      "2945 Thomas Street 86, Mississauga",
      "86-2945 Thomas Street, Mississauga",
      "2945 Thomas Street #86, Mississauga",
      "2945 Thomas Street Unit 86, Mississauga",
      "2945 Thomas Street Apt 086, Mississauga",
      "2945 Thomas St, Suite 86, Mississauga",
    ].map((a) => parseAddress(a).unit);
    expect(new Set(forms)).toEqual(new Set(["86"]));
  });

  it("reads named units (TRREB lease rows)", () => {
    expect(parseAddress("12 Main St Lower, Toronto").unit).toBe("lower");
    expect(parseAddress("12 Main St Bsmt, Toronto").unit).toBe("bsmt");
  });

  it("keeps a letter-suffixed unit distinct from its bare number", () => {
    expect(parseAddress("100 Elm Ave Unit 12A, Toronto").unit).toBe("12a");
    expect(parseAddress("100 Elm Ave Unit 12, Toronto").unit).toBe("12");
  });

  it("reads a unit after a directional", () => {
    const p = parseAddress("100 Bloor St W 501, Toronto, ON M5S 1M4");
    expect(p.unit).toBe("501");
    expect(p.streetName).toBe("bloor st w");
  });

  // The trap: streets that legitimately end in a number. Reading the road number as a
  // unit would split one street into as many "properties" as it has civic numbers.
  it("never reads a numbered ROAD as a unit", () => {
    expect(parseAddress("1234 Highway 7, Vaughan, ON").unit).toBe("");
    expect(parseAddress("1234 Highway 7, Vaughan, ON").streetName).toBe("highway 7");
    expect(parseAddress("5 Concession Road 3, Uxbridge, ON").unit).toBe("");
    expect(parseAddress("980 County Road 27, Innisfil, ON").unit).toBe("");
    expect(parseAddress("77 Regional Road 25, Milton, ON").unit).toBe("");
  });

  it("does not invent a unit from a plain address", () => {
    expect(parseAddress("2363 Maria Antonia Road, Vaughan, ON L4H 0X5").unit).toBe("");
    expect(parseAddress("5467 Planters Wood Court, Mississauga, ON").unit).toBe("");
  });

  it("does not mistake a civic-number letter for a unit", () => {
    const p = parseAddress("12A King St, Toronto, ON M5V 1A1");
    expect(p.streetNumber).toBe("12a");
    expect(p.unit).toBe("");
  });

  it("treats the N/A placeholder as no unit, in every casing", () => {
    expect(parseAddress("127 Via Toscana N/A, Vaughan").unit).toBe("");
    expect(parseAddress("127 Via Toscana n/a, Vaughan").unit).toBe("");
  });
});

describe("addressesMatch — units", () => {
  const mississauga = (s: string) => parseAddress(s);

  // The exact live defect: unit 86's page rendered unit 62's $690,000 close.
  it("REJECTS two different units in the same condo block", () => {
    const u86 = mississauga("2945 Thomas Street 86, Mississauga, ON L5M 6C1");
    const u62 = mississauga("2945 Thomas Street 62, Mississauga, ON L5M 6C1");
    expect(u86.streetNumber).toBe(u62.streetNumber); // same civic number
    expect(u86.postal).toBe(u62.postal); // same postal — nothing else separates them
    expect(addressesMatch(u86, u62)).toBe(false);
  });

  it("matches the same unit written two different ways", () => {
    expect(
      addressesMatch(
        mississauga("2945 Thomas Street 86, Mississauga, ON L5M 6C1"),
        mississauga("86-2945 Thomas St, Mississauga, ON L5M 6C1")
      )
    ).toBe(true);
  });

  it("REJECTS a unit-less address against a unit-ful one (identity unconfirmed)", () => {
    // A building-level query must not adopt one unit's record. Better a blank card than
    // a neighbour's sale price presented as this home's.
    expect(
      addressesMatch(
        mississauga("2945 Thomas Street, Mississauga, ON L5M 6C1"),
        mississauga("2945 Thomas Street 62, Mississauga, ON L5M 6C1")
      )
    ).toBe(false);
  });

  it("still matches two unit-less freehold addresses", () => {
    expect(
      addressesMatch(
        parseAddress("127 Via Toscana N/A, Vaughan, ON L4H 3C1"),
        parseAddress("127 Via Toscana Rd, Vaughan, ON L4H 3C1")
      )
    ).toBe(true);
  });

  it("REJECTS a shared postal + civic number on a different street", () => {
    // The old postal leg returned on postal equality alone and never read the street.
    expect(
      addressesMatch(
        parseAddress("100 Elm Ave, Toronto, ON M5V 1A1"),
        parseAddress("100 Oak Blvd, Toronto, ON M5V 1A1")
      )
    ).toBe(false);
  });

  describe("ignoreUnit (neighbourhood-cohort callers only)", () => {
    const u86 = parseAddress("2945 Thomas Street 86, Mississauga, ON L5M 6C1");
    const u62 = parseAddress("2945 Thomas Street 62, Mississauga, ON L5M 6C1");

    it("matches across units when explicitly asked to", () => {
      expect(addressesMatch(u86, u62, { ignoreUnit: true })).toBe(true);
    });

    it("lets a unit-less query reach the building", () => {
      const building = parseAddress("2945 Thomas Street, Mississauga, ON L5M 6C1");
      expect(addressesMatch(building, u62, { ignoreUnit: true })).toBe(true);
    });

    it("still enforces every other leg — it loosens the unit and nothing else", () => {
      expect(
        addressesMatch(u86, parseAddress("2947 Thomas Street 62, Mississauga, ON L5M 6C1"), { ignoreUnit: true })
      ).toBe(false); // different civic number
      expect(
        addressesMatch(u86, parseAddress("2945 Oak Street 62, Mississauga, ON L5M 6C1"), { ignoreUnit: true })
      ).toBe(false); // different street
      expect(
        addressesMatch(u86, parseAddress("2945 Thomas Street 62, Mississauga, ON L5M 9Z9"), { ignoreUnit: true })
      ).toBe(false); // different postal
    });

    it("defaults to strict — omitting the option never loosens anything", () => {
      expect(addressesMatch(u86, u62)).toBe(false);
      expect(addressesMatch(u86, u62, {})).toBe(false);
      expect(addressesMatch(u86, u62, { ignoreUnit: false })).toBe(false);
    });
  });
});

describe("parseAddress — shapes that must fail CLOSED", () => {
  // Pre-construction rows ("Lot 325-3 Damara Road") carry no real civic address. They
  // parsed to an empty street number before this change too; leaving them unmatchable is
  // the right outcome — a confident match on a lot number would be a guess.
  it("yields no street number for a pre-construction lot address", () => {
    const p = parseAddress("Lot 325-3 Damara Road, Caledon, ON L7C 1Z9");
    expect(p.streetNumber).toBe("");
    expect(addressesMatch(p, parseAddress("3 Damara Road, Caledon, ON L7C 1Z9"))).toBe(false);
  });

  it("reads a leading unit designator before the dash form", () => {
    // This shape previously produced an EMPTY street number, so the property could never
    // match any other record of itself.
    const p = parseAddress("Unit 4 - 19 Maxwell Street E, St. Marys, ON N4X 1A1");
    expect(p.streetNumber).toBe("19");
    expect(p.unit).toBe("4");
    expect(p.streetName).toBe("maxwell street e");
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
