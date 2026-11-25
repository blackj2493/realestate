import { describe, it, expect } from "vitest";
import { buildChildCareFacts, getChildCareData, mapShapes, simplify, stepOf, STEP_LABELS, PER100_STEPS } from "./childCarePage";

describe("stepOf", () => {
  it("puts each value in one of five steps, with the boundary in the upper step", () => {
    expect(stepOf(0)).toBe(0);
    expect(stepOf(9.9)).toBe(0);
    expect(stepOf(10)).toBe(1);
    expect(stepOf(59.9)).toBe(3);
    expect(stepOf(60)).toBe(4);
    expect(STEP_LABELS).toHaveLength(PER100_STEPS.length + 1);
  });
});

describe("simplify", () => {
  it("drops collinear points and keeps the corners", () => {
    const ring: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    expect(simplify(ring, 0.01)).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });
});

describe("the Toronto page on the committed data", () => {
  const f = getChildCareData();
  const facts = buildChildCareFacts(f);

  it("ranks all 158 neighbourhoods, fewest spaces per child first", () => {
    expect(facts.ranked).toHaveLength(158);
    for (let i = 1; i < facts.ranked.length; i++) expect(facts.ranked[i].per100).toBeGreaterThanOrEqual(facts.ranked[i - 1].per100);
    expect(facts.lowest).toEqual(facts.ranked.slice(0, 10));
  });

  it("states the same city figure in the summary, the facts and the FAQ", () => {
    const n = String(Math.round(f.city.per100));
    expect(facts.summary).toContain(`${n} spaces for every 100 children`);
    expect(facts.facts.find((x) => x.id === "city")!.text).toContain(`${n} licensed`);
    expect(facts.faqs[0].a).toContain(`${n} spaces for every 100 children`);
  });

  it("counts zero-infant neighbourhoods from the data", () => {
    expect(facts.zeroInfant).toBe(f.neighbourhoods.filter((x) => x.infant === 0).length);
    expect(facts.zeroInfant).toBeGreaterThan(0);
  });

  it("draws one closed path per neighbourhood inside the viewBox", () => {
    const m = mapShapes(f);
    expect(m.shapes).toHaveLength(158);
    for (const s of m.shapes) {
      expect(s.d.startsWith("M")).toBe(true);
      expect(s.d.endsWith("Z")).toBe(true);
      // every ring keeps at least a triangle (a closed-ring bug once collapsed them to a point)
      for (const ring of s.d.split("Z").filter(Boolean)) expect(ring.split("L").length).toBeGreaterThanOrEqual(4);
      for (const [x, y] of s.d.replace(/[MZ]/g, "L").split("L").filter(Boolean).map((p) => p.split(",").map(Number))) {
        expect(x).toBeGreaterThanOrEqual(-0.1);
        expect(x).toBeLessThanOrEqual(m.width + 0.1);
        expect(y).toBeGreaterThanOrEqual(-0.1);
        expect(y).toBeLessThanOrEqual(m.height + 0.1);
      }
    }
    // the simplified map stays small enough to inline in the page
    expect(m.shapes.reduce((n, s) => n + s.d.length, 0)).toBeLessThan(250_000);
  });
});
