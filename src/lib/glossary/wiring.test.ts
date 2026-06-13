import { describe, it, expect } from "vitest";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { COMPARE_METRICS } from "@/lib/compare/compareMetricsConfig";
import { MAP_METRICS } from "@/lib/personas/mapMetrics";
import { term } from "@/lib/glossary/terms";

const findControl = (persona: keyof typeof PERSONA_CONFIG, key: string) =>
  PERSONA_CONFIG[persona].controls.find(
    (c) => ("key" in c && c.key === key) || ("minKey" in c && c.minKey === key)
  );

describe("surface labels resolve to the registry (no drift)", () => {
  it("Smart Homebuyer cap-rate filter no longer says 'Yield'", () => {
    const c = findControl("smart", "minYield");
    expect(c?.short).toBe(term("capRate").name);
    expect(c?.label).not.toMatch(/yield/i);
  });

  it("both duplex toggles read 'Suite Potential'", () => {
    expect(findControl("smart", "duplexCandidate")?.short).toBe(term("suitePotential").name);
    expect(findControl("cashflow", "duplexCandidate")?.label).toBe(term("suitePotential").name);
  });

  it("Smart zoning toggle reads 'Density Ready'", () => {
    expect(findControl("smart", "zoningPotential")?.label).toBe(term("densityReady").name);
  });

  it("Compare carry row reads 'Carry Cost'", () => {
    expect(COMPARE_METRICS.find((m) => m.key === "carry")?.label).toBe(term("carryCost").name);
  });

  it("density map metric reads 'Listing Density'", () => {
    expect(MAP_METRICS.find((m) => m.id === "density")?.label).toBe(term("listingDensity").name);
  });
});
