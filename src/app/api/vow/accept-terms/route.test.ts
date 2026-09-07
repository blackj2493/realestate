import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/terms", () => ({ recordTermsAcceptance: vi.fn() }));
vi.mock("@/lib/alerts/welcomeEmail", () => ({ sendWelcomeEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({}),
  getCurrentUser: vi.fn().mockResolvedValue({ id: "u1", email: "a@b.c" }),
}));
// seedSignupRegion has its own suite; here we only care THAT the route calls it, with the
// cleaned region, and that a failure inside it cannot fail the acceptance.
vi.mock("@/lib/dashboard/seedSignupRegion", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dashboard/seedSignupRegion")>(
    "@/lib/dashboard/seedSignupRegion"
  );
  return {
    cleanSignupRegion: actual.cleanSignupRegion,
    seedSignupRegion: vi.fn().mockResolvedValue({
      region: "Ottawa",
      seeded: true,
      alerted: ["Ottawa"],
      error: null,
    }),
  };
});

import { recordTermsAcceptance } from "@/lib/auth/terms";
import { seedSignupRegion } from "@/lib/dashboard/seedSignupRegion";
import { POST } from "./route";

const mockRecord = vi.mocked(recordTermsAcceptance);
const mockSeed = vi.mocked(seedSignupRegion);

const ATTESTED = { notAgent: true, bonaFide: true, agree: true };

const post = (body: unknown) =>
  new Request("https://x/api/vow/accept-terms", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  mockSeed.mockClear();
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ ok: true, firstAcceptance: false, userId: "u1" });
});

describe("POST /api/vow/accept-terms — the region the signup form requires", () => {
  it("stores the chosen region", async () => {
    const res = await POST(post({ ...ATTESTED, region: "Ottawa" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, region: "Ottawa", seeded: true });
    expect(mockSeed).toHaveBeenCalledWith(expect.anything(), "u1", "Ottawa");
  });

  it("trims before storing, so ' Ottawa ' is not a second market", async () => {
    await POST(post({ ...ATTESTED, region: "  Ottawa  " }));
    expect(mockSeed).toHaveBeenCalledWith(expect.anything(), "u1", "Ottawa");
  });

  it("rejects a present-but-unusable region without recording acceptance", async () => {
    const res = await POST(post({ ...ATTESTED, region: "   " }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "region_invalid" });
    // The 400 must come BEFORE the write, or a retry double-records.
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it("rejects a region past the 80-char bound the reconcile enforces", async () => {
    const res = await POST(post({ ...ATTESTED, region: "x".repeat(81) }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/vow/accept-terms — a signup must never fail over the region", () => {
  it("accepts a body with NO region field at all (a pre-deploy bundle)", async () => {
    const res = await POST(post(ATTESTED));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, region: null, seeded: false });
    expect(mockRecord).toHaveBeenCalled();
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it("still returns ok when the seed reports a failure", async () => {
    mockSeed.mockResolvedValueOnce({
      region: null,
      seeded: false,
      alerted: [],
      error: "rls denied",
    });
    const res = await POST(post({ ...ATTESTED, region: "Ottawa" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, seeded: false });
  });

  it("seeds nothing when acceptance could not name the account", async () => {
    // userId absent = the session went away between the write and here. Degrade to the
    // pre-deploy path (no seed) rather than guessing whose workspace to write.
    mockRecord.mockResolvedValueOnce({ ok: true, firstAcceptance: false });
    const res = await POST(post({ ...ATTESTED, region: "Ottawa" }));
    expect(res.status).toBe(200);
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it("still returns ok when the seed throws", async () => {
    mockSeed.mockRejectedValueOnce(new Error("network"));
    const res = await POST(post({ ...ATTESTED, region: "Ottawa" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });
});

describe("POST /api/vow/accept-terms — the attestation gate still comes first", () => {
  it("400s on a missing attestation even when a valid region is supplied", async () => {
    const res = await POST(post({ notAgent: true, bonaFide: true, region: "Ottawa" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "attestations_required" });
    expect(mockSeed).not.toHaveBeenCalled();
  });

  it("propagates an unauthenticated acceptance as 401 and seeds nothing", async () => {
    mockRecord.mockResolvedValueOnce({ ok: false, error: "unauthenticated" });
    const res = await POST(post({ ...ATTESTED, region: "Ottawa" }));
    expect(res.status).toBe(401);
    expect(mockSeed).not.toHaveBeenCalled();
  });
});
