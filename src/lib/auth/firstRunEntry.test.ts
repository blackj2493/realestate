import { describe, it, expect } from "vitest";
import { isFirstRunEntry } from "./firstRunEntry";

describe("isFirstRunEntry", () => {
  it("treats a sign-in with no destination as a signup", () => {
    expect(isFirstRunEntry(null)).toBe(true);
  });

  it("treats /dashboard as no destination — a new account has no dashboard yet", () => {
    // Regression: clicking "Dashboard" while logged out bounces through
    // /login?next=/dashboard, which used to suppress the market picker and land the
    // brand-new user on an empty dashboard — the exact reported bug.
    expect(isFirstRunEntry("/dashboard")).toBe(true);
  });

  it("ignores query strings and hashes when matching the dashboard", () => {
    expect(isFirstRunEntry("/dashboard?tab=watchlist")).toBe(true);
    expect(isFirstRunEntry("/dashboard#alerts")).toBe(true);
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

  it("does not match paths that merely start with /dashboard", () => {
    expect(isFirstRunEntry("/dashboard-settings")).toBe(false);
  });
});
