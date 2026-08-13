import { describe, it, expect } from "vitest";
import { detectDistress } from "./distressSignals";

describe("detectDistress — real signals", () => {
  it("flags a power-of-sale listing as a forced sale", () => {
    const r = detectDistress("Power of Sale. Sold without warranty.");
    expect(r).toMatchObject({ isDistressed: true, forcedSale: true, needsWork: false });
    expect(r.matched).toContain("Power of Sale");
  });

  it.each([
    ["foreclosure", "Foreclosure property, quick close available."],
    ["bank owned", "Bank-owned home priced for immediate sale."],
    ["probate", "Probate application completed; closing flexible."],
    ["court-ordered", "Court-ordered sale, offers reviewed as received."],
    ["receivership", "Property sold under receivership."],
    ["estate sale", "Estate sale — first time offered in 50 years."],
    ["executor", "The executors invite offers on this family home."],
  ])("flags %s as a forced sale", (_label, remarks) => {
    expect(detectDistress(remarks).forcedSale).toBe(true);
  });

  it.each([
    ["TLC", "Solid home that needs a little TLC."],
    ["handyman", "Calling all handymen — bring your tools."],
    ["fixer-upper", "A true fixer-upper on a premium lot."],
    ["contractor special", "Contractor's special, priced accordingly."],
    ["needs work", "Needs work throughout but the bones are excellent."],
    ["teardown", "Tear down and build new, or renovate."],
    ["value in the land", "The value is in the land — 50x150 lot."],
    ["gut renovation", "Gut renovation required."],
  ])("flags %s as needs-work", (_label, remarks) => {
    expect(detectDistress(remarks).needsWork).toBe(true);
  });

  it("reports both kinds when both are present", () => {
    const r = detectDistress("Estate sale. Home needs work throughout.");
    expect(r).toMatchObject({ isDistressed: true, forcedSale: true, needsWork: true });
    expect(r.matched).toEqual(["Estate Sale", "Needs Work"]);
  });
});

describe("detectDistress — the false positives that caused this rewrite", () => {
  it('does not flag the phrase "real estate"', () => {
    // The old rule's bare \bestate\b matched this; it was the single biggest trigger.
    const r = detectDistress("Contact your real estate professional for a private showing.");
    expect(r.isDistressed).toBe(false);
  });

  it('does not flag "real estate" even next to the word sale', () => {
    expect(detectDistress("The finest real estate sale of the season.").isDistressed).toBe(false);
  });

  it("does not flag C13649002 — 17 Squirewood Road, the reported case", () => {
    // Verbatim from the live index. A well-kept bungalow whose only match under the old
    // rule was the boilerplate appliance disclaimer.
    const remarks =
      "Welcome to 17 Squirewood Road-a spacious 3-bedroom bungalow nestled on a quiet, " +
      "low-traffic street in the highly sought-after Pleasant View community. Offering an " +
      "ideal environment for families, this location combines peaceful neighborhood living " +
      "with unmatched convenience, just steps from top-rated schools, parks, libraries, " +
      "transit, shopping, and entertainment, plus effortless access to Highways 401 and 404." +
      "The functional layout continues downstairs into a fully finished basement, featuring a " +
      "large recreational area, an additional bedroom, a second full bathroom, and generous " +
      "storage space throughout.Offering incredible potential for buyers, investors, or " +
      'renovators looking to make a space their own. Property and appliances are being sold in "as-is, where-is" condition.';
    expect(detectDistress(remarks).isDistressed).toBe(false);
  });

  it("does not flag an as-is disclaimer on its own", () => {
    expect(detectDistress('Appliances sold "as is, where is" with no warranty.').isDistressed).toBe(false);
  });

  it("does not flag a Schedule B attachment reference", () => {
    expect(detectDistress("Please attach Schedule B to all offers.").isDistressed).toBe(false);
  });

  it("does not flag agent puffery", () => {
    expect(detectDistress("Motivated seller! Priced to sell. Must sell this week.").isDistressed).toBe(false);
  });

  it("does not flag a contractor who already did the work", () => {
    expect(detectDistress("Renovated by a licensed contractor in 2024.").isDistressed).toBe(false);
  });

  it('does not flag "renovators" describing an audience', () => {
    expect(detectDistress("Great for investors or renovators.").isDistressed).toBe(false);
  });

  it("does not flag a home-theatre receiver in the inclusions", () => {
    expect(detectDistress("Includes projector, screen and surround receiver.").isDistressed).toBe(false);
  });

  it("does not flag a move-in-ready listing", () => {
    expect(
      detectDistress("Beautiful family home, move-in ready, updated kitchen and hardwood throughout.").isDistressed
    ).toBe(false);
  });
});

describe("detectDistress — time and price are not distress", () => {
  it("has no notion of days on market (that is STALE's job)", () => {
    // The old rule flagged anything over 90 days, which hid the accurate STALE badge on
    // 12,291 listings. Remarks are the only input now.
    expect(detectDistress("Charming home in a quiet cul-de-sac.").isDistressed).toBe(false);
  });

  it("does not read a price reduction (that is TotalPriceDrop's job)", () => {
    expect(detectDistress("Price improved! Now offered below recent comparables.").isDistressed).toBe(false);
  });
});

describe("detectDistress — input handling", () => {
  it.each([[null], [undefined], [""], ["   "]])("returns a clean negative for %p", (input) => {
    expect(detectDistress(input as string | null | undefined)).toEqual({
      isDistressed: false,
      forcedSale: false,
      needsWork: false,
      matched: [],
    });
  });

  it("is case-insensitive", () => {
    expect(detectDistress("POWER OF SALE").forcedSale).toBe(true);
  });

  it("is stable across repeated calls (no /g lastIndex carry-over)", () => {
    const remarks = "Estate sale, needs work.";
    const a = detectDistress(remarks);
    const b = detectDistress(remarks);
    const c = detectDistress(remarks);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("does not repeat a label matched by two patterns", () => {
    const r = detectDistress("Estate sale. Sale of the estate of the late owner. Executor approved.");
    expect(r.matched).toEqual(["Estate Sale"]);
  });
});
