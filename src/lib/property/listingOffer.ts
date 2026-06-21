/**
 * schema.org Offer node for a listing's JSON-LD (SEO structured data).
 *
 * Why this is its own tested helper: a For-Lease listing carries the MONTHLY RENT in
 * ListPrice. Emitting it as a bare `Offer.price` (the sale shape) tells Google the
 * property is FOR SALE at $2,700 — a serious misread that can surface a rental as a
 * suspiciously cheap home for sale. A lease must instead be modelled as a recurring
 * price: a UnitPriceSpecification at unitCode "MON" (per month) with the GoodRelations
 * `LeaseOut` business function. Sales keep the simple `price` shape with `Sell`.
 *
 * GoodRelations BusinessFunction individuals use the canonical http namespace
 * (`http://purl.org/goodrelations/v1#…`) — that is the IRI Google's examples use; an
 * https variant is a different, non-canonical identifier.
 */

/** A listing brokerage org node, reused as the offer's seller (§6.3(c)). */
export interface OfferSeller {
  "@type": "RealEstateOrganization";
  name: string;
}

export interface ListingOfferInput {
  /** ListPrice — a sale price for sales, the monthly rent for leases. */
  listPrice: number;
  /** True when TransactionType is a lease (price is per-month rent, not a sale price). */
  isLease: boolean;
  /** schema.org availability enum URL (InStock / SoldOut / OutOfStock). */
  availability: string;
  /** Canonical listing URL. */
  url: string;
  seller?: OfferSeller;
}

const GR = "http://purl.org/goodrelations/v1#";

/**
 * Build the Offer node. Lease → recurring UnitPriceSpecification (per month) + LeaseOut;
 * Sale → flat price + Sell. Deterministic and pure (no I/O), so it's unit-tested.
 */
export function buildListingOffer(input: ListingOfferInput): Record<string, unknown> {
  const price = Number.isFinite(input.listPrice) ? Math.max(0, input.listPrice) : 0;
  const base: Record<string, unknown> = {
    "@type": "Offer",
    availability: input.availability,
    url: input.url,
    ...(input.seller ? { seller: input.seller } : {}),
  };

  if (input.isLease) {
    return {
      ...base,
      businessFunction: `${GR}LeaseOut`,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "CAD",
        unitCode: "MON", // UN/CEFACT Common Code for "month"
        unitText: "MONTH",
      },
    };
  }

  return {
    ...base,
    businessFunction: `${GR}Sell`,
    price,
    priceCurrency: "CAD",
  };
}
