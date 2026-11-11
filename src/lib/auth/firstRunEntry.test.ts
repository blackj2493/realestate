import { describe, it, expect } from "vitest";
import { isFirstRunEntry } from "./firstRunEntry";

describe("isFirstRunEntry", () => {
  it("treats a sign-in with no destination as a signup", () => {
    expect(isFirstRunEntry(null)).toBe(true);
  });

  it("honours /dashboard — a visitor who signed up from the dashboard goes back to it", () => {
    // The signed-out dashboard shows the live market and links to /login?next=/dashboard.
    // The Terms form saves the chosen area, so the dashboard is not empty on return.
    expect(isFirstRunEntry("/dashboard")).toBe(false);
    expect(isFirstRunEntry("/dashboard?tab=watchlist")).toBe(false);
  });

  it("honours a genuinely contextual destination", () => {
    // The gated-teaser flow is the strongest path we have: return the user to the exact
    // listing they wanted, now unlocked. It must never be diverted to the terminal.
    expect(isFirstRunEntry("/properties/ABC123")).toBe(false);
    expect(isFirstRunEntry("/properties/ABC123?lens=cashflow")).toBe(false);
    expect(isFirstRunEntry("/properties/compare?ids=A,B")).toBe(false);
  });

  it("honours /analytics — it carries its own region selector, so it is not empty", () => {
    expect(isFirstRunEntry("/analytics")).toBe(false);
  });

});
