import { describe, it, expect, vi, beforeEach } from "vitest";
import { pickSibling } from "./siblingModel";

// ── fetchSiblingModel paging test (audit MEDIUM-9) ──────────────────────────
// Mock the supabase client module so we can inject a chainable stub.
vi.mock("@/lib/supabase/client", () => ({ getServiceRoleClient: vi.fn() }));
// Mock matrixService so the test only exercises the paging logic.
vi.mock("./matrixService", () => ({
  fetchCoefficients: vi.fn().mockResolvedValue({ rows: [], rung: null }),
}));
// Mock normalizeType so rawVariantsOf returns a non-empty array.
vi.mock("./normalizeType", () => ({
  rawVariantsOf: vi.fn(() => ["Detached"]),
}));

import { fetchSiblingModel } from "./siblingModel";

/**
 * Supabase stub for the post-migration-099 contract:
 * - .rpc('sold_city_regions', …) resolves to `dataset` (already DISTINCT, server-side).
 * - .from(<anything>) returns an empty chainable result; its .in() is a dedicated spy so
 *   tests can assert WHICH communities reached the donor query.
 */
function makeSupabaseStub(dataset: { city_region: string }[]) {
  const rpcCall = vi.fn((_fn: string, _params: Record<string, unknown>) =>
    Promise.resolve({ data: dataset, error: null })
  );

  const auditInCall = vi.fn(() => emptyChain);
  const emptyChain: Record<string, unknown> = {};
  // "eq" joined the chain when the audit read was pinned to the community rung (#450).
  for (const m of ["select", "eq", "ilike", "order", "range"]) {
    emptyChain[m] = vi.fn(() => emptyChain);
  }
  emptyChain.in = auditInCall;
  emptyChain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(resolve({ data: [], error: null }));

  const fromCall = vi.fn((_table: string) => emptyChain);
  const stub = { rpc: rpcCall, from: fromCall };

  return { stub, rpcCall, fromCall, auditInCall };
}

beforeEach(() => vi.clearAllMocks());

describe("fetchSiblingModel — no community truncation (audit MEDIUM-9)", () => {
  // Formerly a paging test: PostgREST caps responses at 1,000 rows, so the old
  // implementation walked up to 20 pages of raw city_region rows and de-duped in JS —
  // and silently dropped donors past page 20. Migration 099 moved the DISTINCT into
  // sold_city_regions, so the cap can only bite at >1,000 *distinct* communities
  // (real maximum observed in prod: 124, for Hamilton). The invariant under test is
  // unchanged: every distinct community must reach the donor query.
  it("passes every distinct community through to the donor query", async () => {
    // Deliberately oversized (1,500 distinct communities) — far beyond any real city —
    // to prove nothing is trimmed between the RPC and the avm_audit_report lookup.
    const dataset = [
      ...Array.from({ length: 1000 }, (_, i) => ({ city_region: `RegionA${i}` })),
      ...Array.from({ length: 500 }, (_, i) => ({ city_region: `RegionB${i}` })),
    ];

    const { stub, rpcCall, fromCall, auditInCall } = makeSupabaseStub(dataset);

    // avm_audit_report returns [] → best=null → fetchSiblingModel returns null.
    // That's fine — we only care which communities were offered downstream.
    const result = await fetchSiblingModel(
      stub as unknown as Parameters<typeof fetchSiblingModel>[0],
      "Aurora",
      "Detached",
      "Detached"
    );

    expect(result).toBeNull();

    // Communities come from the RPC, in ONE call — not a paged table scan.
    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall.mock.calls[0][0]).toBe("sold_city_regions");
    expect(rpcCall.mock.calls[0][1]).toEqual({
      p_city: "Aurora",
      p_sub_types: ["Detached"],
    });
    // raw_vow_sold must never be queried directly any more (that was the ILIKE seq scan).
    expect(fromCall.mock.calls.map((c) => c[0])).not.toContain("raw_vow_sold");

    // The donor query must receive all 1,500 — a dropped page or a reset accumulator fails here.
    const auditCityRegionCall = auditInCall.mock.calls.find(
      (c: unknown[]) => c[0] === "city_region"
    ) as [string, string[]] | undefined;
    expect(auditCityRegionCall).toBeDefined();
    const offered = auditCityRegionCall![1];
    expect(offered).toContain("RegionA0");
    expect(offered).toContain("RegionB0");
    expect(offered).toContain("RegionB499");
    expect(offered).toHaveLength(1500);
  });

  it("returns null when the RPC errors, rather than throwing", async () => {
    const stub = {
      rpc: vi.fn(() => Promise.resolve({ data: null, error: { message: "boom" } })),
      from: vi.fn(),
    };
    await expect(
      fetchSiblingModel(
        stub as unknown as Parameters<typeof fetchSiblingModel>[0],
        "Aurora",
        "Detached",
        "Detached"
      )
    ).resolves.toBeNull();
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
