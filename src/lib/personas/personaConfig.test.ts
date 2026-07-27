import { describe, it, expect } from "vitest";
import { PERSONA_CONFIG, defaultTerminalFilters, buildInvestorClause } from "./personaConfig";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";

const f = (over = {}) => ({ ...defaultTerminalFilters, ...over });

describe("buildInvestorClause — real cap field", () => {
  it("filters on cap_rate_est with the band ceiling, not ExtrapolatedCapRate", () => {
    const s = buildInvestorClause(f({ minCapRate: 5 }));
    expect(s).toContain("cap_rate_est:>=5");
    expect(s).toContain("cap_rate_est:<=15");
    expect(s).not.toContain("ExtrapolatedCapRate");
  });
  it("emits no cap clause when the slider is at 0", () => {
    expect(buildInvestorClause(f())).not.toContain("cap_rate_est");
  });
  it("cashflow still sorts on cap_rate_est", () => {
    expect(PERSONA_CONFIG.cashflow.sortBy).toBe("cap_rate_est");
  });
});

describe("buildInvestorClause — persona-independent (applies every set signal)", () => {
  it("combines signals owned by different personas (cap rate + price drop together)", () => {
    const s = buildInvestorClause(f({ minCapRate: 4, minPriceDrop: 50000 }));
    expect(s).toContain("cap_rate_est:>=4");
    expect(s).toContain("TotalPriceDrop:>=50000");
  });
  it("density toggle filters is_density_ready (was mislabeled 'Surplus Parking')", () => {
    expect(buildInvestorClause(f({ zoningPotential: true }))).toContain("is_density_ready:=true");
  });
  it("surplus-parking slider is a distinct signal from the density toggle", () => {
    const s = buildInvestorClause(f({ minSurplusParking: 2 }));
    expect(s).toContain("surplus_parking_count:>=2");
    expect(s).not.toContain("is_density_ready");
  });
});

describe("default persona", () => {
  it("cold-starts on the Homebuyer lens (fix #6 — no more Flipper default for new/anon visitors)", () => {
    // The terminal store's cold-start default is the shared SCOPE_DEFAULT_PERSONA.terminal
    // (now "smart"); the terminal page hydrates it from the shared config on mount under
    // the ?lens= > stored > default precedence.
    expect(useCommandCenterStore.getState().activePersona).toBe("smart");
  });
});
