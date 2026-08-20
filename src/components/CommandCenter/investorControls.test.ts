import { describe, it, expect } from "vitest";
import { isControlActive, investorChipLabel, anyControlActive, snapToActiveFloor } from "./investorControls";
import { defaultTerminalFilters, PERSONA_CONFIG, INVESTOR_CONTROLS } from "@/lib/personas/personaConfig";
import { CAP_RATE_BAND } from "@/lib/metrics/sanityBand";

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

const capRate = INVESTOR_CONTROLS.find((c) => c.kind === "slider" && c.key === "minCapRate");

describe("snapToActiveFloor", () => {
  it("passes any value through when the control declares no floor", () => {
    expect(snapToActiveFloor(undefined, 0.5, 0)).toBe(0.5);
    expect(snapToActiveFloor(undefined, 0, 5)).toBe(0);
  });

  it("leaves off (0) and any value at or above the floor alone", () => {
    expect(snapToActiveFloor(1, 0, 5)).toBe(0);
    expect(snapToActiveFloor(1, 1, 0)).toBe(1);
    expect(snapToActiveFloor(1, 5.5, 5)).toBe(5.5);
  });

  it("snaps UP to the floor on a drag away from off", () => {
    expect(snapToActiveFloor(1, 0.5, 0)).toBe(1);
  });

  it("snaps DOWN to off on a drag away from an active value", () => {
    // Without the direction rule a sticky floor traps the user above off.
    expect(snapToActiveFloor(1, 0.5, 1)).toBe(0);
    expect(snapToActiveFloor(1, 0.5, 4)).toBe(0);
  });
});

describe("cap rate control — the chip cannot show a threshold the query ignores", () => {
  it("declares the sanity-band floor as its active floor", () => {
    expect(capRate && capRate.kind === "slider" && capRate.minActive).toBe(CAP_RATE_BAND.min);
  });

  it("every reachable slider stop survives the clause clamp unchanged", () => {
    if (!capRate || capRate.kind !== "slider") throw new Error("cap rate control missing");
    const { min, max, step, minActive } = capRate;
    for (let v = min; v <= max; v = Number((v + step).toFixed(4))) {
      const settled = snapToActiveFloor(minActive, v, min);
      const clause = capRate.buildClause({ ...defaultTerminalFilters, minCapRate: settled });
      if (settled === 0) {
        expect(clause).toBeNull();
      } else {
        // The threshold in the query is the threshold on the chip — no silent clamp.
        expect(clause).toBe(`cap_rate_est:>=${settled} && cap_rate_est:<=${CAP_RATE_BAND.max}`);
      }
    }
  });
});
