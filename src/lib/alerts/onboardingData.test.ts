import { describe, it, expect } from "vitest";
import { buildExampleAreaData, EXAMPLE_REGION_CANDIDATES } from "./onboardingData";
import type { OnboardingAreaData } from "./onboardingEmails";

// Inject a fake resolver so no Typesense call happens — we're testing the never-ship-a-0
// candidate fallback, not the live query.
const area = (name: string, activeCount: number | null): OnboardingAreaData => ({
  areaName: name,
  newCount: activeCount,
  activeCount,
  rows: [],
});

describe("buildExampleAreaData — never ships a 0/empty example", () => {
  it("uses the primary candidate when it has live inventory (and stops there)", async () => {
    const tried: string[] = [];
    const data = await buildExampleAreaData(async (r) => {
      tried.push(r);
      return area(r, 266);
    });
    expect(data?.areaName).toBe(EXAMPLE_REGION_CANDIDATES[0]);
    expect(tried).toEqual([EXAMPLE_REGION_CANDIDATES[0]]);
  });

  it("falls through to the next candidate when the primary resolves to 0 (the Woodbridge bug)", async () => {
    const data = await buildExampleAreaData(async (r) =>
      area(r, r === EXAMPLE_REGION_CANDIDATES[0] ? 0 : 999)
    );
    expect(data?.areaName).toBe(EXAMPLE_REGION_CANDIDATES[1]);
    expect(data?.activeCount).toBe(999);
  });

  it("skips a candidate that throws and tries the next", async () => {
    const data = await buildExampleAreaData(async (r) => {
      if (r === EXAMPLE_REGION_CANDIDATES[0]) throw new Error("typesense down");
      return area(r, 500);
    });
    expect(data?.areaName).toBe(EXAMPLE_REGION_CANDIDATES[1]);
  });

  it("returns null only when NOTHING resolves (renderer degrades to generic copy)", async () => {
    const data = await buildExampleAreaData(async (r) => area(r, 0));
    expect(data).toBeNull();
  });
});
