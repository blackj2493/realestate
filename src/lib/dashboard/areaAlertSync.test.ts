import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileCityAlerts } from "./areaAlertSync";
import { DEFAULT_ACTIVITY_LENS } from "./config";

interface Row {
  id: string;
  area_type: string;
  source: { kind?: string; city?: string } | null;
  alerts_enabled?: boolean | null;
  alert_scope?: string | null;
  filters?: unknown;
}

/**
 * In-memory stand-in for the three writes the reconcile makes. It records rather than
 * enumerates: any call it does not know about would throw, which is the point — a silent
 * extra write is exactly the class of bug this module exists to stop.
 */
function fakeDb(rows: Row[], opts: { selectError?: string } = {}) {
  const state = {
    inserted: [] as Record<string, unknown>[],
    deletedIds: [] as string[],
    updates: [] as { id: string; patch: Record<string, unknown> }[],
  };
  const client = {
    from: () => ({
      select: () => ({
        eq: async () =>
          opts.selectError
            ? { data: null, error: { message: opts.selectError } }
            : { data: rows, error: null },
      }),
      insert: async (payload: Record<string, unknown>[]) => {
        state.inserted.push(...payload);
        return { error: null };
      },
      delete: () => ({
        in: async (_col: string, ids: string[]) => {
          state.deletedIds.push(...ids);
          return { error: null };
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          state.updates.push({ id, patch });
          return { error: null };
        },
      }),
    }),
  };
  return { client: client as unknown as SupabaseClient, state };
}

const cityRow = (id: string, city: string, extra: Partial<Row> = {}): Row => ({
  id,
  area_type: "city",
  source: { kind: "city", city },
  alerts_enabled: true,
  alert_scope: "all",
  filters: null,
  ...extra,
});

const cfg = (regions: string[], lens = DEFAULT_ACTIVITY_LENS) => ({
  regions,
  boards: [],
  marketActivity: lens,
  persona: "smart",
  lastVisitAt: null,
});

describe("reconcileCityAlerts — create", () => {
  it("creates an alert row for a dashboard area that has none", async () => {
    const { client, state } = fakeDb([]);
    const out = await reconcileCityAlerts(client, "u1", cfg(["Vellore Village"]));
    expect(out.error).toBeNull();
    expect(out.created).toEqual(["Vellore Village"]);
    expect(state.inserted).toHaveLength(1);
    expect(state.inserted[0]).toMatchObject({
      user_id: "u1",
      area_type: "city",
      source: { kind: "city", city: "Vellore Village" },
    });
  });

  it("a COMMUNITY defaults to 'all' — manageable volume, no filter surprise", async () => {
    const { client, state } = fakeDb([]);
    await reconcileCityAlerts(client, "u1", cfg(["Vellore Village"]));
    expect(state.inserted[0].alert_scope).toBe("all");
    expect(state.inserted[0].filters).toBeNull();
  });

  it("a WHOLE CITY defaults to 'filtered' by the current lens — never a firehose", async () => {
    const { client, state } = fakeDb([]);
    const lens = { ...DEFAULT_ACTIVITY_LENS, minBeds: 3, propertyTypes: ["detached"] };
    await reconcileCityAlerts(client, "u1", cfg(["Toronto"], lens));
    expect(state.inserted[0].alert_scope).toBe("filtered");
    expect(state.inserted[0].filters).toMatchObject({ lens: { minBeds: 3 } });
  });

  it("skips an area that already has a row, muted or not", async () => {
    const { client, state } = fakeDb([
      cityRow("b1", "Barrhaven"),
      cityRow("b2", "Toronto", { alerts_enabled: false }),
    ]);
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven", "Toronto"]));
    expect(out.created).toEqual([]);
    expect(state.inserted).toEqual([]);
    // A muted row stays muted — the reconcile never writes alerts_enabled.
    expect(state.updates).toEqual([]);
  });

  it("ignores blanks, duplicates and non-strings in a legacy regions array", async () => {
    const { client, state } = fakeDb([]);
    const out = await reconcileCityAlerts(client, "u1", {
      regions: ["Barrhaven", "Barrhaven", "  ", 42, null, " Milton "],
    });
    expect(out.created).toEqual(["Barrhaven", "Milton"]);
    expect(state.inserted).toHaveLength(2);
  });
});

