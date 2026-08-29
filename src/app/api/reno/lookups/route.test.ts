import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { insert, getCurrentUser } = vi.hoisted(() => ({
  insert: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getServiceRoleClient: () => ({ from: () => ({ insert }) }),
}));
vi.mock("@/lib/supabase/server", () => ({ getCurrentUser }));
vi.mock("@/lib/rateLimit", () => ({
  makeRateLimiter: () => ({ check: () => ({ allowed: true }) }),
  clientIpFrom: () => "1.2.3.4",
}));

import { POST } from "./route";

const BODY = {
  address: "128 Maplecrest Ave, Vaughan, ON",
  lat: 43.86,
  lng: -79.51,
  city: "Vaughan",
  cityRegion: "Maple",
  propertySubType: "Detached",
  matched: true,
};

const post = (body: unknown) =>
  POST(new NextRequest("http://x/api/reno/lookups", { method: "POST", body: JSON.stringify(body) }));

const row = () => insert.mock.calls[0][0];

beforeEach(() => {
  insert.mockReset().mockResolvedValue({ error: null });
  getCurrentUser.mockReset();
});

/**
 * The rule these guard is migration 129's: an address is stored only when a user owns the
 * row. An anonymous lookup cannot be emailed, so keeping the home address of someone we
 * can never contact is a liability that buys nothing — while the community still records
 * the demand.
 */
describe("POST /api/reno/lookups", () => {
  it("keeps the address for a signed-in visitor", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    const res = await post(BODY);

    expect(res.status).toBe(200);
    expect(row()).toMatchObject({
      user_id: "user-1",
      address: "128 Maplecrest Ave, Vaughan, ON",
      lat: 43.86,
      lng: -79.51,
      city: "Vaughan",
      city_region: "Maple",
      property_sub_type: "Detached",
      matched: true,
    });
    expect(row().address_key).toBeTruthy();
  });

  it("drops every address field for an anonymous visitor, and keeps the community", async () => {
    getCurrentUser.mockResolvedValue(null);
    await post(BODY);

    const r = row();
    expect(r.user_id).toBeNull();
    expect(r.address).toBeNull();
    expect(r.address_key).toBeNull();
    expect(r.lat).toBeNull();
    expect(r.lng).toBeNull();
    // The demand signal survives — that is the whole point of still writing the row.
    expect(r.city).toBe("Vaughan");
    expect(r.city_region).toBe("Maple");
    expect(r.property_sub_type).toBe("Detached");
  });

  it("records a lookup the cohort tree could not match", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    await post({ ...BODY, matched: false });
    // A miss maps where the AVM has no coverage, so it is worth a row of its own.
    expect(row().matched).toBe(false);
  });

  it("writes nothing when the lookup carries no geography at all", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    const res = await post({ address: "somewhere" });

    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("never fails the visitor's renovation answer when the write fails", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    insert.mockResolvedValue({ error: { message: "boom" } });
    // The funnel ignores this response; what matters is that it resolves rather than throws.
    await expect(post(BODY)).resolves.toBeDefined();
  });
});
