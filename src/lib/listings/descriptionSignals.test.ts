import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_SIGNALS,
  SIGNAL_ORDER,
  descriptionSearchFields,
  detectDescriptionSignals,
  signalForQuery,
} from "./descriptionSignals";

const has = (text: string) => detectDescriptionSignals(text);

describe("detectDescriptionSignals", () => {
  it("finds every spelling of a separate entrance", () => {
    for (const t of [
      "Finished basement with separate entrance and 2nd kitchen.",
      "Sep. side entrance to lower level.",
      "Private side entrance to the basement.",
    ])
      expect(has(t)).toContain("separate_entrance");
  });

  it("tells a basement walk-out from a kitchen door", () => {
    expect(has("Walk-out basement to a deep lot")).toContain("walkout_basement");
    expect(has("Lower level with walkout to yard")).toContain("walkout_basement");
    expect(has("Kitchen with walk-out to deck")).not.toContain("walkout_basement");
  });

  it("separates a legal unit from an informal suite", () => {
    expect(has("Legal basement apartment, registered with the city")).toContain("legal_second_unit");
    expect(has("Basement apartment with separate laundry")).toEqual(
      expect.arrayContaining(["second_suite"])
    );
    expect(has("Basement apartment with separate laundry")).not.toContain("legal_second_unit");
  });

  it("reads tenancy, but not a vacant-possession promise", () => {
    expect(has("Currently rented at $2,400, tenants pay utilities")).toContain("tenanted");
    expect(has("Vacant possession on closing.")).not.toContain("tenanted");
  });

  it("reuses the distress rules, including the real-estate trap", () => {
    expect(has("Power of sale. Sold as is.")).toEqual(["power_of_sale"]);
    expect(has("Estate sale, executor will not provide warranties")).toContain("estate_sale");
    expect(has("Bright home near real estate offices and shops")).toEqual([]);
    expect(has("Handyman special on a 50 ft lot")).toContain("needs_work");
  });

  it("never treats 'as-is' or puffery as a signal", () => {
    expect(has("Motivated seller! Priced to sell. Sold as-is, where-is.")).toEqual([]);
  });

  it("catches assignments and vendor financing", () => {
    expect(has("Assignment sale, closing 2027")).toContain("assignment");
    expect(has("Seller will consider a VTB")).toContain("vendor_take_back");
  });

  it("ignores a negated mention (reported on E13658116)", () => {
    expect(has("Condo rules: no assignment sale.")).not.toContain("assignment");
    expect(has("This is not an assignment sale")).not.toContain("assignment");
    expect(has("Assignment sale not permitted by builder")).not.toContain("assignment");
    expect(has("Not a power of sale. Well kept home.")).not.toContain("power_of_sale");
    expect(has("Unit is not tenanted, vacant on closing")).not.toContain("tenanted");
    expect(has("Bungalow without a separate entrance")).not.toContain("separate_entrance");
  });

  it("keeps a real mention next to an unrelated negative", () => {
    expect(has("No carpet, separate entrance to basement")).toContain("separate_entrance");
    expect(has("Assignment sale. No assignment fee to buyer.")).toContain("assignment");
    // One negated and one affirmed mention: the affirmed one wins.
    expect(has("Builder says no assignment sale on phase 1. This unit is an assignment sale.")).toContain(
      "assignment"
    );
    expect(has("Tenanted at $2,400; tenants pay utilities. No pets.")).toContain("tenanted");
    // A negative about something else, a few words back, does not cancel the feature.
    expect(has("No pets allowed and separate entrance to basement")).toContain("separate_entrance");
  });

  it("returns [] for missing or blank descriptions", () => {
    expect(has("")).toEqual([]);
    expect(detectDescriptionSignals(null)).toEqual([]);
    expect(detectDescriptionSignals(undefined)).toEqual([]);
  });
});

describe("signalForQuery", () => {
  it("maps a typed alias to its signal, ignoring quotes, hyphens and case", () => {
    expect(signalForQuery("sep entrance")?.id).toBe("separate_entrance");
    expect(signalForQuery('"Separate Entrance"')?.id).toBe("separate_entrance");
    expect(signalForQuery("in-law")?.id).toBe("second_suite");
    expect(signalForQuery("Power of Sale")?.id).toBe("power_of_sale");
  });

  it("only matches the whole string, so a sentence stays a sentence", () => {
    expect(signalForQuery("estate lot in king city")).toBeNull();
    expect(signalForQuery("walk-out")).toBeNull();
    expect(signalForQuery("se")).toBeNull();
  });
});

describe("registry", () => {
  it("orders every signal exactly once for every persona", () => {
    const ids = DESCRIPTION_SIGNALS.map((s) => s.id).sort();
    for (const order of Object.values(SIGNAL_ORDER)) expect([...order].sort()).toEqual(ids);
  });

  it("uses non-global patterns", () => {
    for (const s of DESCRIPTION_SIGNALS) for (const p of s.patterns) expect(p.global).toBe(false);
  });
});


describe("descriptionSearchFields", () => {
  it("indexes text for sale listings only, signals for all", () => {
    const remarks = "  Separate entrance to basement.  ";
    expect(descriptionSearchFields(remarks, "For Sale")).toEqual({
      SearchRemarks: "Separate entrance to basement.",
      description_signals: ["separate_entrance"],
    });
    expect(descriptionSearchFields(remarks, "For Lease")).toEqual({
      SearchRemarks: "",
      description_signals: ["separate_entrance"],
    });
  });

  it("always returns both fields", () => {
    expect(descriptionSearchFields(null, null)).toEqual({ SearchRemarks: "", description_signals: [] });
  });
});
