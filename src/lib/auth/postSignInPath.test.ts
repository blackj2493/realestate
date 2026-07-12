import { describe, it, expect } from "vitest";
import { postSignInPath } from "./postSignInPath";

describe("postSignInPath", () => {
  it("wraps a relative destination through /welcome", () => {
    expect(postSignInPath("/properties/ABC123")).toBe(
      "/welcome?next=%2Fproperties%2FABC123"
    );
  });

  it("defaults to /dashboard when next is missing", () => {
    expect(postSignInPath(undefined)).toBe("/welcome?next=%2Fdashboard");
    expect(postSignInPath(null)).toBe("/welcome?next=%2Fdashboard");
    expect(postSignInPath("")).toBe("/welcome?next=%2Fdashboard");
  });

  it("rejects protocol-relative and absolute URLs (open-redirect guard)", () => {
    expect(postSignInPath("//evil.example.com")).toBe("/welcome?next=%2Fdashboard");
    expect(postSignInPath("https://evil.example.com")).toBe("/welcome?next=%2Fdashboard");
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
