import { beforeEach, describe, expect, it, vi } from "vitest";

const searchListings = vi.fn();
vi.mock("@/lib/typesense/client", () => ({ searchListings: (...a: unknown[]) => searchListings(...a) }));

import { fetchBoard, PRICE_DROP_OVERFETCH } from "./queries";
import { BOARDS } from "./boards";
import { DEFAULT_ACTIVITY_LENS } from "./config";

const area = { kind: "region" as const, name: "Toronto" };

describe("fetchBoard price-drop sanity", () => {
  beforeEach(() => searchListings.mockReset());

  it("over-fetches, drops typo cuts, and keeps the top N in order", async () => {
    searchListings.mockResolvedValue({
      listings: [
        { id: "typo", ListPrice: 649_990, TotalPriceDrop: 68_349_010 },
        { id: "a", ListPrice: 1_180_000, TotalPriceDrop: 120_000 },
        { id: "b", ListPrice: 899_000, TotalPriceDrop: 50_000 },
        { id: "c", ListPrice: 700_000, TotalPriceDrop: 40_000 },
      ],
    });
    const rows = await fetchBoard(BOARDS.price_drop, area, DEFAULT_ACTIVITY_LENS, 2);
    expect(searchListings.mock.calls[0][0].perPage).toBe(PRICE_DROP_OVERFETCH);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["a", "b"]);
  });

  it("uses the rent-cut field in lease mode", async () => {
    searchListings.mockResolvedValue({
      listings: [
        { id: "typo", ListPrice: 2_500, LeaseTotalPriceDrop: 250_000 },
        { id: "ok", ListPrice: 2_500, LeaseTotalPriceDrop: 200 },
      ],
    });
    const rows = await fetchBoard(BOARDS.price_drop, area, { ...DEFAULT_ACTIVITY_LENS, transactionType: "lease" }, 5);
    expect(rows.map((r: { id: string }) => r.id)).toEqual(["ok"]);
  });

  it("leaves other boards untouched", async () => {
    const listings = [{ id: "x", ListPrice: 1 }];
    searchListings.mockResolvedValue({ listings });
    const rows = await fetchBoard(BOARDS.cap_rate, area, DEFAULT_ACTIVITY_LENS, 5);
    expect(searchListings.mock.calls[0][0].perPage).toBe(5);
    expect(rows).toBe(listings);
  });
});
