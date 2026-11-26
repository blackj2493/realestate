import { describe, expect, it, vi } from "vitest";

// react.cache exists only in the server-components build.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/supabase/client", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/typesense/client", () => ({ searchListings: vi.fn() }));

const { dayLabel, openHouseWindow, openHousesPath, timeLabel } = await import("./openHouses");

describe("openHouses", () => {
  it("labels a local date and a Toronto time range", () => {
    expect(dayLabel("2026-11-28")).toBe("Saturday, November 28");
    // 19:30Z-21:00Z is 2:30-4:00 p.m. in Toronto (EST).
    expect(timeLabel({ date: "2026-11-29", startAt: "2026-11-29T19:30:00Z", endAt: "2026-11-29T21:00:00Z", virtual: false, url: null })).toBe(
      "2:30 p.m. to 4:00 p.m.",
    );
    expect(timeLabel({ date: "2026-11-29", startAt: null, endAt: null, virtual: false, url: null })).toBe("");
  });

  it("covers 7 Toronto days from today", () => {
    // 03:00Z on Nov 27 is still Nov 26 in Toronto.
    expect(openHouseWindow(new Date("2026-11-27T03:00:00Z"))).toEqual({ from: "2026-11-26", to: "2026-12-02" });
  });

  it("builds the paths", () => {
    expect(openHousesPath()).toBe("/open-houses");
    expect(openHousesPath("vaughan")).toBe("/open-houses/vaughan");
  });
});
