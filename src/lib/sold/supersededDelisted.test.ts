import { describe, it, expect } from "vitest";
import {
  addressKey,
  indexClosesByAddress,
  isSupersedingDealType,
  selectSupersededDelisted,
  type CompEvent,
} from "./supersededDelisted";

const DAY = 86_400_000;
const at = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();

/** The real incident that motivated this module (210 Charlton Ave E, Hamilton). */
const CHARLTON = "210 Charlton Avenue E, Hamilton, ON L8N 1Z1";
const terminated: CompEvent = {
  id: "X12833514",
  DealType: "terminated",
  UnparsedAddress: CHARLTON,
  PurchaseContractDate: at("2026-06-01"),
};
const sold: CompEvent = {
  id: "X13220658",
  DealType: "sold",
  UnparsedAddress: CHARLTON,
  PurchaseContractDate: at("2026-07-02"),
};

describe("addressKey", () => {
  it("lowercases and collapses whitespace so feed casing can't split a property", () => {
    expect(addressKey("23 OTTAWA Street S, Hamilton, ON L8K 2C9")).toBe(
      addressKey("23 Ottawa Street S, Hamilton, ON L8K 2C9")
    );
    expect(addressKey("  680   McEastern Path ")).toBe("680 mceastern path");
  });

  it("keeps distinct units distinct", () => {
    expect(addressKey("455 Charlton Avenue E 602, Hamilton, ON L8N 0B2")).not.toBe(
      addressKey("455 Charlton Avenue E 301, Hamilton, ON L8N 0B2")
    );
  });

  it("returns empty for missing addresses", () => {
    expect(addressKey(null)).toBe("");
    expect(addressKey(undefined)).toBe("");
    expect(addressKey("   ")).toBe("");
  });
});

describe("isSupersedingDealType", () => {
  it("accepts sales only — a lease must never retire a de-listed pin", () => {
    expect(isSupersedingDealType("sold")).toBe(true);
    for (const v of ["leased", "terminated", "expired", "suspended", "", null, undefined, 3]) {
      expect(isSupersedingDealType(v)).toBe(false);
    }
  });
});

describe("indexClosesByAddress", () => {
  it("keeps the NEWEST close per address", () => {
    const older: CompEvent = { ...sold, id: "OLD", PurchaseContractDate: at("2026-05-01") };
    const map = indexClosesByAddress([older, sold]);
    expect(map.get(addressKey(CHARLTON))?.id).toBe("X13220658");
  });

  it("ignores de-listed rows, addressless rows and undated rows", () => {
    const map = indexClosesByAddress([
      terminated,
      { id: "A", DealType: "sold", PurchaseContractDate: at("2026-07-02") },
      { id: "B", DealType: "sold", UnparsedAddress: CHARLTON },
    ]);
    expect(map.size).toBe(0);
  });
});

