import { describe, it, expect, vi, beforeEach } from "vitest";

// The reconcile has its own suite (areaAlertSync.test.ts). Here we only care THAT the seed
// runs it — an alert row is the entire point, so a seed that writes dashboard_prefs and
// stops is the exact bug this module exists to prevent.
vi.mock("./areaAlertSync", () => ({
  reconcileCityAlerts: vi.fn().mockResolvedValue({
    created: ["Ottawa"],
    deleted: [],
    resnapped: [],
    heldEmpty: false,
    error: null,
  }),
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCityAlerts } from "./areaAlertSync";
import { cleanSignupRegion, seedSignupRegion } from "./seedSignupRegion";

const mockReconcile = vi.mocked(reconcileCityAlerts);

/** The row shape the seed upserts — typed so the assertions below can read it back. */
interface PrefsRow {
  user_id: string;
  config: { regions: string[]; persona?: string };
  updated_at: string;
}

/** Stand-in for the one read and one write the seed makes against dashboard_prefs. */
function fakeDb(opts: {
  current?: { config: unknown } | null;
  readError?: string;
  writeError?: string;
} = {}) {
  const upsert = vi.fn(async (_row: PrefsRow) =>
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
});

describe("cleanSignupRegion", () => {
  it("trims a usable name", () => {
    expect(cleanSignupRegion("  Ottawa  ")).toBe("Ottawa");
  });

  it("rejects blanks, non-strings and anything past the reconcile's 80-char bound", () => {
    expect(cleanSignupRegion("   ")).toBeNull();
    expect(cleanSignupRegion(null)).toBeNull();
    expect(cleanSignupRegion(42)).toBeNull();
    expect(cleanSignupRegion("x".repeat(81))).toBeNull();
    // 80 exactly is still fine — cleanRegions accepts it, so we must too.
    expect(cleanSignupRegion("x".repeat(80))).toHaveLength(80);
  });
});

describe("seedSignupRegion — the empty-workspace case (every real signup)", () => {
  it("stores the region AND creates the alert row", async () => {
    const { client, spies } = fakeDb({ current: null });
    const out = await seedSignupRegion(client, "u1", "Ottawa");

    expect(out).toMatchObject({ region: "Ottawa", seeded: true, error: null });
    expect(spies.upsert).toHaveBeenCalledTimes(1);
    expect(spies.upsert.mock.calls[0][0]).toMatchObject({
      user_id: "u1",
      config: { regions: ["Ottawa"] },
    });

    // The subscription itself. Without this the row above is inert dashboard state.
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile.mock.calls[0][2]).toMatchObject({ regions: ["Ottawa"] });
    expect(out.alerted).toEqual(["Ottawa"]);
  });

  it("keeps the rest of an existing config when it seeds the region", async () => {
    const { client, spies } = fakeDb({
      current: { config: { regions: [], persona: "cashflow" } },
    });
    await seedSignupRegion(client, "u1", "Ottawa");
    expect(spies.upsert.mock.calls[0][0].config).toMatchObject({
      regions: ["Ottawa"],
      persona: "cashflow",
    });
  });
});

describe("seedSignupRegion — never clobbers a workspace that has areas", () => {
  it("leaves an existing region alone but still reconciles it", async () => {
    const { client, spies } = fakeDb({ current: { config: { regions: ["Barrhaven"] } } });
    const out = await seedSignupRegion(client, "u1", "Ottawa");

    expect(spies.upsert).not.toHaveBeenCalled();
    expect(out).toMatchObject({ region: "Barrhaven", seeded: false });
    // Still reconciled: the row can exist while its alert rows do not, which is the
    // original bug — repair it rather than walk past it.
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile.mock.calls[0][2]).toMatchObject({ regions: ["Barrhaven"] });
  });
});

describe("seedSignupRegion — failures are reported, never thrown", () => {
  it("writes nothing when the region is unusable", async () => {
    const { client, spies } = fakeDb();
    const out = await seedSignupRegion(client, "u1", "  ");
    expect(out).toEqual({ region: null, seeded: false, alerted: [], error: null });
    expect(spies.select).not.toHaveBeenCalled();
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("returns a read error instead of overwriting on a failed read", async () => {
    const { client, spies } = fakeDb({ readError: "boom" });
    const out = await seedSignupRegion(client, "u1", "Ottawa");
    expect(out.error).toBe("boom");
    expect(out.seeded).toBe(false);
    expect(spies.upsert).not.toHaveBeenCalled();
  });

  it("returns a write error and does not claim the alert row exists", async () => {
    const { client } = fakeDb({ current: null, writeError: "denied" });
    const out = await seedSignupRegion(client, "u1", "Ottawa");
    expect(out).toMatchObject({ region: null, seeded: false, error: "denied" });
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("surfaces a reconcile failure without losing the stored region", async () => {
    mockReconcile.mockResolvedValueOnce({
      created: [],
      deleted: [],
      resnapped: [],
      heldEmpty: false,
      error: "reconcile down",
    });
    const { client } = fakeDb({ current: null });
    const out = await seedSignupRegion(client, "u1", "Ottawa");
    expect(out).toMatchObject({ region: "Ottawa", seeded: true, error: "reconcile down" });
  });

  it("catches a thrown client rather than failing the caller", async () => {
    const client = {
      from: () => {
        throw new Error("network");
      },
    } as unknown as SupabaseClient;
    const out = await seedSignupRegion(client, "u1", "Ottawa");
    expect(out).toMatchObject({ region: null, seeded: false, error: "network" });
  });
});
