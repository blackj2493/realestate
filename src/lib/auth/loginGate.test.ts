import { describe, it, expect } from "vitest";
import { loginGateFromNext, streetLine, loginCopy } from "./loginGate";

describe("loginGateFromNext", () => {
  it("reads a listing key off the internal and the canonical listing URL", () => {
    expect(loginGateFromNext("/properties/X12639568")).toEqual({
      gate: "listing",
      listingKey: "X12639568",
    });
    expect(
      loginGateFromNext("/property/on/toronto/79-st-clair-avenue-e-202a-1-C10423116")
    ).toEqual({ gate: "listing", listingKey: "C10423116" });
  });

  it("does not mistake a neighbourhood hub for a listing", () => {
    expect(loginGateFromNext("/property/on/hamilton/crerar")).toEqual({ gate: "none" });
  });

  it("reads an address page, with or without a key", () => {
    expect(loginGateFromNext("/address/on/toronto/35-mariner-terrace-139-C11883979")).toEqual({
      gate: "address",
      listingKey: "C11883979",
      city: "Toronto",
    });
    expect(loginGateFromNext("/address/on/richmond-hill/12-some-street")).toEqual({
      gate: "address",
      listingKey: null,
      city: "Richmond Hill",
    });
  });

  it("names the other gated surfaces", () => {
    expect(loginGateFromNext("/properties/compare?ids=A,B")).toEqual({ gate: "compare" });
    expect(loginGateFromNext("/analytics?region=Oakville")).toEqual({ gate: "analytics" });
    expect(loginGateFromNext("/hidden-equity")).toEqual({ gate: "home_value" });
    expect(loginGateFromNext("/avm")).toEqual({ gate: "home_value" });
    expect(loginGateFromNext("/whats-my-home-hiding?community=Leslieville")).toEqual({
      gate: "reno",
    });
  });

  it("treats a missing, unsafe or generic destination as none", () => {
    expect(loginGateFromNext(undefined)).toEqual({ gate: "none" });
    expect(loginGateFromNext("")).toEqual({ gate: "none" });
    expect(loginGateFromNext("//evil.example/properties/X12639568")).toEqual({ gate: "none" });
    expect(loginGateFromNext("https://evil.example")).toEqual({ gate: "none" });
    expect(loginGateFromNext("/dashboard")).toEqual({ gate: "none" });
    expect(loginGateFromNext("/properties")).toEqual({ gate: "none" });
  });
});

describe("streetLine", () => {
  it("keeps the part before the first comma", () => {
    expect(streetLine("35 Mariner Terrace 139, Toronto, ON M5V 3V9")).toBe("35 Mariner Terrace 139");
  });
  it("returns null for anything unusable", () => {
    expect(streetLine(undefined)).toBeNull();
    expect(streetLine("")).toBeNull();
    expect(streetLine(", Toronto")).toBeNull();
  });
});

describe("loginCopy", () => {
  it("names the address when it is known", () => {
    expect(loginCopy({ gate: "address", listingKey: "C1234567", city: "Toronto" }, "35 Mariner Terrace").subheading)
      .toContain("35 Mariner Terrace sold for");
  });
  it("falls back to the city, then to 'this home'", () => {
    expect(loginCopy({ gate: "address", listingKey: null, city: "Oakville" }, null).subheading)
      .toContain("this Oakville home");
    expect(loginCopy({ gate: "listing", listingKey: "X1234567" }, null).subheading).toContain("this home");
  });
  it("never shouts", () => {
    const gates = [
      { gate: "listing", listingKey: "X1234567" },
      { gate: "address", listingKey: null, city: null },
      { gate: "analytics" },
      { gate: "home_value" },
      { gate: "reno" },
      { gate: "compare" },
      { gate: "none" },
    ] as const;
    for (const g of gates) {
      const c = loginCopy(g, null);
      expect(c.heading + c.subheading).not.toContain("!");
    }
  });
});
