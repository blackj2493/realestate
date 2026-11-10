/**
 * "How long does it take to sell a house in {city}?" and "What is the best month to sell?"
 * — the facts for /data/days-on-market/{city}, built from the public market board (the same
 * aggregates as the /data/days-on-market tracker). Every sentence states its own period and
 * population, because two different sets of homes are measured here:
 *   - homes that SOLD (sold-side days to sell, last 12 months), and
 *   - homes STILL FOR SALE (true days on market: relist chains stitched together; and the
 *     board clock, which restarts at zero on each relist).
 * The gap between the true clock and the board clock is the quotable original figure.
 *
 * Best month: by number of SALES per calendar month over the last 24 full months (each
 * calendar month counted twice; see seasonality.ts), never by price — the
 * precompute's price index is normalised per year, so in a falling year early months read
 * "high" (see marketOutlook.ts). Sales counts carry no such bias.
 */
import type { MarketRow } from "./marketBoard";
import { salesByCalendarMonth, seasonSentence } from "./seasonality";


const MIN_SOLD_12M = 50; // sold-side days to sell needs a real sample
const MIN_ACTIVE = 30; // active-side clocks need a real inventory
const MIN_SEASON_SALES = 30; // per calendar month, pooled over the 2-year window

export interface SellingFact {
  id: string;
  text: string;
  measure: { name: string; value: number; unitText: string };
}

export interface SellingTime {
  city: string;
  title: string;
  summary: string;
  facts: SellingFact[];
  /** Sales by calendar month (last 24 full months), only when all 12 months clear the floor. */
  months: { month: number; label: string; sales: number }[] | null;
  seasonText: string | null;
  /** Fastest-to-slowest rank of this city among the covered cities (sold-side median). */
  rankText: string | null;
  faqs: { q: string; a: string }[];
  /** The same figures as numbers, for the page's stat cards and charts (null = sample too small). */
  stats: {
    sold: { median: number; p25: number | null; p75: number | null; count: number } | null;
    active: { trueDom: number; boardDom: number | null; count: number } | null;
    buckets: { label: string; count: number }[] | null;
    stale90Pct: number | null;
    rank: { position: number; of: number; cities: { city: string; days: number }[] } | null;
    peakRatio: number | null;
  };
  updatedLabel: string;
  updatedIso: string;
}

const count = (n: number) => n.toLocaleString("en-CA");
const pct0 = (n: number) => `${Math.round(n)}%`;

function stale90Share(b: MarketRow["domBuckets"]): { share: number; total: number } | null {
  if (!b) return null;
  const total = b.d0_14 + b.d15_30 + b.d31_60 + b.d61_90 + b.d90plus;
  return total > 0 ? { share: b.d90plus / total, total } : null;
}

