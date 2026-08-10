import { describe, it, expect } from "vitest";
import {
  ROW_STATUS_CHIP,
  ROW_STATUS_LABEL,
  ROW_STATUS_TONE,
  SECTION_ORDER,
  SECTION_TITLE,
  activeRowStatus,
  backOnMarketLabel,
  formatRecordDate,
  formatRowPrice,
  isLeaseTransaction,
  localityLabel,
  sectionForCategory,
} from "./searchRows";

const ALL = ["forsale", "forlease", "sold", "leased", "offmarket"] as const;

describe("row status presentation", () => {
  it("covers every status with a label and theme-aware colours", () => {
    for (const st of ALL) {
      expect(ROW_STATUS_LABEL[st]).toBeTruthy();
      // Both halves present → the row can never render dark-only ink on a light ground.
      expect(ROW_STATUS_TONE[st]).toMatch(/text-\w+-700/);
      expect(ROW_STATUS_TONE[st]).toMatch(/dark:text-\w+-\d{3}/);
      expect(ROW_STATUS_CHIP[st]).toMatch(/dark:text-\w+-\d{3}/);
    }
  });
});

describe("sections describe what a result IS, never its state", () => {
  it("puts map-able things in Places and openable things in Listings", () => {
    expect(sectionForCategory("community")).toBe("places");
    expect(sectionForCategory("geo")).toBe("places");
    expect(sectionForCategory("school")).toBe("places");
    expect(sectionForCategory("address")).toBe("listings");
    expect(sectionForCategory("mls")).toBe("listings");
    expect(sectionForCategory("soldAddress")).toBe("listings");
  });

  it("renders Places first so the map exit is never below the fold", () => {
    expect(SECTION_ORDER[0]).toBe("places");
    expect(SECTION_ORDER.map((s) => SECTION_TITLE[s])).toEqual(["Places", "Listings"]);
  });

  it("has no section named for a status", () => {
    const titles = SECTION_ORDER.map((s) => SECTION_TITLE[s].toLowerCase());
    for (const banned of ["for sale", "for lease", "sold", "leased", "off market"]) {
      expect(titles).not.toContain(banned);
    }
  });
});

describe("a lease never reads as a sale", () => {
  it("derives the status from the feed's TransactionType", () => {
    expect(activeRowStatus("For Sale")).toBe("forsale");
    expect(activeRowStatus("For Lease")).toBe("forlease");
    expect(activeRowStatus("For Rent")).toBe("forlease");
    // Unknown/missing defaults to a sale — matching how the rest of the app reads the feed.
    expect(activeRowStatus(undefined)).toBe("forsale");
  });

  it("appends /mo to a monthly rent", () => {
    expect(formatRowPrice(2550, true)).toBe("$2,550/mo");
    expect(formatRowPrice(599900)).toBe("$599,900");
  });

  it("recognises lease transaction types", () => {
    expect(isLeaseTransaction("For Lease")).toBe(true);
    expect(isLeaseTransaction("For Sale")).toBe(false);
    expect(isLeaseTransaction(null)).toBe(false);
  });
});

describe("backOnMarketLabel", () => {
  it("names the asking price of the relist", () => {
    expect(backOnMarketLabel(599900, "For Sale")).toBe("Back on the market — $599,900");
  });

  it("reads a relisted lease as a rental", () => {
    expect(backOnMarketLabel(2550, "For Lease")).toBe("For rent again — $2,550/mo");
  });

  it("still says the home is listed again with no price attached", () => {
    expect(backOnMarketLabel(undefined, "For Sale")).toBe("Back on the market");
    expect(backOnMarketLabel(0, "For Sale")).toBe("Back on the market");
  });
});

describe("localityLabel — the feed names places, not the geocoder", () => {
  // 90 Osler Drive: the feed files it as City "Hamilton", CityRegion "Dundas"; the
  // geocoder answers "Dundas". Neither is wrong — they name different levels of one
  // hierarchy. Only the feed's vocabulary exists in our region taxonomy and in the
  // /address URLs already indexed, so labels are built from the feed.
  it("shows the finer-grained region before its city", () => {
    expect(localityLabel("Hamilton", "Dundas")).toBe("Dundas · Hamilton");
  });

  it("does not repeat itself when region and city agree", () => {
    expect(localityLabel("Barrhaven", "Barrhaven")).toBe("Barrhaven");
    expect(localityLabel("Kanata", "kanata")).toBe("Kanata");
  });

  // Verified live: X12941486 comes back with CityRegion "9008 - Kanata - Morgan's
  // Grant/South March". A raw board value must never reach a label.
  it("strips Ottawa's OREB board prefix and does not stutter the city", () => {
    expect(localityLabel("Kanata", "9008 - Kanata - Morgan's Grant/South March"))
      .toBe("Kanata - Morgan's Grant/South March");
  });

  it("renders a Toronto district by its neighbourhoods, not its code", () => {
    expect(localityLabel("Toronto", "Toronto C01")).toBe("Downtown & Waterfront · Toronto");
  });

  it("degrades to whichever name exists", () => {
    expect(localityLabel("Hamilton", null)).toBe("Hamilton");
    expect(localityLabel(null, "Dundas")).toBe("Dundas");
    expect(localityLabel(null, null)).toBe("");
  });
});

describe("formatRecordDate", () => {
  it("renders the stored UTC-midnight date, not the viewer's local shift", () => {
    // 2026-04-24T00:00:00Z — a local-time render shows Apr 23 anywhere west of UTC.
    expect(formatRecordDate(Date.UTC(2026, 3, 24))).toBe("Apr 24, 2026");
  });
});
