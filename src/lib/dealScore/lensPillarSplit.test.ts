import { describe, it, expect } from "vitest";
import { computeDealScore, PERSONA_WEIGHTS, type DealPersona } from "./computeDealScore";

/**
 * The split the Deal Score breakdown renders: pillars the active lens SCORES, and the
 * ones it deliberately ignores but still has an answer for.
 *
 * Weighting a pillar at 0 is correct — it is what stops a fairly-priced family home
 * scoring F on a cap rate its buyer does not care about. Hiding it is not. The card
 * advertises "Cashflow A" on a neighbouring chip, so it has to be able to say why.
 */
const split = (persona: DealPersona, pillars: { key: string }[]) => {
  const w = PERSONA_WEIGHTS[persona];
  return {
    scored: pillars.filter((p) => w[p.key as keyof typeof w] > 0).map((p) => p.key),
    context: pillars.filter((p) => w[p.key as keyof typeof w] === 0).map((p) => p.key),
  };
};

// A suite-potential listing priced above comps — the shape that prompted this.
const listing = {
  listPrice: 830_000,
  avmEstimate: { estimatedValue: 809_250, confidence: "HIGH" as const },
  domDays: 18,
  capRatePct: 5.33,
  subType: "Detached",
};

describe("Deal Score breakdown — scored vs context pillars", () => {
  it("the Homebuyer lens scores Price and Terms, and holds Yield as context", () => {
    const r = computeDealScore(listing, "smart");
    const { scored, context } = split("smart", r.pillars);

    expect(scored).toContain("price");
    expect(scored).toContain("terms");
    expect(scored).not.toContain("yield"); // weight 0 — must not move the score
    expect(context).toContain("yield"); // ...but must still be reachable
  });

  it("keeps the yield answer computed even where it carries no weight", () => {
    // The whole point: the sentence already exists. Rendering it costs nothing new.
    const r = computeDealScore(listing, "smart");
    const yieldPillar = r.pillars.find((p) => p.key === "yield");

    expect(yieldPillar).toBeDefined();
    expect(yieldPillar!.detail).toMatch(/cap rate/i);
    expect(yieldPillar!.points).toBeGreaterThan(0);
  });

  it("cuts both ways — a Cashflow reader gets Price as a scored pillar, not a hidden one", () => {
    // The inverse case is the more consequential one: an investor seeing an A without
    // being told the ask sits above comps.
    const { scored } = split("cashflow", computeDealScore(listing, "cashflow").pillars);
    expect(scored).toContain("price");
    expect(scored).toContain("yield");
  });

  it("every pillar lands on exactly one side of the line, for every lens", () => {
    for (const persona of ["smart", "cashflow", "flippers", "builders"] as DealPersona[]) {
      const r = computeDealScore(listing, persona);
      const { scored, context } = split(persona, r.pillars);
      expect(scored.length + context.length).toBe(r.pillars.length);
      expect(scored.filter((k) => context.includes(k))).toEqual([]);
    }
  });

  it("the score itself is untouched by the split — context carries no points", () => {
    // Guards the one thing that must not regress: showing a pillar must never score it.
    const r = computeDealScore(listing, "smart");
    const w = PERSONA_WEIGHTS.smart;
    const weighted = r.pillars.filter((p) => w[p.key as keyof typeof w] > 0);
    const total = weighted.reduce((s, p) => s + w[p.key as keyof typeof w], 0);
    const blended = weighted.reduce((s, p) => s + w[p.key as keyof typeof w] * p.points, 0) / total;

    expect(Math.round(blended)).toBe(r.score);
  });
});
