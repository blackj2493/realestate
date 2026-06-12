import { describe, it, expect } from "vitest";
import {
  resolveListingStatus,
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
});
