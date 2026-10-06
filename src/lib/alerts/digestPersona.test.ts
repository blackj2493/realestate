import { describe, expect, it } from "vitest";
import { digestPersona } from "./digestPersona";

describe("digestPersona", () => {
  it("prefers the dashboard's saved persona", () => {
    expect(digestPersona({ persona: "builders" }, ["Analyze rental yield / cap rates"])).toBe("builders");
  });
  it("falls back to /apply objectives, then homebuyer", () => {
    expect(digestPersona(null, ["Analyze rental yield / cap rates"])).toBe("cashflow");
    expect(digestPersona({ persona: "nonsense" }, null)).toBe("smart");
    expect(digestPersona(undefined, [])).toBe("smart");
  });
});
