import { describe, it, expect } from "vitest";
import { SALE_TRANSACTION_TYPE, MIN_CLOSE_PRICE } from "./types";

/**
 * raw_vow_sold mixes sold rows with LEASED ones (close_price = a monthly rent).
 * They used to be separated by a `close_price >= 50_000` floor — a magnitude test
 * standing in for a category. That excluded 482 genuine sales (vacant land, mobile
 * homes, rural residential) and would have admitted the first lease to close above
 * the line. The feed states the category outright; migration 104 promoted it to a
 * column.
 */
describe("sale vs lease separation", () => {
  it("uses the feed's own transaction type, matching what the ETL writes", () => {
    expect(SALE_TRANSACTION_TYPE).toBe("For Sale");
  });

  it("keeps only a placeholder guard on price, not a category test", () => {
    // A $3,250 monthly rent must NOT be excluded by price — transaction_type is
    // what excludes it. If this floor ever climbs back toward a rent-sized number,
    // the proxy has crept back in.
    expect(MIN_CLOSE_PRICE).toBeLessThan(3250);
    // …but a $0 placeholder closing is still kept out of the medians.
    expect(MIN_CLOSE_PRICE).toBeGreaterThan(0);
  });
});
