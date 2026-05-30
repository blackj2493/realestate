import { describe, it, expect } from "vitest";
import { isControlActive, investorChipLabel, anyControlActive } from "./investorChip";
import { defaultTerminalFilters, PERSONA_CONFIG } from "@/lib/personas/personaConfig";

const f = (patch: Partial<typeof defaultTerminalFilters> = {}) => ({ ...defaultTerminalFilters, ...patch });
const flippers = PERSONA_CONFIG.flippers.controls;
const priceDrop = flippers.find((c) => "key" in c && c.key === "minPriceDrop")!;
const trueDom = flippers.find((c) => c.kind === "range")!;
const stale = flippers.find((c) => "key" in c && c.key === "staleOnly")!;

describe("investorChip helpers", () => {
  it("slider inactive shows the short name only", () => {
    expect(isControlActive(priceDrop, f())).toBe(false);
    expect(investorChipLabel(priceDrop, f())).toBe("Price Drop");
  });
  it("slider active shows short + op + formatted value", () => {
    expect(isControlActive(priceDrop, f({ minPriceDrop: 50000 }))).toBe(true);
    expect(investorChipLabel(priceDrop, f({ minPriceDrop: 50000 }))).toBe("Price Drop ≥ $50k");
  });
  it("range with only min moved shows ≥", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMin: 60 }))).toBe("True DOM ≥ 60d");
  });
  it("range with only max moved shows ≤", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMax: 90 }))).toBe("True DOM ≤ 90d");
  });
  it("range with both moved shows a span", () => {
    expect(investorChipLabel(trueDom, f({ trueDomMin: 60, trueDomMax: 180 }))).toBe("True DOM 60d–180d");
  });
  it("toggle shows the short name; active flips isActive", () => {
    expect(investorChipLabel(stale, f())).toBe("Stale Only");
    expect(isControlActive(stale, f({ staleOnly: true }))).toBe(true);
  });
  it("anyControlActive is true when one control differs from default", () => {
    expect(anyControlActive(flippers, f())).toBe(false);
    expect(anyControlActive(flippers, f({ staleOnly: true }))).toBe(true);
  });
});
