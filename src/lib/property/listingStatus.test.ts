import { describe, it, expect } from "vitest";
import {
  resolveListingStatus,
  fillClosePriceFromSaleHistory,
  pickSoldAccuracy,
  gateListingStatus,
  isOnMarket,
  type DelistedRowLite,
} from "./listingStatus";

const delistedRow = (over: Partial<DelistedRowLite> = {}): DelistedRowLite => ({
  mls_status: "Terminated",
  delisted_date: "2026-03-14",
  days_on_market: 71,
  list_price: 949_900,
  ...over,
});

describe("resolveListingStatus — conditional sales (N13642346 regression)", () => {
  // The bug: "sold conditional" missed `mls === "sold"` by one word, fell through every
  // branch, and returned { kind: "active" } — so the detail page rendered a full For Sale
  // listing, live "Book a viewing" CTA and all, for a home already under contract. The
  // feed was right the whole time; only the resolver lost the information.
  it("resolves Sold Conditional as conditional, NOT active", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Active", MlsStatus: "Sold Conditional", ListPrice: 699_900 },
      null
    );
    expect(s).toEqual({
      kind: "conditional",
      label: "SOLD CONDITIONAL",
      mlsStatus: "Sold Conditional",
    });
  });

  it("keeps the escape-clause wording verbatim — it is the part a buyer can act on", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Active", MlsStatus: "Sold Conditional Escape Clause" },
      null
    );
    expect(s).toMatchObject({ kind: "conditional", mlsStatus: "Sold Conditional Escape Clause" });
  });

  it("labels a conditional LEASE as such", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Active", MlsStatus: "Leased Conditional" }, null)
    ).toMatchObject({ kind: "conditional", label: "LEASED CONDITIONAL" });
  });

  it("never publishes a close price or date for a deal that is not firm", () => {
    const s = resolveListingStatus(
      {
        StandardStatus: "Active",
        MlsStatus: "Sold Conditional",
        // Even if the feed leaks these onto a conditional, they are not a firm sale.
        ClosePrice: 720_000,
        PurchaseContractDate: "2026-08-19",
      },
      null
    );
    expect(s.kind).toBe("conditional");
    expect(s).not.toHaveProperty("closePrice");
    expect(s).not.toHaveProperty("soldDate");
  });

  it("is on-market inventory (keeps metrics and CTAs); sold/delisted/unavailable are not", () => {
    expect(isOnMarket({ kind: "active" })).toBe(true);
    expect(
      isOnMarket({ kind: "conditional", label: "SOLD CONDITIONAL", mlsStatus: "Sold Conditional" })
    ).toBe(true);
    expect(isOnMarket({ kind: "sold", label: "SOLD", closePrice: 1, soldDate: null })).toBe(false);
    expect(isOnMarket({ kind: "unavailable", lastSeen: null })).toBe(false);
    expect(
      isOnMarket({
        kind: "delisted",
        mlsStatus: null,
        delistedDate: null,
        daysOnMarket: null,
        lastListPrice: null,
      })
    ).toBe(false);
  });

  // ── precedence: a conditional is an ACTIVE-family status, so its payload freezes the
  // same way a plain Active payload does. Every stated or verified outcome outranks it.
  it("a firm close outranks a stale conditional on the same payload", () => {
    expect(
      resolveListingStatus(
        { StandardStatus: "Closed", MlsStatus: "Sold Conditional", ClosePrice: 720_000 },
        null
      ).kind
    ).toBe("sold");
  });

  it("a de-list record outranks a frozen conditional payload", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Active", MlsStatus: "Sold Conditional" }, delistedRow())
        .kind
    ).toBe("delisted");
  });

  it("a feed that stopped serving the key outranks a months-old conditional", () => {
    // "Sold Conditional" from a listing we have not heard about since is exactly the
    // staleness the `unavailable` state exists to stop us publishing.
    expect(
      resolveListingStatus({ StandardStatus: "Active", MlsStatus: "Sold Conditional" }, null, {
        orphaned: true,
        lastSeen: "2026-06-08",
      }).kind
    ).toBe("unavailable");
  });

  it("Deal Fell Through is back on the market, not conditional", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Active", MlsStatus: "Deal Fell Through" }, null)
    ).toEqual({ kind: "active" });
  });

  it("gating leaves a conditional untouched — it carries no VOW data to strip", () => {
    const s = resolveListingStatus(
      { StandardStatus: "Active", MlsStatus: "Sold Conditional" },
      null
    );
    expect(gateListingStatus(s, false)).toEqual(s);
    expect(gateListingStatus(s, true)).toEqual(s);
  });
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
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: 875_000, soldDate: "2026-06-09" });
  });

  it("sold date prefers PurchaseContractDate (firm date) over CloseDate (future possession)", () => {
    // A firm-but-not-yet-closed sale: contract date is now, CloseDate is months out.
    // The badge must read the firm date, not the future possession date.
    const s = resolveListingStatus(
      {
        MlsStatus: "Sold",
        ClosePrice: 875_000,
        PurchaseContractDate: "2026-05-20",
        CloseDate: "2026-07-31",
      },
      null
    );
    expect(s).toMatchObject({ kind: "sold", soldDate: "2026-05-20" });
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
    expect(s).toEqual({ kind: "sold", label: "SOLD", closePrice: null, soldDate: "2026-06-01" });
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

describe("resolveListingStatus — feed absence", () => {
  const absent = { orphaned: true, lastSeen: "2026-06-08" };

  it("stays active when the feed still serves the listing", () => {
    expect(
      resolveListingStatus({ StandardStatus: "Active" }, null, { orphaned: false, lastSeen: null })
    ).toEqual({ kind: "active" });
  });

  it("stays active when no verdict has been recorded", () => {
    // Absence of evidence must not remove a listing — same rule the reindex filter uses.
    expect(resolveListingStatus({ StandardStatus: "Active" }, null, null)).toEqual({
      kind: "active",
    });
    expect(resolveListingStatus({ StandardStatus: "Active" }, null)).toEqual({ kind: "active" });
  });

  it("reports unavailable when the feed stopped serving a frozen-Active row", () => {
    // E13415990: last served 2026-06-08, no close record and no de-list record anywhere.
    expect(resolveListingStatus({ StandardStatus: "Active", MlsStatus: "New" }, null, absent)).toEqual(
      { kind: "unavailable", lastSeen: "2026-06-08" }
    );
  });

  it("never claims an outcome it was not told — a stated status always wins", () => {
    // The whole point: we know it is gone, NOT that it leased. Publishing a transaction
    // the feed never sent is a compliance problem, not just a wrong label.
    expect(
      resolveListingStatus({ StandardStatus: "Closed", MlsStatus: "Leased" }, null, absent)
    ).toMatchObject({ kind: "sold", label: "LEASED" });
    expect(
      resolveListingStatus({ StandardStatus: "Active" }, delistedRow(), absent)
    ).toMatchObject({ kind: "delisted", mlsStatus: "Terminated" });
  });

  it("carries no date when the caller could not establish one", () => {
    // getListingDetail passes null unless listings.last_seen_at has actually MOVED since
    // insert. The column defaults to now() at insert, so on an unstamped row it is the
    // creation date — and the page prints it as the day the board stopped serving the
    // listing. 2,294 of 7,908 unavailable pages were in that position on 2026-08-27.
    // No date beats a wrong one.
    expect(
      resolveListingStatus({ StandardStatus: "Active" }, null, { orphaned: true, lastSeen: null })
    ).toEqual({ kind: "unavailable", lastSeen: null });
  });

  it("strips the last-seen date for anon but keeps the badge", () => {
    expect(gateListingStatus({ kind: "unavailable", lastSeen: "2026-06-08" }, false)).toEqual({
      kind: "unavailable",
      lastSeen: null,
    });
    expect(gateListingStatus({ kind: "unavailable", lastSeen: "2026-06-08" }, true)).toEqual({
      kind: "unavailable",
      lastSeen: "2026-06-08",
    });
  });
});

describe("fillClosePriceFromSaleHistory", () => {
  const soldNoPrice = {
    kind: "sold",
    label: "SOLD",
    closePrice: null,
    soldDate: null,
  } as const;

  it("fills closePrice/soldDate from this listing's OWN sale event only", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
      { listing_key: "X13146238", close_price: 875_000, close_date: "2026-06-09" },
    ]);
    expect(filled).toEqual({
      kind: "sold",
      label: "SOLD",
      closePrice: 875_000,
      soldDate: "2026-06-09",
    });
  });

  it("does NOT borrow a prior campaign's sale price (stays null)", () => {
    const filled = fillClosePriceFromSaleHistory(soldNoPrice, "X13146238", [
      { listing_key: "OLD2019", close_price: 600_000, close_date: "2019-05-01" },
    ]);
    expect(filled.kind === "sold" && filled.closePrice).toBeNull();
  });

  it("does NOT overwrite an existing soldDate", () => {
    const withDate = { ...soldNoPrice, soldDate: "2026-05-01" };
    const filled = fillClosePriceFromSaleHistory(withDate, "X13146238", [
      { listing_key: "X13146238", close_price: 875_000, close_date: "2026-06-09" },
    ]);
    expect(filled).toMatchObject({ closePrice: 875_000, soldDate: "2026-05-01" });
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

  it("picks Comparable Sales (AVM) when it was nearer", () => {
    const a = pickSoldAccuracy({ closePrice: 700_000, avmValue: 705_000, expectedSalePrice: 850_000 })!;
    expect(a.modelLabel).toBe("Comparable Sales");
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

describe("gateListingStatus", () => {
  it("authed users see everything unchanged", () => {
    const sold = { kind: "sold", label: "SOLD", closePrice: 875_000, soldDate: "2026-06-09" } as const;
    expect(gateListingStatus(sold, true)).toBe(sold);
  });

  it("anon keeps the sold KIND + label but loses price/date (HouseSigma model)", () => {
    const gated = gateListingStatus(
      { kind: "sold", label: "LEASED", closePrice: 2_600, soldDate: "2026-06-09" },
      false
    );
    expect(gated).toEqual({ kind: "sold", label: "LEASED", closePrice: null, soldDate: null });
  });

  it("anon keeps the delisted KIND but loses all VOW specifics", () => {
    const gated = gateListingStatus(
      {
        kind: "delisted",
        mlsStatus: "Terminated",
        delistedDate: "2026-03-14",
        daysOnMarket: 71,
        lastListPrice: 949_900,
      },
      false
    );
    expect(gated).toEqual({
      kind: "delisted",
      mlsStatus: null,
      delistedDate: null,
      daysOnMarket: null,
      lastListPrice: null,
    });
  });

  it("active passes through for anon", () => {
    expect(gateListingStatus({ kind: "active" }, false)).toEqual({ kind: "active" });
  });
});
