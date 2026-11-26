/**
 * Property tax: home types and the shapes of data/property-tax.json. Shared by
 * scripts/data/buildPropertyTax.ts (which writes the file) and src/lib/data/propertyTax.ts
 * (which reads it), so the script never loads the JSON it is about to write.
 */
export const TAX_HOME_TYPES = ["detached", "semi", "town", "condoTown", "condoApt"] as const;
export type TaxHomeType = (typeof TAX_HOME_TYPES)[number];

export const TAX_HOME_LABEL: Record<TaxHomeType, string> = {
  detached: "Detached house",
  semi: "Semi-detached house",
  town: "Freehold townhouse",
  condoTown: "Condo townhouse",
  condoApt: "Condo apartment",
};

/** Home type from the MLS® PropertySubType (TRREB sends "Semi-Detached " with a trailing space). */
export function taxHomeTypeOf(subType: string | null | undefined): TaxHomeType | null {
  switch ((subType ?? "").trim()) {
    case "Detached":
      return "detached";
    case "Semi-Detached":
    case "Link":
      return "semi";
    case "Att/Row/Townhouse":
      return "town";
    case "Condo Townhouse":
      return "condoTown";
    case "Condo Apartment":
      return "condoApt";
    default:
      return null;
  }
}

export interface TaxStats {
  sales: number;
  /** Median annual property tax, dollars. */
  medianTax: number | null;
  /** Middle half of the annual tax: 25th and 75th percentiles. */
  lowTax: number | null;
  highTax: number | null;
  medianPrice: number | null;
  /** Median of (annual tax / sale price) x 100,000: tax per $100,000 of price. */
  taxPer100k: number | null;
}

export interface TaxArea {
  city: string;
  slug: string;
  /** The tax year most of the sales report (the seller's latest bill). */
  taxYear: number | null;
  all: TaxStats;
  byType: Record<TaxHomeType, TaxStats | null>;
  communities: ({ name: string } & TaxStats)[];
}

export interface PropertyTaxFile {
  generatedAt: string;
  from: string;
  /** Exclusive. */
  to: string;
  cities: TaxArea[];
}