export function buildSellingTime(city: string, row: MarketRow | null, allRows: MarketRow[], dataAsOf: string | null): SellingTime | null {
  // No date, no page: every figure here is stated "as of" the board's refresh.
  if (!row || !dataAsOf) return null;
  const facts: SellingFact[] = [];

  // 1. Homes that sold: median and middle half, last 12 months.
  let soldText: string | null = null;
  if (row.soldMedianDom != null && (row.soldCount12m ?? 0) >= MIN_SOLD_12M) {
    const window =
      row.soldP25Dom != null && row.soldP75Dom != null
        ? ` Half of them sold in ${row.soldP25Dom} to ${row.soldP75Dom} days.`
        : "";
    soldText =
      `Homes that sold in ${city} in the last 12 months were on the market for a median of ${row.soldMedianDom} days ` +
      `(${count(row.soldCount12m ?? 0)} sales, relisted homes counted as one listing).${window}`;
    facts.push({ id: "sold_dom", text: soldText, measure: { name: "Median days on market of homes sold, last 12 months", value: row.soldMedianDom, unitText: "days" } });
  }

  // 2. Homes still for sale: the true clock against the board clock.
  let activeText: string | null = null;
  if (row.trueDom != null && (row.activeCount ?? 0) >= MIN_ACTIVE) {
    const hidden = row.medianNaiveDom != null ? Math.max(0, row.trueDom - row.medianNaiveDom) : null;
    activeText =
      `The ${count(row.activeCount ?? 0)} homes for sale in ${city} now have been on the market for a median of ${row.trueDom} days ` +
      `when relists are counted as one listing.` +
      (hidden != null && hidden > 0 && row.medianNaiveDom != null
        ? ` The listing's own counter, which restarts at zero when a home is relisted, shows a median of ${row.medianNaiveDom} days: ${hidden} days fewer.`
        : "");
    facts.push({ id: "true_dom", text: activeText, measure: { name: "Median true days on market of homes for sale now", value: row.trueDom, unitText: "days" } });
  }

  // 3. Homes for sale 90+ days.
  const s90 = stale90Share(row.domBuckets);
  let staleText: string | null = null;
  if (s90 && s90.total >= MIN_ACTIVE) {
    staleText = `${pct0(s90.share * 100)} of the homes for sale in ${city} now have been listed for more than 90 days.`;
    facts.push({ id: "stale90", text: staleText, measure: { name: "Share of homes for sale listed more than 90 days", value: Math.round(s90.share * 1000) / 10, unitText: "percent" } });
  }

  // 4. Rank among covered cities by sold-side median (lower = faster).
  let rankText: string | null = null;
  let rank: SellingTime["stats"]["rank"] = null;
  if (row.soldMedianDom != null && (row.soldCount12m ?? 0) >= MIN_SOLD_12M) {
    const ranked = allRows
      .filter((r) => r.soldMedianDom != null && (r.soldCount12m ?? 0) >= MIN_SOLD_12M)
      .sort((a, b) => (a.soldMedianDom as number) - (b.soldMedianDom as number));
    const i = ranked.findIndex((r) => r.region.toLowerCase() === row.region.toLowerCase());
    if (i >= 0 && ranked.length >= 5) {
      rank = { position: i + 1, of: ranked.length, cities: ranked.map((r) => ({ city: r.region, days: r.soldMedianDom as number })) };
      const fastest = ranked[0];
      const slowest = ranked[ranked.length - 1];
      rankText =
        i === 0
          ? `Homes sell faster in ${city} than in any of the other ${ranked.length - 1} markets PureProperty covers; the slowest is ${slowest.region} (${slowest.soldMedianDom} days).`
          : i === ranked.length - 1
            ? `Homes sell more slowly in ${city} than in any of the other ${ranked.length - 1} markets PureProperty covers; the fastest is ${fastest.region} (${fastest.soldMedianDom} days).`
            : `${city} is number ${i + 1} of ${ranked.length} covered markets from fastest to slowest; the fastest is ${fastest.region} (${fastest.soldMedianDom} days) and the slowest is ${slowest.region} (${slowest.soldMedianDom} days).`;
    }
  }

  // 5. Sales by calendar month, last 24 full months (src/lib/data/seasonality.ts).
  const season = salesByCalendarMonth(row.monthly, dataAsOf, MIN_SEASON_SALES);
  const months: SellingTime["months"] = season ? season.months : null;
  let seasonText: string | null = null;
  let peakRatio: number | null = null;
  if (season) {
    const s5 = seasonSentence(city, season);
    seasonText = s5.text;
    peakRatio = Math.round(s5.ratio * 10) / 10;
    facts.push({ id: "busiest_month", text: seasonText, measure: { name: "Sales in the busiest calendar month as a multiple of the quietest, last 2 years", value: Math.round(s5.ratio * 10) / 10, unitText: "ratio" } });
  }

  if (!facts.length) return null;

  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ");
  const faqs: { q: string; a: string }[] = [];
  if (soldText) faqs.push({ q: `How long does it take to sell a house in ${city}?`, a: join(soldText, rankText) });
  if (activeText) faqs.push({ q: `How long have homes for sale in ${city} been on the market?`, a: join(activeText, staleText) });
  if (seasonText)
    faqs.push({
      q: `What is the best month to sell a house in ${city}?`,
      a: join(seasonText, "More sales means more buyers in the market. The price of one home depends on the home and on the market at the time, not on the month alone."),
    });
  if (activeText && row.medianNaiveDom != null && row.trueDom != null && row.trueDom > row.medianNaiveDom)
    faqs.push({
      q: "Why do listings show fewer days on market than the home has been for sale?",
      a: "When a home is taken off the market and listed again, the MLS® days-on-market counter starts again at zero. PureProperty joins the listings of the same home into one when the gap between them is 35 days or less, so its count keeps the full time the home has been for sale.",
    });

  const updatedIso = new Date(dataAsOf).toISOString();
  const updatedLabel = new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
  const monthYear = new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "America/Toronto" });

  return {
    city,
    title: `How Long Does It Take to Sell a House in ${city}? (${monthYear})`,
    summary: join(soldText ?? activeText ?? facts[0].text).slice(0, 300),
    facts,
    months,
    seasonText,
    rankText,
    faqs,
    stats: {
      sold: facts.some((f) => f.id === "sold_dom")
        ? { median: row.soldMedianDom as number, p25: row.soldP25Dom, p75: row.soldP75Dom, count: row.soldCount12m ?? 0 }
        : null,
      active: facts.some((f) => f.id === "true_dom") ? { trueDom: row.trueDom as number, boardDom: row.medianNaiveDom, count: row.activeCount ?? 0 } : null,
      buckets:
        s90 && s90.total >= MIN_ACTIVE && row.domBuckets
          ? [
              { label: "0–14 days", count: row.domBuckets.d0_14 },
              { label: "15–30 days", count: row.domBuckets.d15_30 },
              { label: "31–60 days", count: row.domBuckets.d31_60 },
              { label: "61–90 days", count: row.domBuckets.d61_90 },
              { label: "Over 90 days", count: row.domBuckets.d90plus },
            ]
          : null,
      stale90Pct: s90 && s90.total >= MIN_ACTIVE ? Math.round(s90.share * 100) : null,
      rank,
      peakRatio,
    },
    updatedLabel,
    updatedIso,
  };
}
