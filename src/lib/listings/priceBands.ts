/**
 * Price-band hubs — /property/{prov}/{city}/under/{band}, e.g. "homes for sale in Mississauga
 * under 1 million" (AI-search panel 2026-11-24: Wahi, viewhomes and Zoocasa held the results).
 *
 * One module so the page, the city hub's links and the sitemap use the same bands and the same
 * filter: a sitemap URL must never count a different population than the page it points at.
 *
 * Homes only: parking spots, lockers, timeshares and vacant land are left out, and so is a
 * placeholder asking price ($1, $100 — "price on request"), which would otherwise sit at the
 * bottom of every band.
 */
import { NON_HOME_SUBTYPES } from "@/lib/dashboard/propertyTypes";
import { MIN_LIST_PRICE } from "@/lib/data/powerOfSaleListings";

export const PRICE_BANDS = [
  { slug: "500k", max: 500_000, label: "$500K", words: "$500,000" },
  { slug: "700k", max: 700_000, label: "$700K", words: "$700,000" },
  { slug: "1-million", max: 1_000_000, label: "$1 Million", words: "$1,000,000" },
  { slug: "1-5-million", max: 1_500_000, label: "$1.5 Million", words: "$1,500,000" },
] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export function priceBandBySlug(slug: string): PriceBand | null {
  return PRICE_BANDS.find((b) => b.slug === slug.toLowerCase()) ?? null;
}

export const priceBandPath = (citySlug: string, band: PriceBand, prov = "on") => `/property/${prov}/${citySlug}/under/${band.slug}`;

const EXCLUDED = [...NON_HOME_SUBTYPES, "Vacant Land"].map((s) => `\`${s}\``).join(",");

/** The Typesense filter for a band, appended to the city's active For-Sale filter. */
export function priceBandFilter(band: PriceBand): string {
  return `ListPrice:>=${MIN_LIST_PRICE} && ListPrice:<=${band.max} && PropertySubType:!=[${EXCLUDED}]`;
}

/** PropertySubType facet → the four groups the page reports (others fold into "other"). */
export function groupSubTypes(facet: Record<string, number>): { detached: number; semiTown: number; condoApt: number; condoTown: number; other: number } {
  const out = { detached: 0, semiTown: 0, condoApt: 0, condoTown: 0, other: 0 };
  for (const [k, n] of Object.entries(facet)) {
    const t = k.trim();
    if (t === "Detached") out.detached += n;
    else if (t === "Semi-Detached" || t === "Att/Row/Townhouse" || t === "Link") out.semiTown += n;
    else if (t === "Condo Apartment") out.condoApt += n;
    else if (t === "Condo Townhouse") out.condoTown += n;
    else out.other += n;
  }
  return out;
}
