import { describe, it, expect } from "vitest";
import {
  resolveListingStatus,
  fillClosePriceFromSaleHistory,
  pickSoldAccuracy,
  type DelistedRowLite,
} from "./listingStatus";

const delistedRow = (over: Partial<DelistedRowLite> = {}): DelistedRowLite => ({
  mls_status: "Terminated",
  delisted_date: "2026-03-14",
  days_on_market: 71,
  list_price: 949_900,
  ...over,
});

describe("resolveListingStatus", () => {
  it("active when payload is Active and no delisted row", () => {
    expect(resolveListingStatus({ StandardStatus: "Active" }, null)).toEqual({ kind: "active" });
  });

  it("sold from StandardStatus=Closed with ClosePrice + CloseDate", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 875_000, CloseDate: "2026-06-09" },
      null
    );
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: 875_000, closeDate: "2026-06-09" });
  });

  it("sold from MlsStatus=Sold alone (case-insensitive, payload StandardStatus stale)", () => {
    const s = resolveListingStatus({ StandardStatus: "Active", MlsStatus: "sold" }, null);
    expect(s.kind).toBe("sold");
  });

  it("LEASED label from MlsStatus=Leased or TransactionType=For Lease", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Closed", MlsStatus: "Leased", ClosePrice: 2600 }, null)
    ).toMatchObject({ kind: "sold", label: "LEASED" });
    expect(
      resolveListingStatus(
        { StandardStatus: "Closed", MlsStatus: "Sold", TransactionType: "For Lease" },
        null
      )
    ).toMatchObject({ kind: "sold", label: "LEASED" });
  });

  it("sold with non-disclosed price → closePrice null; falls back to PurchaseContractDate", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 0, PurchaseContractDate: "2026-06-01" },
      null
    );
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: null, closeDate: "2026-06-01" });
  });

  it("delisted from the archive row when payload looks frozen-Active", () => {
    const s = resolveListingStatus({ StandardStatus: "Active" }, delistedRow());
    expect(s).toEqual({
      kind: "delisted",
      mlsStatus: "Terminated",
      delistedDate: "2026-03-14",
      daysOnMarket: 71,
      lastListPrice: 949_900,
    });
  });

  it("sold wins over a delisted row (terminated then sold on relist)", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Closed", MlsStatus: "Sold", ClosePrice: 875_000 },
      delistedRow()
    );
    expect(s.kind).toBe("sold");
  });

  it("leased from MlsStatus=Leased alone (stale-Active StandardStatus)", () => {
    const s = resolveListingStatus({ StandardStatus: "Active", MlsStatus: "Leased" }, null);
    expect(s).toMatchObject({ kind: "sold", label: "LEASED" });
  });
});

describe("fillClosePriceFromSaleHistory", () => {
  const soldNoPrice = {
    kind: "sold",
    label: "SOLD",
    closePrice: null,
    closeDate: null,
  } as const;

  it("fills closePrice/closeDate from this listing's OWN sale event only", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
      { listing_key: "X13146238", close_price: 875_000, close_date: "2026-06-09" },
    ]);
    expect(filled).toEqual({
      kind: "sold",
      label: "SOLD",
      closePrice: 875_000,
      closeDate: "2026-06-09",
    });
  });

  it("does NOT borrow a prior campaign's sale price (stays null)", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
    ]);
    expect(filled.kind === "sold" && filled.closePrice).toBeNull();
  });

  it("is a no-op for already-priced sold and for non-sold statuses", () => {
    const priced = { ...soldNoPrice, closePrice: 875_000 };
    expect(fillClosePriceFromSaleHistory(priced, "X13146238", [])).toBe(priced);
    const active = { kind: "active" } as const;
    expect(fillClosePriceFromSaleHistory(active, "X13146238", [])).toBe(active);
  });
});

describe("pickSoldAccuracy", () => {
  it("null when there is no close price or no models", () => {
    expect(pickSoldAccuracy({ closePrice: null, avmValue: 700_000, expectedSalePrice: 870_000 })).toBeNull();
    expect(pickSoldAccuracy({ closePrice: 875_000, avmValue: null, expectedSalePrice: null })).toBeNull();
  });

  it("picks the closest model — usually Expected Sale Price", () => {
    const a = pickSoldAccuracy({ closePrice: 875_000, avmValue: 709_484, expectedSalePrice: 872_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
    expect(a.estimateValue).toBe(872_000);
    expect(a.closePrice).toBe(875_000);
    expect(a.diffPct).toBeCloseTo((872_000 - 875_000) / 875_000, 6);
  });

  it("picks True Value when the AVM was nearer", () => {
    const a = pickSoldAccuracy({ closePrice: 700_000, avmValue: 705_000, expectedSalePrice: 850_000 })!;
    expect(a.modelLabel).toBe("True Value");
    expect(a.estimateValue).toBe(705_000);
  });

  it("works with a single available model", () => {
    const a = pickSoldAccuracy({ closePrice: 875_000, avmValue: null, expectedSalePrice: 880_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
    expect(a.diffPct).toBeGreaterThan(0); // signed: estimate above close
  });

  it("ties go to Expected Sale Price", () => {
    const a = pickSoldAccuracy({ closePrice: 800_000, avmValue: 810_000, expectedSalePrice: 790_000 })!;
    expect(a.modelLabel).toBe("Expected Sale Price");
  });
});
