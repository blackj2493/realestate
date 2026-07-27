import { describe, it, expect } from "vitest";
import {
  resolveActiveLens,
  resolvePersona,
  asPersona,
  SCOPE_DEFAULT_PERSONA,
} from "./resolvePersona";

describe("resolveActiveLens (URL param > stored > default)", () => {
  it("explicit ?lens= wins over a stored persona (deep links switch the session lens)", () => {
    expect(resolveActiveLens("flippers", "smart")).toBe("flippers");
    expect(resolveActiveLens("builders", "cashflow")).toBe("builders");
  });

  it("falls back to the stored persona when no URL param", () => {
    expect(resolveActiveLens(null, "cashflow")).toBe("cashflow");
    expect(resolveActiveLens(undefined, "flippers")).toBe("flippers");
  });

  it("falls back to the Homebuyer default when nothing is stored (new/anon visitor)", () => {
    expect(resolveActiveLens(null, null)).toBe("smart");
    expect(resolveActiveLens("", "")).toBe("smart");
  });

  it("ignores an invalid ?lens= but still honours a valid stored persona", () => {
    expect(resolveActiveLens("garbage", "cashflow")).toBe("cashflow");
    expect(resolveActiveLens("garbage", null)).toBe("smart");
  });

  it("every scope now cold-starts on the Homebuyer lens (no more Flippers default)", () => {
    expect(SCOPE_DEFAULT_PERSONA.terminal).toBe("smart");
    expect(resolveActiveLens(null, null, "terminal")).toBe("smart");
    expect(resolveActiveLens(null, null, "dashboard")).toBe("smart");
    expect(resolveActiveLens(null, null, "detail")).toBe("smart");
  });
});

describe("resolvePersona precedence with /apply objectives", () => {
  it("stored persona still beats objectives, which beat the default", () => {
    expect(
      resolvePersona("terminal", { persisted: "flippers", objectives: ["Land assembly / development"] })
    ).toBe("flippers");
    expect(resolvePersona("terminal", { objectives: ["Land assembly / development"] })).toBe("builders");
    expect(resolvePersona("terminal", {})).toBe("smart");
  });
});

describe("asPersona", () => {
  it("accepts the four personas and rejects everything else", () => {
    for (const p of ["smart", "cashflow", "flippers", "builders"]) expect(asPersona(p)).toBe(p);
    for (const junk of ["", "SMART", "investor", null, undefined, 3]) expect(asPersona(junk)).toBeNull();
  });
});
