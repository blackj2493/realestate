/**
 * "Is it cheaper to rent or buy in {city}?" for /data/rent-vs-buy/{city}: typical rent
 * against the median sale price, by bedroom count, from the same rental rows as the
 * /data/rent-vs-buy tracker (region_rental_yield: rental_market_index rent paired with the
 * 12-month median sold price; the extra study cities copy it in buildCityMarkets.ts).
 *
 * PRICE-TO-RENT. Price / a year of rent. The tracker's published rule of thumb: under 15
 * tends to favour buying, over 20 tends to favour renting. Gross figures only: no mortgage
 * interest, tax, condo fees, insurance or upkeep, so the page compares markets and says it
 * is not a personal verdict.
 *
 * A bedroom row is stated only when the RPC gives it a yield (price, and 5+ sales). The
 * city rank uses the 2-bedroom ratio, the row most cities have. Pure builder.
 */
import type { MarketRow } from "@/lib/data/marketBoard";

export const PTR_BUY = 15;
export const PTR_RENT = 20;
const BEDS = [1, 2, 3, 4];
const RANK_BEDS = 2;

export const rentVsBuyPath = (slug?: string) => (slug ? `/data/rent-vs-buy/${slug}` : "/data/rent-vs-buy");

export type RentBuyLean = "buy" | "rent" | "neutral";

export interface RentBuyBed {
  beds: number;
  rent: number;
  price: number;
  yieldPct: number;
  /** Price / annual rent, one decimal. */
  ptr: number;
  lean: RentBuyLean;
  text: string;
}

export interface RentVsBuy {
  city: string;
  title: string;
  summary: string;
  beds: RentBuyBed[];
  /** The 2-bedroom row (else the first stated row): the page's headline figure. */
  lead: RentBuyBed;
  rank: { position: number; of: number; cities: { city: string; ptr: number }[] } | null;
  rankText: string | null;
  faqs: { q: string; a: string }[];
  updatedLabel: string;
  updatedIso: string;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const bedLabel = (b: number) => `${b}-bedroom`;

export const leanOf = (ptr: number): RentBuyLean => (ptr < PTR_BUY ? "buy" : ptr > PTR_RENT ? "rent" : "neutral");

/** The stated bedroom rows of one market (rent, price and yield all present). */
export function rentBuyBeds(city: string, row: MarketRow): RentBuyBed[] {
  const out: RentBuyBed[] = [];
  for (const b of BEDS) {
    const r = row.rentalRows.find((x) => x.beds === b);
    if (!r || r.typicalRent == null || r.medianPrice == null || r.grossYieldPct == null || r.typicalRent <= 0) continue;
    const ptr = Math.round((r.medianPrice / (r.typicalRent * 12)) * 10) / 10;
    const lean = leanOf(ptr);
    const verdict =
      lean === "buy" ? "Under 15 tends to favour buying." : lean === "rent" ? "Over 20 tends to favour renting." : "Between 15 and 20, neither clearly wins.";
    out.push({
      beds: b,
      rent: r.typicalRent,
      price: r.medianPrice,
      yieldPct: r.grossYieldPct,
      ptr,
      lean,
      text:
        `A typical ${bedLabel(b)} home in ${city} rents for ${money(r.typicalRent)} a month, and ${bedLabel(b)} homes sold for a median ${money(r.medianPrice)} in the last 12 months. ` +
        `The price is ${ptr.toFixed(1)} times a year of rent (gross rental yield ${r.grossYieldPct.toFixed(1)}%). ${verdict}`,
    });
  }
  return out;
}

export function buildRentVsBuy(city: string, row: MarketRow | null, allRows: MarketRow[], dataAsOf: string | null, year: number): RentVsBuy | null {
  if (!row || !dataAsOf) return null;
  const beds = rentBuyBeds(city, row);
  if (!beds.length) return null;
  const lead = beds.find((b) => b.beds === RANK_BEDS) ?? beds[0];

  let rank: RentVsBuy["rank"] = null;
  let rankText: string | null = null;
  const me = beds.find((b) => b.beds === RANK_BEDS);
  if (me) {
    const ranked = allRows
      .map((r) => ({ city: r.region, ptr: rentBuyBeds(r.region, r).find((b) => b.beds === RANK_BEDS)?.ptr ?? null }))
      .filter((r): r is { city: string; ptr: number } => r.ptr != null)
      .sort((a, b) => a.ptr - b.ptr);
    const i = ranked.findIndex((r) => r.city.toLowerCase() === city.toLowerCase());
    if (i >= 0 && ranked.length >= 5) {
      rank = { position: i + 1, of: ranked.length, cities: ranked };
      const low = ranked[0];
      const high = ranked[ranked.length - 1];
      rankText =
        i === 0
          ? `For 2-bedroom homes, ${city} has the lowest price-to-rent ratio of the ${ranked.length} cities PureProperty covers: the most favourable to buying. The highest is ${high.city} (${high.ptr.toFixed(1)}).`
          : i === ranked.length - 1
            ? `For 2-bedroom homes, ${city} has the highest price-to-rent ratio of the ${ranked.length} cities PureProperty covers: the most favourable to renting. The lowest is ${low.city} (${low.ptr.toFixed(1)}).`
            : `For 2-bedroom homes, ${city} is number ${i + 1} of ${ranked.length} covered cities from the lowest price-to-rent ratio to the highest. The lowest is ${low.city} (${low.ptr.toFixed(1)}) and the highest is ${high.city} (${high.ptr.toFixed(1)}).`;
    }
  }

  const leanWord = (l: RentBuyLean) => (l === "buy" ? "favours buying" : l === "rent" ? "favours renting" : "favours neither clearly");
  const summary =
    `In ${city}, a ${bedLabel(lead.beds)} home costs ${lead.ptr.toFixed(1)} times a year of rent: ${money(lead.price)} to buy against ${money(lead.rent)} a month to rent. ` +
    `By the price-to-rent rule of thumb, that ${leanWord(lead.lean)}.`;

  const table = beds.map((b) => `${bedLabel(b.beds)}: ${money(b.rent)} a month, ${money(b.price)} to buy, ratio ${b.ptr.toFixed(1)}`).join("; ");
  const faqs = [
    {
      q: `Is it cheaper to rent or buy in ${city}?`,
      a: `${summary} By bedroom count: ${table}. These are gross figures: they leave out mortgage interest, property tax, condo fees, insurance and upkeep. Whether buying is right for you also depends on your down payment, mortgage rate and how long you plan to stay.`,
    },
    {
      q: `How much is rent in ${city}?`,
      a: beds.map((b) => `A typical ${bedLabel(b.beds)} home rents for ${money(b.rent)} a month.`).join(" "),
    },
    {
      q: "What is the price-to-rent ratio?",
      a: `The purchase price divided by a year of rent. As a rule of thumb, a ratio under ${PTR_BUY} tends to favour buying and a ratio over ${PTR_RENT} tends to favour renting, because the price is high compared with what the home rents for.`,
    },
    ...(rankText ? [{ q: `How does ${city} compare with other Ontario cities?`, a: rankText }] : []),
  ];

  const updatedIso = new Date(dataAsOf).toISOString();
  const updatedLabel = new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
  return {
    city,
    title: `Is It Cheaper to Rent or Buy in ${city}? ${year} Rent vs Buy by Bedroom Count`,
    summary,
    beds,
    lead,
    rank,
    rankText,
    faqs,
    updatedLabel,
    updatedIso,
  };
}
