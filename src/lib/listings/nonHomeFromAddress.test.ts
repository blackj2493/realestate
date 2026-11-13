import { describe, expect, it } from "vitest";
import { indexSubtype, nonHomeFromAddress } from "./nonHomeFromAddress";

describe("nonHomeFromAddress", () => {
  it.each([
    ["1 Gloucester Street 2 Parking Tandem, Toronto, ON M4Y 1L8", "Condo Apartment"],
    ["57 ST JOSEPH Street PARKING SPOT, Toronto, ON", "Condo Apartment"],
    ["5180 Yonge Street Parking P4 71, Toronto, ON", "Condo Apartment"],
    ["171 Harbord Street Parking - P1, Toronto, ON", "Detached"],
    ["3115 Boxford Crescent Parking, Mississauga, ON", "Condo Townhouse"],
  ])("finds parking in %s", (addr, sub) => {
    expect(nonHomeFromAddress(addr, sub, "Residential Condo & Other")).toBe("Parking Space");
  });

  it("finds a storage unit", () => {
    expect(nonHomeFromAddress("4299 Second Avenue Storage, Niagara Falls, ON", "Triplex", "Residential Freehold")).toBe("Locker");
  });

  it("skips a street named Locker or Parking", () => {
    expect(nonHomeFromAddress("5 Locker Drive, Ajax, ON", "Detached", "Residential Freehold")).toBeNull();
    expect(nonHomeFromAddress("12 Parking Lane, Ajax, ON", "Detached", "Residential Freehold")).toBeNull();
  });

  it("reads only the first address line", () => {
    expect(nonHomeFromAddress("10 Main Street, Parking, ON", "Detached", "Residential Freehold")).toBeNull();
  });

  it("leaves commercial rows and rows already filed as parking alone", () => {
    expect(nonHomeFromAddress("600 Thornton Road S #4 + Outside Storage, Oshawa", "Office", "Commercial")).toBeNull();
    expect(nonHomeFromAddress("1 Yonge Street Parking", "Parking Space", "Residential Condo & Other")).toBeNull();
  });

  it("leaves a normal home alone", () => {
    expect(indexSubtype("725 Exceller Circle, Newmarket, ON", "Detached", "Residential Freehold")).toBe("Detached");
    expect(indexSubtype("1 Gloucester Street 2 Parking Tandem, Toronto", "Condo Apartment", "Residential Condo & Other")).toBe("Parking Space");
    expect(indexSubtype(null, undefined)).toBe("");
  });
});
