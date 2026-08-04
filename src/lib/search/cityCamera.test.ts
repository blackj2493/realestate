import { describe, it, expect } from "vitest";
import { frameFromListings, resolveCityCamera } from "./cityCamera";
import type { ListingDocument } from "@/lib/typesense/client";

const at = (lat: number, lng: number) =>
  ({ location: [lat, lng] }) as unknown as ListingDocument;

describe("frameFromListings", () => {
  it("returns null when nothing has a usable location", () => {
    expect(frameFromListings([])).toBeNull();
    expect(frameFromListings([{ location: undefined } as unknown as ListingDocument])).toBeNull();
    expect(frameFromListings([at(NaN, -79)])).toBeNull();
  });

  it("centers on the median point and clamps the zoom into [8,14]", () => {
    const cam = frameFromListings([at(43.80, -79.60), at(43.85, -79.55), at(43.90, -79.50)]);
    expect(cam).not.toBeNull();
    expect(cam!.lat).toBeCloseTo(43.85, 2);
    expect(cam!.lng).toBeCloseTo(-79.55, 2);
    expect(cam!.zoom).toBeGreaterThanOrEqual(8);
    expect(cam!.zoom).toBeLessThanOrEqual(14);
  });

  it("a single listing frames tight (zoom capped at 14, no NaN)", () => {
    const cam = frameFromListings([at(43.65, -79.38)]);
    expect(cam).toEqual({ lat: 43.65, lng: -79.38, zoom: 13 });
  });
});

describe("resolveCityCamera", () => {
  it("uses the hand-tuned market camera for a quick-pick city (no Typesense query)", async () => {
    expect(await resolveCityCamera("Toronto")).toEqual({ lat: 43.6532, lng: -79.3832, zoom: 11 });
    // case-insensitive match against QUICK_PICK_MARKETS
    expect(await resolveCityCamera("ottawa")).toEqual({ lat: 45.4215, lng: -75.6972, zoom: 11 });
  });
});
