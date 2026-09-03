import { describe, it, expect } from "vitest";
import { buildListingMetaTitle, showsListPrice, statusSuffix } from "./listingMetaTitle";

// The page's own formatter, close enough for assertions about placement.
const fmt = (n: number) => `$${n.toLocaleString("en-CA")}`;

describe("listing metadata title", () => {
  describe("a price appears only on a live listing", () => {
    it("prints the ask while active", () => {
      expect(
        buildListingMetaTitle({
          address: "12 Example St, Toronto, ON",
          listPrice: 899000,
          statusKind: "active",
          statusLabel: "",
          formatPrice: fmt,
        })
      ).toBe("12 Example St, Toronto, ON — $899,000 | PureProperty");
    });

    it("prints NO price on a sold listing", () => {
      // The regression: this used to render "$299,900 — SOLD" on a home that closed at
      // $250,000, because the title took ListPrice regardless of resolved status.
      const title = buildListingMetaTitle({
        address: "12310 Highway 41, Addington Highlands, ON K0H 2G0",
        listPrice: 299900,
        statusKind: "sold",
        statusLabel: "SOLD",
        formatPrice: fmt,
      });
      expect(title).toBe("12310 Highway 41, Addington Highlands, ON K0H 2G0 — SOLD | PureProperty");
      expect(title).not.toContain("299,900");
      expect(title).not.toContain("$");
    });

    it("prints NO price on a leased listing", () => {
      const title = buildListingMetaTitle({
        address: "5 Rent Rd, Toronto, ON",
        listPrice: 3200,
        statusKind: "sold",
        statusLabel: "LEASED",
        formatPrice: fmt,
      });
      expect(title).toBe("5 Rent Rd, Toronto, ON — LEASED | PureProperty");
    });

    it("prints NO price on an off-market listing", () => {
      expect(
        buildListingMetaTitle({
          address: "188 Maplehurst Avenue, Toronto, ON M2N 3C2",
          listPrice: 1458000,
          statusKind: "delisted",
          statusLabel: "",
          formatPrice: fmt,
        })
      ).toBe("188 Maplehurst Avenue, Toronto, ON M2N 3C2 — Off Market | PureProperty");
    });

    it("prints NO price on a feed-absent listing", () => {
      expect(
        buildListingMetaTitle({
          address: "9 Gone Ave, Toronto, ON",
          listPrice: 500000,
          statusKind: "unavailable",
          statusLabel: "",
          formatPrice: fmt,
        })
      ).toBe("9 Gone Ave, Toronto, ON — No Longer Available | PureProperty");
    });

    it("omits a zero or missing ask even while active", () => {
      expect(
        buildListingMetaTitle({
          address: "1 No Price Way, Toronto, ON",
          listPrice: 0,
          statusKind: "active",
          statusLabel: "",
          formatPrice: fmt,
        })
      ).toBe("1 No Price Way, Toronto, ON | PureProperty");
    });
  });

  describe("showsListPrice", () => {
    it("is true only for an active listing with a positive ask", () => {
      expect(showsListPrice("active", 1)).toBe(true);
      expect(showsListPrice("active", 0)).toBe(false);
      expect(showsListPrice("sold", 899000)).toBe(false);
      expect(showsListPrice("delisted", 899000)).toBe(false);
      expect(showsListPrice("unavailable", 899000)).toBe(false);
    });
  });

  describe("statusSuffix", () => {
    it("names each non-active state and stays silent while live", () => {
      expect(statusSuffix("active", "")).toBe("");
      expect(statusSuffix("sold", "SOLD")).toBe(" — SOLD");
      expect(statusSuffix("sold", "LEASED")).toBe(" — LEASED");
      expect(statusSuffix("delisted", "")).toBe(" — Off Market");
      expect(statusSuffix("unavailable", "")).toBe(" — No Longer Available");
    });
  });
});
