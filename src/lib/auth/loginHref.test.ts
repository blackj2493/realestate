import { describe, it, expect } from "vitest";
import { loginHref } from "./loginHref";
import { postSignInPath } from "./postSignInPath";
import { isFirstRunEntry } from "./firstRunEntry";

describe("loginHref", () => {
  it("carries the current page as next", () => {
    expect(loginHref("/properties/ABC123")).toBe("/login?next=%2Fproperties%2FABC123");
  });

  it("encodes query strings so they survive as one parameter", () => {
    // The compare shortlist lives entirely in ?ids= — dropping it returns the user to an
    // empty comparison, which reads as "sign-in wiped my work".
    expect(loginHref("/properties/compare?ids=A,B")).toBe(
      "/login?next=%2Fproperties%2Fcompare%3Fids%3DA%2CB"
    );
  });

  it("falls back to a bare /login when there is nothing safe to return to", () => {
    expect(loginHref(null)).toBe("/login");
    expect(loginHref(undefined)).toBe("/login");
    expect(loginHref("")).toBe("/login");
  });

  it("refuses absolute and protocol-relative destinations", () => {
    // Same guard as postSignInPath — a gated CTA must not become an open redirect.
    expect(loginHref("https://evil.example/x")).toBe("/login");
    expect(loginHref("//evil.example/x")).toBe("/login");
  });
});

describe("the round trip a gated listing CTA actually takes", () => {
  // These three functions are only correct together, and each was written in a different
  // change. This pins the end-to-end behaviour the user sees, so a future edit to any one
  // of them can't quietly re-break the return path.
  const listing = "/properties/ABC123";

  it("returns a new account to the listing it signed up from", () => {
    const href = loginHref(listing);
    const next = new URL(href, "https://x").searchParams.get("next");
    expect(next).toBe(listing);

    const afterSignIn = postSignInPath(next);
    expect(afterSignIn).toBe("/welcome?next=%2Fproperties%2FABC123");

    // false = honour `next` rather than diverting to the terminal.
    expect(isFirstRunEntry(next)).toBe(false);
  });

  it("still routes a destination-less sign-in into the first-run terminal", () => {
    // The bare-/login behaviour is load-bearing, not an accident: it is how a signup with
    // no context gets the market picker instead of an empty dashboard.
    const href = loginHref(null);
    expect(href).toBe("/login");

    // The login page turns a missing next into /dashboard, which is first-run.
    expect(isFirstRunEntry("/dashboard")).toBe(true);
  });
});
