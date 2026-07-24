import { describe, it, expect } from "vitest";
import { assembleSaleRecord } from "./saleRecord";
import type { CampaignEvent } from "@/lib/campaignHistory/types";

function ev(overrides: Partial<CampaignEvent>): CampaignEvent {
  return {
    listing_key: "K1",
    transaction_type: "Sale",
    status: "Sold",
    entry_date: "2026-06-11",
    end_date: "2026-06-18",
    end_reason: "Sold",
    list_price: 999_000,
    original_list_price: 999_000,
    close_price: 1_152_000,
    brokerage: "Royal LePage Signature",
    price_change_date: null,
    address: "82 Curzon St, Toronto",
    ...overrides,
  };
}

describe("assembleSaleRecord", () => {
  it("builds the hero from the newest closed sale (over-ask, DOM)", () => {
    const r = assembleSaleRecord([ev({})]);
    expect(r.latestSale).not.toBeNull();
    expect(r.latestSale!.kind).toBe("sold");
    expect(r.latestSale!.closePrice).toBe(1_152_000);
    expect(r.latestSale!.askAtSale).toBe(999_000);
    expect(r.latestSale!.overAskPct).toBeCloseTo(15.3, 1);
    expect(r.latestSale!.domDays).toBe(7);
    expect(r.latestSale!.originalAsk).toBeNull(); // no in-campaign change
  });

  it("surfaces the original ask only when it differs from the final ask", () => {
    const r = assembleSaleRecord([
      ev({ list_price: 949_000, original_list_price: 999_000, close_price: 940_000, price_change_date: "2026-06-14" }),
    ]);
    expect(r.latestSale!.askAtSale).toBe(949_000);
    expect(r.latestSale!.originalAsk).toBe(999_000);
    expect(r.latestSale!.overAskPct).toBeCloseTo(-0.95, 1); // vs the FINAL ask
  });

  it("sorts newest first and computes gain + annualized appreciation vs the prior sale", () => {
    const r = assembleSaleRecord([
      ev({ listing_key: "OLD", entry_date: "2019-09-10", end_date: "2019-10-14", list_price: 849_000, close_price: 818_000 }),
      ev({ listing_key: "NEW" }),
    ]);
    expect(r.campaigns[0].listingKey).toBe("NEW");
    expect(r.latestSale!.prevSale).toEqual({ closePrice: 818_000, endDateISO: "2019-10-14" });
    expect(r.latestSale!.gain).toBe(334_000);
    // ~6.67 years, 818k → 1.152M ≈ 5.3%/yr compound
    expect(r.latestSale!.annualizedPct).toBeGreaterThan(4.5);
    expect(r.latestSale!.annualizedPct).toBeLessThan(6);
  });

  it("never uses a lease or a failed campaign as the prior sale", () => {
    const r = assembleSaleRecord([
      ev({ listing_key: "TERM", status: "Terminated", end_reason: "Terminated", end_date: "2022-05-01", close_price: null }),
      ev({ listing_key: "LEASE", transaction_type: "Lease", status: "Leased", end_reason: "Leased", end_date: "2022-03-15", close_price: 3_400 }),
      ev({ listing_key: "NEW" }),
    ]);
    expect(r.latestSale!.listingKey).toBe("NEW");
    expect(r.latestSale!.prevSale).toBeNull();
    expect(r.latestSale!.gain).toBeNull();
  });

  it("suppresses annualized appreciation under one year (flip) but keeps the gain", () => {
    const r = assembleSaleRecord([
      ev({ listing_key: "OLD", end_date: "2026-01-10", entry_date: "2025-12-01", close_price: 1_050_000 }),
      ev({ listing_key: "NEW" }),
    ]);
    expect(r.latestSale!.gain).toBe(102_000);
    expect(r.latestSale!.annualizedPct).toBeNull();
  });

  it("a leased hero shows the lease but never computes sale appreciation", () => {
    const r = assembleSaleRecord([
      ev({ listing_key: "OLD", end_date: "2019-10-14", close_price: 818_000 }),
      ev({ listing_key: "L", transaction_type: "Lease", status: "Leased", end_reason: "Leased", end_date: "2026-07-01", close_price: 3_400, list_price: 3_250 }),
    ]);
    expect(r.latestSale!.kind).toBe("leased");
    expect(r.latestSale!.closePrice).toBe(3_400);
    expect(r.latestSale!.prevSale).toBeNull();
  });

  it("skips non-disclosure sales (ClosePrice 0) when picking the hero", () => {
    const r = assembleSaleRecord([
      ev({ listing_key: "ND", close_price: 0, end_date: "2026-07-01" }),
      ev({ listing_key: "REAL", end_date: "2026-06-18" }),
    ]);
    expect(r.latestSale!.listingKey).toBe("REAL");
  });

  it("terminated-only history → rows but no hero", () => {
    const r = assembleSaleRecord([
      ev({ status: "Terminated", end_reason: "Terminated", close_price: null, entry_date: "2026-04-10", end_date: "2026-05-01" }),
    ]);
    expect(r.latestSale).toBeNull();
    expect(r.campaignCount).toBe(1);
    expect(r.campaigns[0].kind).toBe("terminated");
    expect(r.campaigns[0].domDays).toBeGreaterThan(0);
  });

  it("active campaigns get no DOM (still running)", () => {
    const r = assembleSaleRecord([ev({ status: "Active", end_reason: null, end_date: null, close_price: null })]);
    expect(r.campaigns[0].kind).toBe("active");
    expect(r.campaigns[0].domDays).toBeNull();
  });

  it("empty input → empty record", () => {
    const r = assembleSaleRecord([]);
    expect(r.latestSale).toBeNull();
    expect(r.campaignCount).toBe(0);
  });
});
