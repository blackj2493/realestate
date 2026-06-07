import { describe, it, expect } from "vitest";
import { PERSONA_CONFIG, defaultTerminalFilters } from "./personaConfig";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

const f = (over = {}) => ({ ...defaultTerminalFilters, ...over });

describe("cashflow persona — real cap field", () => {
  it("filters on cap_rate_est with the band ceiling, not ExtrapolatedCapRate", () => {
    const s = PERSONA_CONFIG.cashflow.buildFilterString(f({ minCapRate: 5 }));
    expect(s).toContain("cap_rate_est:>=5");
    expect(s).toContain("cap_rate_est:<=15");
    expect(s).not.toContain("ExtrapolatedCapRate");
  });
  it("sorts on cap_rate_est", () => {
    expect(PERSONA_CONFIG.cashflow.sortBy).toBe("cap_rate_est");
  });
  it("emits no cap clause when the slider is at 0", () => {
    expect(PERSONA_CONFIG.cashflow.buildFilterString(f())).not.toContain("cap_rate_est");
  });
});

describe("smart persona — real cap field on the yield slider", () => {
  it("thresholds cap_rate_est, not ExtrapolatedCapRate", () => {
    const s = PERSONA_CONFIG.smart.buildFilterString(f({ minYield: 4 }));
    expect(s).toContain("cap_rate_est:>=4");
    expect(s).not.toContain("ExtrapolatedCapRate");
  });
});

describe("default persona", () => {
  it("defaults to the Flipper beachhead", () => {
    expect(useCommandCenterStore.getState().activePersona).toBe("flippers");
  });
});
