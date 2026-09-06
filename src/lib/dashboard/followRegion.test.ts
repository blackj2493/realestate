import { describe, it, expect, vi, beforeEach } from "vitest";

// Both have their own suites. Here we only care THAT follow runs them, and with what —
// an area saved without an alert row is the exact failure this module exists to prevent.
vi.mock("./areaAlertSync", () => ({
  reconcileCityAlerts: vi.fn().mockResolvedValue({
    created: ["Ottawa"],
    deleted: [],
    resnapped: [],
    heldEmpty: false,
    error: null,
  }),
}));
vi.mock("@/lib/analytics/activation", () => ({ recordActivation: vi.fn().mockResolvedValue(undefined) }));

import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCityAlerts } from "./areaAlertSync";
import { recordActivation } from "@/lib/analytics/activation";
import { cleanRegionName, followRegion, MAX_REGIONS } from "./followRegion";

const mockReconcile = vi.mocked(reconcileCityAlerts);
const mockActivation = vi.mocked(recordActivation);

interface PrefsRow {
  user_id: string;
  config: { regions: string[]; persona?: string };
  updated_at: string;
}

function fakeDb(opts: { current?: { config: unknown } | null; readError?: string; writeError?: string } = {}) {
  const upsert = vi.fn(async (_row: PrefsRow, _o?: unknown) =>
    opts.writeError ? { error: { message: opts.writeError } } : { error: null }
  );
  const select = vi.fn(() => ({
    eq: () => ({
      maybeSingle: async () =>
        opts.readError
          ? { data: null, error: { message: opts.readError } }
          : { data: opts.current ?? null, error: null },
    }),
  }));
  const client = { from: vi.fn(() => ({ select, upsert })) };
  return { client: client as unknown as SupabaseClient, spies: { select, upsert } };
}

beforeEach(() => {
  mockReconcile.mockClear();
  mockActivation.mockClear();
});

describe("cleanRegionName", () => {
  it("trims, and rejects blanks, non-strings and over-long names", () => {
    expect(cleanRegionName("  Ottawa ")).toBe("Ottawa");
    expect(cleanRegionName("")).toBeNull();
    expect(cleanRegionName(7)).toBeNull();
    expect(cleanRegionName("x".repeat(81))).toBeNull();
  });
});

describe("followRegion — adding an area", () => {
  it("appends it and creates the alert row", async () => {
    const { client, spies } = fakeDb({ current: null });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });

    expect(out).toMatchObject({ ok: true, added: true, regions: ["Ottawa"], error: null });
    expect(spies.upsert.mock.calls[0][0]).toMatchObject({
      user_id: "u1",
      config: { regions: ["Ottawa"] },
    });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(out.alerted).toEqual(["Ottawa"]);
  });

  it("MERGES — it never resets boards, persona or the lens", async () => {
    const { client, spies } = fakeDb({
      current: { config: { regions: ["Toronto"], persona: "cashflow" } },
    });
    await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(spies.upsert.mock.calls[0][0].config).toMatchObject({
      regions: ["Toronto", "Ottawa"],
      persona: "cashflow",
    });
  });

  it("records the activation with the calling surface", async () => {
    const { client } = fakeDb({ current: null });
    await followRegion(client, "u1", "Ottawa", { source: "data_drop", email: "a@b.c" });
    expect(mockActivation).toHaveBeenCalledWith({
      kind: "save_area",
      userId: "u1",
      email: "a@b.c",
      context: { city: "Ottawa", source: "data_drop" },
    });
  });

  it("caps the stored list at MAX_REGIONS", async () => {
    const full = Array.from({ length: MAX_REGIONS }, (_, i) => `City${i}`);
    const { client, spies } = fakeDb({ current: { config: { regions: full } } });
    await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    const stored = spies.upsert.mock.calls[0][0].config.regions;
    expect(stored).toHaveLength(MAX_REGIONS);
    expect(stored[MAX_REGIONS - 1]).toBe("Ottawa");
    expect(stored).not.toContain("City0");
  });
});

describe("followRegion — an area the account already has", () => {
  it("does not duplicate it, and matches case-insensitively", async () => {
    const { client, spies } = fakeDb({ current: { config: { regions: ["ottawa"] } } });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(out).toMatchObject({ ok: true, added: false, regions: ["ottawa"] });
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(mockActivation).not.toHaveBeenCalled();
  });

  it("still reconciles, because the alert row may be the missing half", async () => {
    const { client } = fakeDb({ current: { config: { regions: ["Ottawa"] } } });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(out.alerted).toEqual(["Ottawa"]);
  });
});

describe("followRegion — failures are reported, never thrown", () => {
  it("rejects an unusable region before touching the database", async () => {
    const { client, spies } = fakeDb();
    const out = await followRegion(client, "u1", "  ", { source: "prompt" });
    expect(out).toMatchObject({ ok: false, error: "region_invalid" });
    expect(spies.select).not.toHaveBeenCalled();
  });

  it("does not write when the read fails", async () => {
    const { client, spies } = fakeDb({ readError: "boom" });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(out).toMatchObject({ ok: false, error: "boom" });
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("does not claim an alert row when the write fails", async () => {
    const { client } = fakeDb({ current: null, writeError: "denied" });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(out).toMatchObject({ ok: false, added: false, error: "denied" });
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(mockActivation).not.toHaveBeenCalled();
  });

  it("reports a reconcile failure but keeps the save", async () => {
    mockReconcile.mockResolvedValueOnce({
      created: [],
      deleted: [],
      resnapped: [],
      heldEmpty: false,
      error: "reconcile down",
    });
    const { client } = fakeDb({ current: null });
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(out).toMatchObject({ ok: true, added: true, error: "reconcile down" });
  });

  it("catches a thrown client", async () => {
    const client = {
      from: () => {
        throw new Error("network");
      },
    } as unknown as SupabaseClient;
    const out = await followRegion(client, "u1", "Ottawa", { source: "prompt" });
    expect(out).toMatchObject({ ok: false, error: "network" });
  });
});
