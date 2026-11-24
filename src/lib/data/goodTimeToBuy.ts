/**
 * "Is it a good time to buy a house in {city}?" for /data/good-time-to-buy(/{city}).
 *
 * WHY. "is it a good time to buy a house in ontario 2026" is a top Ontario search (AI-search
 * panel 2026-11-24: CTV held all three top results; no measured answer). Whether buying is
 * right for one person depends on their money and plans; whether the MARKET favours buyers
 * is measurable, and that is all this page claims.
 *
 * SIGNALS. Each one is a measured figure with a stated direction:
 * - Market temperature: temperatureOf() — the same rule every other page uses (sale-to-list
 *   first, months of supply second). cold = buyer's market, hot = seller's.
 * - Same-home price change against a year earlier (data/price-change.json): falling = buyers.
 * - Sale-to-list: below SALE_TO_LIST_BUYER favours buyers (room to negotiate); 100+ favours sellers.
 * - Price cuts and listings older than 90 days: against the median of the covered cities, so
 *   the threshold is the market itself, not a number we picked.
 * A signal with no data is left out, never counted. Pure builder; the page loads the board.
 */
import type { MarketRow } from "@/lib/data/marketBoard";
import type { PriceChangeArea } from "@/lib/data/priceChange";

export const SALE_TO_LIST_BUYER = 98;

export const goodTimeToBuyPath = (slug?: string) => (slug ? `/data/good-time-to-buy/${slug}` : "/data/good-time-to-buy");

export type Lean = "buyers" | "sellers" | "neutral";

export interface BuySignal {
  id: "temperature" | "price" | "saleToList" | "cuts" | "stale";
  label: string;
  value: string;
  lean: Lean;
  text: string;
}

export interface BuyVerdict {
  /** "buyer's market" / "balanced market" / "seller's market". */
  market: string;
  forBuyers: number;
  forSellers: number;
  counted: number;
  signals: BuySignal[];
  summary: string;
}

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct0 = (n: number) => `${Math.round(n)}%`;

/** Percent of homes for sale listed more than 90 days, from the same age buckets as /data/days-on-market. */
export function stale90(row: MarketRow): number | null {
  const b = row.domBuckets;
  if (!b) return null;
  const total = b.d0_14 + b.d15_30 + b.d31_60 + b.d61_90 + b.d90plus;
  return total >= 50 ? (b.d90plus / total) * 100 : null;
}

export function buildBuyVerdict(city: string, row: MarketRow, allRows: MarketRow[], change: PriceChangeArea | null): BuyVerdict | null {
  const signals: BuySignal[] = [];

  if (row.temperature) {
    const t = row.temperature;
    signals.push({
      id: "temperature",
      label: "Market temperature",
      value: t === "cold" ? "Buyer's market" : t === "hot" ? "Seller's market" : "Balanced",
      lean: t === "cold" ? "buyers" : t === "hot" ? "sellers" : "neutral",
      text: `By sale-to-list and months of supply, ${city} is ${t === "cold" ? "a buyer's market" : t === "hot" ? "a seller's market" : "balanced"}${
        row.monthsOfSupply != null ? ` (${row.monthsOfSupply.toFixed(1)} months of supply)` : ""
      }.`,
    });
  }

  const c = change?.all;
  if (c) {
    const lean: Lean = !c.significant ? "neutral" : c.pct < 0 ? "buyers" : "sellers";
    signals.push({
      id: "price",
      label: "Prices, same homes",
      value: `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%`,
      lean,
      text: c.significant
        ? `Same homes sold for ${Math.abs(c.pct).toFixed(1)}% ${c.pct < 0 ? "less" : "more"} than a year earlier.`
        : "Same homes sold for about the same as a year earlier.",
    });
  }

  if (row.soldToListPct != null) {
    const s = row.soldToListPct;
    const lean: Lean = s < SALE_TO_LIST_BUYER ? "buyers" : s >= 100 ? "sellers" : "neutral";
    signals.push({
      id: "saleToList",
      label: "Sale to asking",
      value: `${s.toFixed(1)}%`,
      lean,
      text:
        lean === "buyers"
          ? `Homes sold for a median ${s.toFixed(1)}% of the asking price: buyers paid less than asked.`
          : lean === "sellers"
            ? `Homes sold for a median ${s.toFixed(1)}% of the asking price: at or over asking.`
            : `Homes sold for a median ${s.toFixed(1)}% of the asking price, close to asking.`,
    });
  }

  const cutMed = median(allRows.map((r) => r.cutShare).filter((x): x is number => x != null));
  if (row.cutShare != null && cutMed != null) {
    const share = row.cutShare * 100;
    const med = cutMed * 100;
    const lean: Lean = share >= med * 1.1 ? "buyers" : share <= med * 0.9 ? "sellers" : "neutral";
    signals.push({
      id: "cuts",
      label: "Listings with a price cut",
      value: pct0(share),
      lean,
      text: `${pct0(share)} of the homes for sale have cut their price, against ${pct0(med)} across the covered cities${
        row.medianCutPct != null ? `; the median cut is ${row.medianCutPct.toFixed(1)}%` : ""
      }.`,
    });
  }

  const staleMed = median(allRows.map(stale90).filter((x): x is number => x != null));
  const stale = stale90(row);
  if (stale != null && staleMed != null) {
    const lean: Lean = stale >= staleMed * 1.1 ? "buyers" : stale <= staleMed * 0.9 ? "sellers" : "neutral";
    signals.push({
      id: "stale",
      label: "Listed over 90 days",
      value: pct0(stale),
      lean,
      text: `${pct0(stale)} of the homes for sale have been listed for more than 90 days, against ${pct0(staleMed)} across the covered cities.`,
    });
  }

  if (signals.length < 3) return null;
  const forBuyers = signals.filter((s) => s.lean === "buyers").length;
  const forSellers = signals.filter((s) => s.lean === "sellers").length;
  const market =
    row.temperature === "cold" ? "a buyer's market" : row.temperature === "hot" ? "a seller's market" : forBuyers > forSellers + 1 ? "a balanced market that leans to buyers" : forSellers > forBuyers + 1 ? "a balanced market that leans to sellers" : "a balanced market";
  const summary = `${city} is ${market} now: ${forBuyers} of ${signals.length} measured signals favour buyers and ${forSellers} favour sellers.`;
  return { market, forBuyers, forSellers, counted: signals.length, signals, summary };
}

export function buyFaqs(city: string, v: BuyVerdict, year: number): { q: string; a: string }[] {
  return [
    {
      q: `Is it a good time to buy a house in ${city} in ${year}?`,
      a: `${v.summary} ${v.signals.map((s) => s.text).join(" ")} Whether to buy also depends on your income, savings, mortgage rate and how long you plan to stay; this page measures the market only.`,
    },
    {
      q: `Is ${city} a buyer's or seller's market?`,
      a: v.signals.find((s) => s.id === "temperature")?.text ?? v.summary,
    },
    {
      q: "How are these signals measured?",
      a: `From MLS® sales and listings, refreshed daily: the market temperature uses the sale-to-list ratio and months of supply; the price signal compares the same kind of home with a year earlier; price cuts and listings older than 90 days are compared with the median of the covered cities. A sale-to-list ratio below ${SALE_TO_LIST_BUYER}% counts as favouring buyers.`,
    },
  ];
}
