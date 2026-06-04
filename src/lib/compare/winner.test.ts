import { describe, it, expect } from "vitest";
import { winnerIndices, bestValue } from "./winner";

describe("winnerIndices", () => {
  it("returns empty for direction null", () => {
    expect(winnerIndices([1, 2, 3], null).size).toBe(0);
  });
  it("returns empty when fewer than 2 columns have a value", () => {
    expect(winnerIndices([5, null, null], "high").size).toBe(0);
  });
  it("picks the max index for 'high'", () => {
    expect([...winnerIndices([1, 9, 4], "high")]).toEqual([1]);
  });
  it("picks the min index for 'low'", () => {
    expect([...winnerIndices([7, 3, 5], "low")]).toEqual([1]);
  });
  it("returns all tied winners", () => {
    expect([...winnerIndices([4, 4, 1], "high")].sort()).toEqual([0, 1]);
  });
  it("ignores null / undefined / NaN / Infinity", () => {
    expect([...winnerIndices([null, 2, NaN, Infinity, 8], "high")]).toEqual([4]);
  });
});

describe("bestValue", () => {
  it("is null when direction is null or <2 values", () => {
    expect(bestValue([1, 2], null)).toBeNull();
    expect(bestValue([1, null], "low")).toBeNull();
  });
  it("returns the winning magnitude", () => {
    expect(bestValue([10, 4, 7], "low")).toBe(4);
    expect(bestValue([10, 4, 7], "high")).toBe(10);
  });
});
