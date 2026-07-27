import { describe, it, expect } from "vitest";
import { postSignInPath } from "./postSignInPath";

describe("postSignInPath", () => {
  it("wraps a relative destination through /welcome", () => {
    expect(postSignInPath("/properties/ABC123")).toBe(
      "/welcome?next=%2Fproperties%2FABC123"
    );
  });

  it("emits a BARE /welcome when next is missing, so /welcome can detect a first-run signup", () => {
    expect(postSignInPath(undefined)).toBe("/welcome");
    expect(postSignInPath(null)).toBe("/welcome");
    expect(postSignInPath("")).toBe("/welcome");
  });

  it("rejects protocol-relative and absolute URLs (open-redirect guard)", () => {
    expect(postSignInPath("//evil.example.com")).toBe("/welcome");
    expect(postSignInPath("https://evil.example.com")).toBe("/welcome");
  });

  it("still honours an EXPLICIT /dashboard destination", () => {
    expect(postSignInPath("/dashboard")).toBe("/welcome?next=%2Fdashboard");
  });

  it("does not double-wrap a destination already pointed at /welcome", () => {
    expect(postSignInPath("/welcome")).toBe("/welcome");
    expect(postSignInPath("/welcome?next=%2Fdashboard")).toBe("/welcome?next=%2Fdashboard");
  });

  it("preserves query strings on the wrapped destination", () => {
    expect(postSignInPath("/properties/ABC123?lens=cashflow")).toBe(
      "/welcome?next=%2Fproperties%2FABC123%3Flens%3Dcashflow"
    );
  });
});
