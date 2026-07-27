import { describe, it, expect } from "vitest";
import { effectiveDealPersona, scoredDealPersonas } from "./effectivePersona";
import type { DealPersona, PersonaGrade } from "./computeDealScore";

/** Minimal personaScores map — only the fields the resolver reads. */
function scores(
  present: Partial<Record<DealPersona, number>>
): Record<DealPersona, PersonaGrade> {
  const mk = (p: DealPersona): PersonaGrade =>
    present[p] != null
      ? { score: present[p]!, grade: "B", verdict: "" }
      : { score: null, grade: null, verdict: "" };
  return { smart: mk("smart"), cashflow: mk("cashflow"), flippers: mk("flippers"), builders: mk("builders") };
}

describe("effectiveDealPersona (one lens for the chip AND the panel)", () => {
  it("uses the requested lens when it scored — chip and panel agree on it", () => {
    const ds = { persona: "smart" as DealPersona, personaScores: scores({ smart: 92, cashflow: 78 }) };
    expect(effectiveDealPersona(ds, "cashflow")).toBe("cashflow");
    expect(effectiveDealPersona(ds, "smart")).toBe("smart");
  });

  it("falls back to the engine headline persona when the requested lens did NOT score", () => {
    // This is the 91-vs-92 case: the chip requested a lens with no score; both it and
    // the panel must fall back to the SAME persona (the engine default) — never diverge.
    const ds = { persona: "cashflow" as DealPersona, personaScores: scores({ cashflow: 91, flippers: 88 }) };
    expect(effectiveDealPersona(ds, "smart")).toBe("cashflow");
  });

  it("falls back to the first scored lens when neither requested nor headline scored", () => {
    const ds = { persona: "smart" as DealPersona, personaScores: scores({ flippers: 70, builders: 60 }) };
    expect(effectiveDealPersona(ds, "cashflow")).toBe("flippers");
  });

  it("returns undefined when nothing scored (card renders a 'not enough data' state)", () => {
    const ds = { persona: "smart" as DealPersona, personaScores: scores({}) };
    expect(effectiveDealPersona(ds, "smart")).toBeUndefined();
    expect(scoredDealPersonas(ds)).toEqual([]);
  });

  it("scoredDealPersonas keeps canonical order", () => {
    const ds = { personaScores: scores({ builders: 50, smart: 90, flippers: 70 }) };
    expect(scoredDealPersonas(ds)).toEqual(["smart", "flippers", "builders"]);
  });
});
