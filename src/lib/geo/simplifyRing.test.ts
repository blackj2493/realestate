import { describe, expect, it } from "vitest";
import { convexHull, isSimpleRing, openRing, rdp, toSimpleRing, type RingPoint } from "./simplifyRing";

const square: RingPoint[] = [
  [0, 0],
  [4, 0],
  [4, 4],
  [0, 4],
];

// Classic bowtie: edges (0→1) and (2→3) cross.
const bowtie: RingPoint[] = [
  [0, 0],
  [4, 4],
  [4, 0],
  [0, 4],
];

describe("isSimpleRing", () => {
  it("accepts a square", () => {
    expect(isSimpleRing(square)).toBe(true);
  });

  it("rejects a bowtie", () => {
    expect(isSimpleRing(bowtie)).toBe(false);
  });

  it("rejects degenerate rings", () => {
    expect(isSimpleRing([[0, 0], [1, 1]])).toBe(false);
  });
});

describe("openRing", () => {
  it("strips the duplicated closing vertex and consecutive duplicates", () => {
    expect(openRing([[0, 0], [1, 0], [1, 0], [1, 1], [0, 0]])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);
  });
});

describe("rdp", () => {
  it("drops collinear midpoints and keeps corners", () => {
    const line: RingPoint[] = [
      [0, 0],
      [1, 0.0001],
      [2, 0],
      [2, 2],
    ];
    expect(rdp(line, 0.01)).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
    ]);
  });
});

describe("convexHull", () => {
  it("returns a simple ring containing the extremes", () => {
    const concave: RingPoint[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [2, 1], // dent
      [0, 4],
    ];
    const hull = convexHull(concave);
    expect(isSimpleRing(hull)).toBe(true);
    expect(hull).toHaveLength(4); // dent removed
  });
});

describe("toSimpleRing", () => {
  it("passes a valid small ring through (minus the closing vertex)", () => {
    const closed = [...square, square[0]] as RingPoint[];
    expect(toSimpleRing(closed, 50)).toEqual(square);
  });

  it("repairs a self-intersecting ring into a simple one", () => {
    const out = toSimpleRing(bowtie, 50);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(isSimpleRing(out)).toBe(true);
  });

  it("respects the vertex cap on a dense jagged ring", () => {
    // Star-ish ring: alternating inner/outer radius, 200 vertices.
    const dense: RingPoint[] = [];
    for (let i = 0; i < 200; i++) {
      const angle = (i / 200) * 2 * Math.PI;
      const r = i % 2 === 0 ? 1 : 0.97;
      dense.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
    const out = toSimpleRing(dense, 50);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(isSimpleRing(out)).toBe(true);
  });
});
