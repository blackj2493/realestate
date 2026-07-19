import { describe, expect, it } from "vitest";
import { classifyAddressWatch } from "./addressWatch";

const T0 = Date.parse("2026-07-01T00:00:00Z");
const BEFORE = T0 - 86_400_000;
const AFTER = T0 + 86_400_000;

describe("classifyAddressWatch — first sight (last_listing_key NULL)", () => {
  it("baselines silently when the address has no active listing", () => {
    expect(classifyAddressWatch({ lastListingKey: null, createdAtMs: T0, current: null })).toEqual({
      alert: false,
      baseline: "",
      silent: true,
    });
  });

  it("baselines silently when the active listing predates the subscription", () => {
    expect(
      classifyAddressWatch({
        lastListingKey: null,
        createdAtMs: T0,
        current: { listingKey: "N1", entryMs: BEFORE },
      })
    ).toEqual({ alert: false, baseline: "N1", silent: true });
  });

  it("alerts when the listing entered the market AFTER the subscription", () => {
    expect(
      classifyAddressWatch({
        lastListingKey: null,
        createdAtMs: T0,
        current: { listingKey: "N1", entryMs: AFTER },
      })
    ).toEqual({ alert: true, baseline: "N1" });
  });
});

describe("classifyAddressWatch — baselined", () => {
  it("alerts when a listing appears after a no-listing baseline", () => {
    expect(
      classifyAddressWatch({ lastListingKey: "", createdAtMs: T0, current: { listingKey: "N2", entryMs: AFTER } })
    ).toEqual({ alert: true, baseline: "N2" });
  });

  it("alerts a NEW campaign key (relist) even when the old key was the baseline", () => {
    expect(
      classifyAddressWatch({ lastListingKey: "N1", createdAtMs: T0, current: { listingKey: "N2", entryMs: AFTER } })
    ).toEqual({ alert: true, baseline: "N2" });
  });

  it("stays silent while the same campaign remains active", () => {
    expect(
      classifyAddressWatch({ lastListingKey: "N1", createdAtMs: T0, current: { listingKey: "N1", entryMs: BEFORE } })
    ).toEqual({ alert: false });
  });

  it("quietly resets to no-listing when the campaign leaves the market", () => {
    expect(classifyAddressWatch({ lastListingKey: "N1", createdAtMs: T0, current: null })).toEqual({
      alert: false,
      baseline: "",
      silent: true,
    });
  });

  it("does nothing when there is still no listing", () => {
    expect(classifyAddressWatch({ lastListingKey: "", createdAtMs: T0, current: null })).toEqual({ alert: false });
  });
});
