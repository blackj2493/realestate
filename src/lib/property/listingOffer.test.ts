import { describe, it, expect } from "vitest";
import { buildListingOffer } from "./listingOffer";

const SELLER = { "@type": "RealEstateOrganization" as const, name: "The Daniels Realty Corporation" };
const SALE_AVAIL = "https://schema.org/InStock";

describe("buildListingOffer", () => {
  it("models a SALE as a flat price with the Sell business function", () => {
    const offer = buildListingOffer({
      listPrice: 899000,
      isLease: false,
      availability: SALE_AVAIL,
      url: "https://pureproperty.ca/properties/X1",
    });
    expect(offer).toMatchObject({
      "@type": "Offer",
      businessFunction: "http://purl.org/goodrelations/v1#Sell",
      price: 899000,
      priceCurrency: "CAD",
      availability: SALE_AVAIL,
      url: "https://pureproperty.ca/properties/X1",
    });
    // A sale must NOT carry a recurring price spec.
    expect(offer.priceSpecification).toBeUndefined();
  });

  it("models a LEASE as a per-month UnitPriceSpecification with LeaseOut (never a bare sale price)", () => {
    const offer = buildListingOffer({
      listPrice: 2700,
      isLease: true,
      availability: SALE_AVAIL,
      url: "https://pureproperty.ca/properties/C12893986",
    });
    // The bug: a bare `price` here reads as a $2,700 home FOR SALE. Must be absent.
    expect(offer.price).toBeUndefined();
    expect(offer.businessFunction).toBe("http://purl.org/goodrelations/v1#LeaseOut");
    expect(offer.priceSpecification).toEqual({
      "@type": "UnitPriceSpecification",
      price: 2700,
      priceCurrency: "CAD",
      unitCode: "MON",
      unitText: "MONTH",
    });
  });

  it("includes the brokerage as seller when provided, omits it otherwise", () => {
    const withSeller = buildListingOffer({
      listPrice: 2700,
      isLease: true,
      availability: SALE_AVAIL,
      url: "u",
      seller: SELLER,
    });
    expect(withSeller.seller).toEqual(SELLER);

    const withoutSeller = buildListingOffer({
      listPrice: 2700,
      isLease: true,
      availability: SALE_AVAIL,
      url: "u",
    });
    expect("seller" in withoutSeller).toBe(false);
  });

  it("clamps non-finite or negative prices to 0 (sale and lease)", () => {
    const sale = buildListingOffer({ listPrice: Number.NaN, isLease: false, availability: SALE_AVAIL, url: "u" });
    expect(sale.price).toBe(0);

    const lease = buildListingOffer({ listPrice: -5, isLease: true, availability: SALE_AVAIL, url: "u" });
    expect((lease.priceSpecification as { price: number }).price).toBe(0);
  });
});

// ── Commercial lease basis (commercial-gap Phase 1) ──
describe("buildListingOffer — commercial lease basis", () => {
  const base = { listPrice: 22, isLease: true, availability: SALE_AVAIL, url: "https://x.ca/l/1" };

  it("year basis emits an ANN UnitPriceSpecification", () => {
    const offer = buildListingOffer({ ...base, listPrice: 77000, leaseBasis: "year" }) as {
      priceSpecification?: { unitCode: string; price: number };
    };
    expect(offer.priceSpecification?.unitCode).toBe("ANN");
    expect(offer.priceSpecification?.price).toBe(77000);
  });

  it("psf-year and unknown bases omit the price spec entirely (never assert a wrong unit)", () => {
    for (const leaseBasis of ["psf-year", "unknown"] as const) {
      const offer = buildListingOffer({ ...base, leaseBasis });
      expect(offer).not.toHaveProperty("priceSpecification");
      expect(offer).not.toHaveProperty("price");
      expect(offer.businessFunction).toBe("http://purl.org/goodrelations/v1#LeaseOut");
    }
  });

  it("default (residential) lease stays per-month", () => {
    const offer = buildListingOffer({ ...base, listPrice: 2700 }) as {
      priceSpecification?: { unitCode: string };
    };
    expect(offer.priceSpecification?.unitCode).toBe("MON");
  });
});
