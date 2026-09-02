import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
// The reconcile has its own suite (areaAlertSync.test.ts); here we only care THAT the
// route runs it, and that it runs it with what was actually stored.
vi.mock("@/lib/dashboard/areaAlertSync", () => ({
  reconcileCityAlerts: vi.fn().mockResolvedValue({
    created: [],
    deleted: [],
    resnapped: [],
    heldEmpty: false,
    error: null,
  }),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { reconcileCityAlerts } from "@/lib/dashboard/areaAlertSync";
import { PUT } from "./route";

const mockCreate = vi.mocked(createSupabaseServerClient);
const mockReconcile = vi.mocked(reconcileCityAlerts);

/**
 * Chainable stand-in for the reads/writes the PUT makes against dashboard_prefs.
 * `current` is the stored row (null = no row yet); `updateRows` is what the conditional
 * UPDATE matched — an empty array is the lost race the route must turn into a 409.
 */
function makeClient(opts: {
  user: { id: string } | null;
  current?: { config: unknown; updated_at: string } | null;
  updateRows?: { updated_at: string }[];
}) {
  const update = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: async () => ({ data: opts.updateRows ?? [{ updated_at: "new" }], error: null }),
      }),
    }),
  }));
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const select = vi.fn(() => ({
    eq: () => ({ maybeSingle: async () => ({ data: opts.current ?? null, error: null }) }),
  }));
  return {
    client: {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: opts.user } }) },
      from: vi.fn(() => ({ select, update, upsert })),
    },
    spies: { select, update, upsert },
  };
}

const put = (body: unknown) =>
  new Request("https://x/api/dashboard-config", {
    method: "PUT",
    body: JSON.stringify(body),
  });

const CONFIG = { regions: ["Barrhaven"], boards: [], marketActivity: {}, persona: "smart" };

beforeEach(() => {
  mockCreate.mockReset();
  mockReconcile.mockClear();
});

describe("PUT /api/dashboard-config — stale-write rejection", () => {
  it("accepts a write based on the current version", async () => {
    const { client, spies } = makeClient({
      user: { id: "u1" },
      current: { config: {}, updated_at: "2026-09-01T00:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: "2026-09-01T00:00:00Z" }));
    expect(res.status).toBe(200);
    expect(spies.update).toHaveBeenCalledOnce();
  });

  it("REFUSES a write based on an older version and returns the server copy", async () => {
    // The cross-device bug: a device holding a stale blob overwrote the newer one, which
    // silently deleted every area added elsewhere while their alert rows kept emailing.
    const server = { regions: ["Barrhaven", "Thornhill"] };
    const { client, spies } = makeClient({
      user: { id: "u1" },
      current: { config: server, updated_at: "2026-09-01T12:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: "2026-08-17T00:00:00Z" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "stale", config: server });
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.upsert).not.toHaveBeenCalled();
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("REFUSES a seed from a device that thought the account had never synced", async () => {
    const { client, spies } = makeClient({
      user: { id: "u1" },
      current: { config: { regions: ["Toronto"] }, updated_at: "2026-09-01T12:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: null }));
    expect(res.status).toBe(409);
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("409s when the conditional UPDATE matched nothing — two writers raced", async () => {
    const { client } = makeClient({
      user: { id: "u1" },
      current: { config: {}, updated_at: "2026-09-01T00:00:00Z" },
      updateRows: [],
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: "2026-09-01T00:00:00Z" }));
    expect(res.status).toBe(409);
  });

  it("seeds a fresh account when there is genuinely no row", async () => {
    const { client, spies } = makeClient({ user: { id: "u1" }, current: null });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: null }));
    expect(res.status).toBe(200);
    expect(spies.upsert).toHaveBeenCalledOnce();
  });

  it("lets a pre-deploy bundle through unchecked — it sends no baseline at all", async () => {
    const { client, spies } = makeClient({
      user: { id: "u1" },
      current: { config: {}, updated_at: "2026-09-01T12:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG }));
    expect(res.status).toBe(200);
    expect(spies.update).toHaveBeenCalledOnce();
  });
});

describe("PUT /api/dashboard-config — alert reconcile", () => {
  it("reconciles the alert rows against the config it just stored", async () => {
    const { client } = makeClient({
      user: { id: "u1" },
      current: { config: {}, updated_at: "2026-09-01T00:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    await PUT(put({ config: CONFIG, baseUpdatedAt: "2026-09-01T00:00:00Z" }));
    expect(mockReconcile).toHaveBeenCalledWith(expect.anything(), "u1", CONFIG);
  });

  it("still saves when the reconcile fails — bookkeeping never fails the user's write", async () => {
    mockReconcile.mockResolvedValueOnce({
      created: [],
      deleted: [],
      resnapped: [],
      heldEmpty: false,
      error: "connection reset",
    });
    const { client } = makeClient({
      user: { id: "u1" },
      current: { config: {}, updated_at: "2026-09-01T00:00:00Z" },
    });
    mockCreate.mockResolvedValueOnce(client as never);
    const res = await PUT(put({ config: CONFIG, baseUpdatedAt: "2026-09-01T00:00:00Z" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it("401s when signed out", async () => {
    const { client } = makeClient({ user: null });
    mockCreate.mockResolvedValueOnce(client as never);
    expect((await PUT(put({ config: CONFIG }))).status).toBe(401);
  });
});
