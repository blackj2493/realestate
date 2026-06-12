import { describe, it, expect, vi, beforeEach } from "vitest";
import { pickSibling } from "./siblingModel";

// ── fetchSiblingModel paging test (audit MEDIUM-9) ──────────────────────────
// Mock the supabase client module so we can inject a chainable stub.
vi.mock("@/lib/supabase/client", () => ({ getServiceRoleClient: vi.fn() }));
// Mock matrixService so the test only exercises the paging logic.
vi.mock("./matrixService", () => ({ fetchCoefficients: vi.fn().mockResolvedValue([]) }));
// Mock normalizeType so rawVariantsOf returns a non-empty array.
vi.mock("./normalizeType", () => ({
  rawVariantsOf: vi.fn(() => ["Detached"]),
}));

import { fetchSiblingModel } from "./siblingModel";

/**
 * Chainable Supabase stub that:
 * - For .from('raw_vow_sold'): serves `dataset` in pages when .range() is called.
 * - For any other .from(): returns { data: [], error: null } immediately.
 *
 * Chained methods used by the raw_vow_sold query: .select, .ilike, .in, .order, .range
 * Chained methods used by subsequent queries: .select, .ilike, .in (resolved via .then)
 */
function makeSupabaseStub(dataset: { city_region: string }[]) {
  let capturedFrom = "";
  let rangeFrom = 0;
  let rangeTo = 0;

  const rangeCall = vi.fn((f: number, t: number) => {
    rangeFrom = f;
    rangeTo = t;
    return vowChain;
  });

  const vowChain: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "in", "order"]) {
    vowChain[m] = vi.fn(() => vowChain);
  }
  vowChain.range = rangeCall;
  vowChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: dataset.slice(rangeFrom, rangeTo + 1), error: null }));

  // Generic chain for other tables (avm_audit_report, etc.)
  const emptyChain: Record<string, unknown> = {};
  for (const m of ["select", "ilike", "in", "order", "range"]) {
    emptyChain[m] = vi.fn(() => emptyChain);
  }
  emptyChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: [], error: null }));

  const stub = {
    from: vi.fn((table: string) => {
      capturedFrom = table;
      return capturedFrom === "raw_vow_sold" ? vowChain : emptyChain;
    }),
  };

  return { stub, rangeCall };
}

beforeEach(() => vi.clearAllMocks());

describe("fetchSiblingModel — PostgREST 1k paging (audit MEDIUM-9)", () => {
  it("collects city_regions from BOTH pages when there are 1,500 rows", async () => {
    // 1,500 rows: page 1 has regions A0-A999, page 2 has regions B0-B499
    const page1 = Array.from({ length: 1000 }, (_, i) => ({ city_region: `RegionA${i}` }));
    const page2 = Array.from({ length: 500 }, (_, i) => ({ city_region: `RegionB${i}` }));
    const dataset = [...page1, ...page2];

    const { stub, rangeCall } = makeSupabaseStub(dataset);

    // fetchSiblingModel will then query avm_audit_report → returns [] → best=null → returns null
    // That's fine — we only care that both pages were fetched (range called ≥ 2 times)
    const result = await fetchSiblingModel(
      stub as unknown as Parameters<typeof fetchSiblingModel>[0],
      "Aurora",
      "Detached",
      "Detached"
    );

    // With no trained sibling cohorts the function returns null — expected
    expect(result).toBeNull();

    // The key assertion: .range must have been called at least twice (page 1 + page 2)
    expect(rangeCall).toHaveBeenCalledTimes(2);

    // First call must be range(0, 999)
    expect(rangeCall.mock.calls[0]).toEqual([0, 999]);
    // Second call must be range(1000, 1999)
    expect(rangeCall.mock.calls[1]).toEqual([1000, 1999]);
  });
});

describe("pickSibling", () => {
  it("picks the most-sales cohort above the R²/n gate", () => {
    const r = pickSibling([
      { city_region: "Aurora Highlands", model_accuracy_score: 0.62, total_sales_analyzed: 180 },
      { city_region: "Aurora Village", model_accuracy_score: 0.71, total_sales_analyzed: 90 },
    ]);
    expect(r?.city_region).toBe("Aurora Highlands");
  });
  it("rejects cohorts below the gate", () => {
    expect(pickSibling([{ city_region: "Thin", model_accuracy_score: 0.4, total_sales_analyzed: 200 }])).toBeNull();
    expect(pickSibling([{ city_region: "Tiny", model_accuracy_score: 0.9, total_sales_analyzed: 12 }])).toBeNull();
  });
});