describe("reconcileCityAlerts — delete", () => {
  it("removes an alert row for an area the dashboard no longer shows", async () => {
    const { client, state } = fakeDb([cityRow("b1", "Barrhaven"), cityRow("b2", "Thornhill")]);
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"]));
    expect(out.deleted).toEqual(["Thornhill"]);
    expect(state.deletedIds).toEqual(["b2"]);
  });

  it("never touches drawn / commute / school areas — they are not config.regions", async () => {
    const { client, state } = fakeDb([
      { id: "d1", area_type: "draw", source: { kind: "draw" } },
      { id: "s1", area_type: "school", source: { kind: "school" } },
      cityRow("c1", "Thornhill"),
    ]);
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"]));
    expect(state.deletedIds).toEqual(["c1"]);
    expect(out.deleted).toEqual(["Thornhill"]);
  });

  it("HOLDS the delete pass when regions arrives empty — that shape is a stale blob", async () => {
    const { client, state } = fakeDb([cityRow("b1", "Barrhaven"), cityRow("b2", "Thornhill")]);
    const out = await reconcileCityAlerts(client, "u1", cfg([]));
    expect(out.heldEmpty).toBe(true);
    expect(out.deleted).toEqual([]);
    expect(state.deletedIds).toEqual([]);
  });
});

describe("reconcileCityAlerts — filter re-snap", () => {
  const frozen = {
    lens: {
      ...DEFAULT_ACTIVITY_LENS,
      minBeds: 4,
      minBaths: 4,
      minGarage: 4,
      minFrontage: 30,
      propertyTypes: ["detached"],
    },
  };

  it("re-syncs a 'filtered' row still holding an older lens", async () => {
    const { client, state } = fakeDb([
      cityRow("b1", "Barrhaven", { alert_scope: "filtered", filters: frozen }),
    ]);
    const live = { ...DEFAULT_ACTIVITY_LENS, minBeds: 4, propertyTypes: ["detached"] };
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"], live));
    expect(out.resnapped).toEqual(["Barrhaven"]);
    expect(state.updates).toEqual([{ id: "b1", patch: { filters: { lens: live } } }]);
  });

  it("writes nothing when the stored lens already matches, whatever the key order", async () => {
    // Postgres jsonb re-orders object keys on the way in, so an identical lens comes back
    // shuffled. A stringify compare would rewrite every filtered row on every save.
    const shuffled = {
      lens: {
        propertyTypes: ["detached"],
        basement: "any",
        minBeds: 4,
        transactionType: "sale",
        minFrontage: 0,
        bedsExact: false,
        minBaths: 0,
        bathsExact: false,
        minGarage: 0,
        garageExact: false,
        windowDays: 90,
      },
    };
    const { client, state } = fakeDb([
      cityRow("b1", "Barrhaven", { alert_scope: "filtered", filters: shuffled }),
    ]);
    const live = { ...DEFAULT_ACTIVITY_LENS, minBeds: 4, propertyTypes: ["detached"] };
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"], live));
    expect(out.resnapped).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("leaves an 'all' row's filters alone", async () => {
    const { client, state } = fakeDb([
      cityRow("b1", "Barrhaven", { alert_scope: "all", filters: frozen }),
    ]);
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"]));
    expect(out.resnapped).toEqual([]);
    expect(state.updates).toEqual([]);
  });

  it("leaves a TERMINAL snapshot alone — only the { lens } city shape is ours", async () => {
    const { client, state } = fakeDb([
      cityRow("b1", "Barrhaven", {
        alert_scope: "filtered",
        filters: { universalFilters: { beds: 3 }, activePersona: "smart" },
      }),
    ]);
    await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"]));
    expect(state.updates).toEqual([]);
  });
});

describe("reconcileCityAlerts — failure", () => {
  it("reports a read failure and writes nothing", async () => {
    const { client, state } = fakeDb([], { selectError: "connection reset" });
    const out = await reconcileCityAlerts(client, "u1", cfg(["Barrhaven"]));
    expect(out.error).toBe("connection reset");
    expect(state.inserted).toEqual([]);
    expect(state.deletedIds).toEqual([]);
  });

  it("never throws — the caller's config save must still stand", async () => {
    const exploding = {
      from: () => {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    const out = await reconcileCityAlerts(exploding, "u1", cfg(["Barrhaven"]));
    expect(out.error).toBe("boom");
  });
});
