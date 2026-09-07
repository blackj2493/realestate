import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
// followRegion has its own suite; here we only care that the route authorizes, passes the
// body through, and maps the result onto the right status.
vi.mock("@/lib/dashboard/followRegion", () => ({
  followRegion: vi.fn().mockResolvedValue({
    ok: true,
    added: true,
    regions: ["Ottawa"],
    alerted: ["Ottawa"],
    error: null,
  }),
}));

import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { followRegion } from "@/lib/dashboard/followRegion";
import { POST } from "./route";

const mockClient = vi.mocked(createSupabaseServerClient);
const mockFollow = vi.mocked(followRegion);

const signedInAs = (user: { id: string } | null) =>
  mockClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never);

/** Each test gets a distinct IP so the shared rate limiter never leaks across cases. */
let ip = 0;
const post = (body: unknown) =>
  new Request("https://x/api/areas/follow", {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${++ip}` },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

beforeEach(() => {
  mockClient.mockReset();
  mockFollow.mockClear();
  signedInAs({ id: "u1" });
});

describe("POST /api/areas/follow", () => {
  it("follows the region for the signed-in account", async () => {
    const res = await POST(post({ region: "Ottawa" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      added: true,
      regions: ["Ottawa"],
    });
    expect(mockFollow).toHaveBeenCalledWith(expect.anything(), "u1", "Ottawa", {
      source: "prompt",
    });
  });

  it("401s when nobody is signed in, and writes nothing", async () => {
    signedInAs(null);
    const res = await POST(post({ region: "Ottawa" }));
    expect(res.status).toBe(401);
    expect(mockFollow).not.toHaveBeenCalled();
  });

  it("400s on an unusable region", async () => {
    mockFollow.mockResolvedValueOnce({
      ok: false,
      added: false,
      regions: [],
      alerted: [],
      error: "region_invalid",
    });
    const res = await POST(post({ region: "" }));
    expect(res.status).toBe(400);
  });

  it("500s when the write itself failed", async () => {
    mockFollow.mockResolvedValueOnce({
      ok: false,
      added: false,
      regions: [],
      alerted: [],
      error: "rls denied",
    });
    const res = await POST(post({ region: "Ottawa" }));
    expect(res.status).toBe(500);
  });

  it("still succeeds when only the alert reconcile failed — the area IS saved", async () => {
    mockFollow.mockResolvedValueOnce({
      ok: true,
      added: true,
      regions: ["Ottawa"],
      alerted: [],
      error: "reconcile down",
    });
    const res = await POST(post({ region: "Ottawa" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, added: true });
  });

  it("survives a malformed body by letting followRegion reject it", async () => {
    mockFollow.mockResolvedValueOnce({
      ok: false,
      added: false,
      regions: [],
      alerted: [],
      error: "region_invalid",
    });
    const req = new Request("https://x/api/areas/follow", {
      method: "POST",
      headers: { "x-forwarded-for": `10.0.0.${++ip}` },
      body: "not json",
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(mockFollow).toHaveBeenCalledWith(expect.anything(), "u1", undefined, {
      source: "prompt",
    });
  });
});
