import { describe, it, expect } from "vitest";
import { RECORD_KIND_LABEL, RECORD_KIND_TONE, backOnMarketLabel, formatRecordDate } from "./recordKind";

describe("record kind presentation", () => {
  it("covers every deal kind with a label and a theme-aware tone", () => {
    for (const kind of ["sold", "leased", "offmarket"] as const) {
      expect(RECORD_KIND_LABEL[kind]).toBeTruthy();
      // Both halves present → the chip can never render dark-only text on a light page.
      expect(RECORD_KIND_TONE[kind]).toMatch(/text-\w+-700/);
      expect(RECORD_KIND_TONE[kind]).toMatch(/dark:text-\w+-300/);
    }
  });
});

describe("backOnMarketLabel", () => {
  it("names the asking price of the relist", () => {
    expect(backOnMarketLabel(599_900, "For Sale")).toBe("Back on the market — $599,900");
  });

  it("reads a relisted LEASE as a rental, not a sale", () => {
    expect(backOnMarketLabel(2_550, "For Lease")).toBe("For rent again — $2,550/mo");
  });

  it("still says the home is listed again when no price is attached", () => {
    expect(backOnMarketLabel(undefined, "For Sale")).toBe("Back on the market");
    expect(backOnMarketLabel(0, "For Sale")).toBe("Back on the market");
  });
});

describe("formatRecordDate", () => {
  it("renders the stored UTC-midnight date, not the viewer's local shift", () => {
    // 2026-04-24T00:00:00Z — a local-time render shows Apr 23 anywhere west of UTC.
    expect(formatRecordDate(Date.UTC(2026, 3, 24))).toBe("Apr 24, 2026");
  });
});
