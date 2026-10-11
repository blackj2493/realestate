import { describe, expect, it } from "vitest";
import {
  CASHFLOW_BLOCK,
  CONTROL_BY_ID,
  INVESTOR_GROUPS,
  LENS_PANEL,
  isPickActive,
  pickClause,
  pickKey,
  togglePick,
  type PickDef,
} from "./filterPanelConfig";
import { INVESTOR_CONTROLS, defaultTerminalFilters } from "@/lib/personas/personaConfig";
import { SIGNAL_BY_ID } from "@/lib/listings/descriptionSignals";

const ids = INVESTOR_CONTROLS.map((c) => (c.kind === "range" ? c.minKey : c.key));

describe("INVESTOR_GROUPS", () => {
  it("places every investor control in exactly one group", () => {
    const grouped = INVESTOR_GROUPS.flatMap((g) => g.ids);
    expect([...grouped].sort()).toEqual([...ids].sort());
  });
});

describe("LENS_PANEL", () => {
  it("gives every lens three or four picks, none repeated", () => {
    for (const lens of Object.values(LENS_PANEL)) {
      expect(lens.picks.length).toBeGreaterThanOrEqual(3);
      expect(lens.picks.length).toBeLessThanOrEqual(4);
      expect(new Set(lens.picks.map(pickKey)).size).toBe(lens.picks.length);
    }
  });

  it("only names controls and signals that exist", () => {
    for (const lens of Object.values(LENS_PANEL)) {
      for (const id of lens.block) if (id !== CASHFLOW_BLOCK) expect(CONTROL_BY_ID[id]).toBeDefined();
      for (const p of lens.picks) {
        if (p.kind === "signal") expect(SIGNAL_BY_ID[p.id]).toBeDefined();
        else expect(CONTROL_BY_ID[p.key]).toBeDefined();
      }
    }
  });

  it("uses a threshold inside its control's slider range", () => {
    for (const lens of Object.values(LENS_PANEL))
      for (const p of lens.picks)
        if (p.kind === "threshold") {
          const c = CONTROL_BY_ID[p.key];
          if (c.kind !== "slider") throw new Error(`${p.key} is not a slider`);
          expect(p.value).toBeGreaterThan(c.min);
          expect(p.value).toBeLessThanOrEqual(c.max);
        }
  });
});

const base = { filters: { ...defaultTerminalFilters }, signals: [] as string[] };
const cap: PickDef = { kind: "threshold", key: "minCapRate", value: 5, label: "Cap rate 5%+" };
const stale: PickDef = { kind: "toggle", key: "staleOnly", label: "Stale" };
const pos: PickDef = { kind: "signal", id: "power_of_sale", label: "Power of sale" };

describe("picks", () => {
  it("turns each kind on, then back off to the default", () => {
    for (const p of [cap, stale, pos]) {
      const on = togglePick(p, base, defaultTerminalFilters);
      const s1 = { filters: { ...base.filters, ...on.filters }, signals: on.signals ?? base.signals };
      expect(isPickActive(p, s1)).toBe(true);
      const off = togglePick(p, s1, defaultTerminalFilters);
      const s2 = { filters: { ...s1.filters, ...off.filters }, signals: off.signals ?? s1.signals };
      expect(isPickActive(p, s2)).toBe(false);
      expect(s2.filters).toEqual(defaultTerminalFilters);
    }
  });

  it("leaves a threshold the reader set themselves alone until tapped", () => {
    const s = { ...base, filters: { ...base.filters, minCapRate: 6 } };
    expect(isPickActive(cap, s)).toBe(false);
    expect(togglePick(cap, s, defaultTerminalFilters).filters).toEqual({ minCapRate: 5 });
  });

  it("keeps other signals when toggling one", () => {
    const s = { ...base, signals: ["tenanted"] };
    expect(togglePick(pos, s, defaultTerminalFilters).signals).toEqual(["tenanted", "power_of_sale"]);
  });

  it("counts with the pick's own clause", () => {
    expect(pickClause(pos, base.filters)).toBe("description_signals:=`power_of_sale`");
    expect(pickClause(stale, base.filters)).toBe("IsStale:=true");
    expect(pickClause(cap, base.filters)).toContain("cap_rate_est:>=5");
  });
});