describe("selectSupersededDelisted", () => {
  it("flags the de-listed original once its relist closes", () => {
    const matches = selectSupersededDelisted([terminated], [sold]);
    expect(matches).toEqual([
      {
        delistedId: "X12833514",
        closeId: "X13220658",
        delistedAt: at("2026-06-01"),
        closedAt: at("2026-07-02"),
        address: CHARLTON,
      },
    ]);
  });

  it("matches across feed casing differences", () => {
    const shouty = { ...terminated, UnparsedAddress: CHARLTON.toUpperCase() };
    expect(selectSupersededDelisted([shouty], [sold])).toHaveLength(1);
  });

  it("flags EVERY superseded campaign at the address, not just the newest", () => {
    const earlier = { ...terminated, id: "X12495662", PurchaseContractDate: at("2026-01-31") };
    const ids = selectSupersededDelisted([earlier, terminated], [sold]).map((m) => m.delistedId);
    expect(ids).toEqual(["X12495662", "X12833514"]);
  });

  it("treats a same-day close as superseding (mirrors the detail page's >= rule)", () => {
    const sameDay = { ...sold, PurchaseContractDate: at("2026-06-01") };
    expect(selectSupersededDelisted([terminated], [sameDay])).toHaveLength(1);
  });

  it("leaves a de-list that POSTDATES the close alone — that campaign is genuinely off-market", () => {
    const laterDelist = { ...terminated, PurchaseContractDate: at("2026-07-03") };
    expect(selectSupersededDelisted([laterDelist], [sold])).toEqual([]);
  });

  it("never matches a different unit in the same building", () => {
    const unit602 = {
      ...terminated,
      UnparsedAddress: "455 Charlton Avenue E 602, Hamilton, ON L8N 0B2",
    };
    const unit301Sold = {
      ...sold,
      UnparsedAddress: "455 Charlton Avenue E 301, Hamilton, ON L8N 0B2",
    };
    expect(selectSupersededDelisted([unit602], [unit301Sold])).toEqual([]);
  });

  it("ignores a de-listed row that has no address to join on", () => {
    const addressless = { ...terminated, UnparsedAddress: "" };
    expect(selectSupersededDelisted([addressless], [sold])).toEqual([]);
  });

  it("never matches a row against itself", () => {
    const selfClose = { ...terminated, DealType: "sold" };
    expect(selectSupersededDelisted([terminated], [selfClose])).toEqual([]);
  });

  it("a LEASE never supersedes — the owner still owns it and still wanted to sell", () => {
    const leased = { ...sold, id: "X99", DealType: "leased" };
    expect(selectSupersededDelisted([terminated], [leased])).toEqual([]);
  });

  it("a sale still supersedes even when a later lease exists at the address", () => {
    const laterLease = { ...sold, id: "X99", DealType: "leased", PurchaseContractDate: at("2026-07-20") };
    const matches = selectSupersededDelisted([terminated], [sold, laterLease]);
    expect(matches.map((m) => m.closeId)).toEqual(["X13220658"]);
  });

  it("ignores non-de-listed input rows", () => {
    expect(selectSupersededDelisted([sold], [sold])).toEqual([]);
  });

  it("returns nothing when no close exists at the address", () => {
    const elsewhere = { ...sold, UnparsedAddress: "1 Other Street, Hamilton, ON L8N 1Z1" };
    expect(selectSupersededDelisted([terminated], [elsewhere])).toEqual([]);
  });

  it("scales to a batch with mixed outcomes", () => {
    const other = "84 Hadrian Drive, Toronto, ON M9W 1V4";
    const delisted: CompEvent[] = [
      terminated,
      { id: "W13575278", DealType: "terminated", UnparsedAddress: other, PurchaseContractDate: at("2026-07-29") },
      { id: "W13443852", DealType: "expired", UnparsedAddress: other, PurchaseContractDate: at("2026-07-14") },
      { id: "KEEP", DealType: "suspended", UnparsedAddress: "9 Nowhere Rd", PurchaseContractDate: at("2026-07-20") },
    ];
    const closes: CompEvent[] = [
      sold,
      { id: "W13617774", DealType: "sold", UnparsedAddress: other, PurchaseContractDate: at("2026-07-31") },
    ];
    expect(selectSupersededDelisted(delisted, closes).map((m) => m.delistedId)).toEqual([
      "X12833514",
      "W13575278",
      "W13443852",
    ]);
  });

  it("is a no-op on empty input", () => {
    expect(selectSupersededDelisted([], [])).toEqual([]);
    expect(selectSupersededDelisted([terminated], [])).toEqual([]);
  });

  it("tolerates NaN / missing event dates on both sides", () => {
    expect(selectSupersededDelisted([{ ...terminated, PurchaseContractDate: NaN }], [sold])).toEqual([]);
    expect(selectSupersededDelisted([terminated], [{ ...sold, PurchaseContractDate: undefined }])).toEqual([]);
  });

  it("uses the newest close when several exist at one address", () => {
    const stale = { ...sold, id: "STALE", PurchaseContractDate: at("2026-05-01") };
    const match = selectSupersededDelisted([terminated], [stale, sold])[0];
    expect(match.closeId).toBe("X13220658");
  });

  it("keeps a de-list one day after the close", () => {
    const nextDay = { ...terminated, PurchaseContractDate: sold.PurchaseContractDate! + DAY };
    expect(selectSupersededDelisted([nextDay], [sold])).toEqual([]);
  });
});
