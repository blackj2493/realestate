import { describe, expect, it } from "vitest";
import { cleanSignupIntent, isSignupGoal, SIGNUP_GOALS } from "./signupIntent";

describe("cleanSignupIntent", () => {
  it("keeps a known goal", () => {
    expect(cleanSignupIntent({ goal: "buying" })).toEqual({ goal: "buying" });
  });

  it("rejects an unknown or missing goal without throwing", () => {
    expect(cleanSignupIntent({ goal: "flipping" })).toBeNull();
    expect(cleanSignupIntent({})).toBeNull();
    expect(cleanSignupIntent(null)).toBeNull();
    expect(cleanSignupIntent("selling")).toBeNull();
  });

  it("keeps a seller's address, trimmed and capped", () => {
    expect(cleanSignupIntent({ goal: "selling", address: "  12   Main St,  Toronto " })).toEqual({
      goal: "selling",
      address: "12 Main St, Toronto",
    });
    const long = cleanSignupIntent({ goal: "selling", address: "x".repeat(500) });
    expect(long?.address?.length).toBe(200);
  });

  it("drops an address on any goal but selling, and a too-short one", () => {
    expect(cleanSignupIntent({ goal: "buying", address: "12 Main St" })).toEqual({ goal: "buying" });
    expect(cleanSignupIntent({ goal: "selling", address: "12" })).toEqual({ goal: "selling" });
  });

  it("offers the five goals in a fixed order", () => {
    expect(SIGNUP_GOALS.map((g) => g.id)).toEqual(["buying", "selling", "investing", "renting", "researching"]);
    expect(isSignupGoal("renting")).toBe(true);
    expect(isSignupGoal("Renting")).toBe(false);
  });
});
