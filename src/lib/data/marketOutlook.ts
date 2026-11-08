/**
 * "{City} housing market {year}: what the data shows now" — the outlook page builder.
 *
 * WHY. The most common housing search in every board city is the forecast question:
 * "{city} housing market forecast 2027", "… predictions", "… crash", "is it a good time
 * to buy / sell", "will house prices drop" (Google autocomplete, measured 2026-11-08).
 * We are a brokerage, so we do NOT forecast prices. We answer with the measures every
 * forecast is built from — price and sales against a year earlier, how close homes sell
 * to asking, how far off the two-year high prices are, how many sellers cut — each as one
 * dated, sourced sentence an AI assistant can quote.
 *
 * Input is the public market board row (aggregates only). Pure and deterministic (no IO,
 * no LLM). Every figure is dropped when its sample is thin.
 */
import type { MarketRow } from "./marketBoard";


const MIN_3M_SALES = 90; // ~30 a month, the city-facts monthly floor
const MIN_12M_SALES = 50;
const MIN_ACTIVE = 30;
const MIN_SEASON_SALES = 30; // per calendar month, pooled over 5 years

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const pct0 = (n: number) => `${Math.round(n)}%`;
const count = (n: number) => Math.round(n).toLocaleString("en-CA");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthName(ym: string): string {
  return MONTHS[Number(ym.slice(5, 7)) - 1];
}
function monthLabel(ym: string): string {
  return `${monthName(ym)} ${ym.slice(0, 4)}`;
}
/** "August to October 2026", or "November 2025 to January 2026" across a year end. */
function spanLabel(first: string, last: string): string {
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${monthName(first)} to ${monthLabel(last)}`
    : `${monthLabel(first)} to ${monthLabel(last)}`;
}
function torontoMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 7);
}
function minusYear(ym: string): string {
  return `${Number(ym.slice(0, 4)) - 1}-${ym.slice(5, 7)}`;
}

/** The year the reader is asking about: from September on, people search next year. */
export function outlookYear(dataAsOf: string): number {
  const [y, m] = torontoMonth(dataAsOf).split("-").map(Number);
  return m >= 9 ? y + 1 : y;
}

type Point = MarketRow["monthly"][number];

interface Window {
  first: string;
  last: string;
  sales: number;
  /** Sales-weighted mean of the monthly medians. */
  price: number;
  /** Sales-weighted mean of the monthly sale-to-final-ask ratios (%), null when absent. */
  soldToList: number | null;
}

function windowOf(points: Point[]): Window | null {
  if (!points.length) return null;
  const sales = points.reduce((n, p) => n + p.sales, 0);
  if (sales <= 0) return null;
  const price = points.reduce((n, p) => n + p.medianPrice * p.sales, 0) / sales;
  const s2l = points.filter((p) => p.soldToList != null && p.sales > 0);
  const s2lSales = s2l.reduce((n, p) => n + p.sales, 0);
  return {
    first: points[0].month,
    last: points[points.length - 1].month,
    sales,
    price,
    soldToList: s2lSales > 0 ? s2l.reduce((n, p) => n + (p.soldToList as number) * p.sales, 0) / s2lSales : null,
  };
}

export interface OutlookFact {
  id: "price_change" | "sales_change" | "final_ask" | "from_high" | "under_first_ask" | "price_cuts";
  text: string;
  measure: { name: string; value: number; unitText: string };
}

export interface OutlookRow {
  month: string;
  label: string;
  medianPrice: number;
  sales: number;
  soldToList: number | null;
}

export interface MarketOutlook {
  city: string;
  year: number;
  title: string;
  /** One-paragraph answer for the top of the page and the meta description. */
  summary: string;
  /** The indicator sentences, in reading order. Same CityFact shape as the facts block. */
  facts: OutlookFact[];
  /** "PureProperty rates {city} a … market now", or null. */
  typeText: string | null;
  /** Pattern by month of the year, or null when thin. */
  seasonText: string | null;
  faqs: { q: string; a: string }[];
  /** Last 12 full months, newest first, for the table. */
  table: OutlookRow[];
  marketType: "seller's market" | "balanced market" | "buyer's market" | null;
  updatedLabel: string;
  updatedIso: string;
}

export function buildOutlook(city: string, row: MarketRow | null, dataAsOf: string | null): MarketOutlook | null {
  if (!row || !dataAsOf) return null;
  const asOf = torontoMonth(dataAsOf);
  const full = [...row.monthly].filter((p) => p.month < asOf && p.medianPrice > 0).sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(full.map((p) => [p.month, p]));
  const facts: OutlookFact[] = [];

  // 1-3. The last three full months against the same three months a year earlier.
  const last3 = full.slice(-3);
  const prior3 = last3.map((p) => byMonth.get(minusYear(p.month))).filter((p): p is Point => !!p);
  const now = last3.length === 3 ? windowOf(last3) : null;
  const before = prior3.length === 3 ? windowOf(prior3) : null;
  const comparable = !!(now && before && now.sales >= MIN_3M_SALES && before.sales >= MIN_3M_SALES);

  let priceText: string | null = null;
  let salesText: string | null = null;
  let s2lText: string | null = null;
  if (comparable && now && before) {
    const span = spanLabel(now.first, now.last);
    const priorYear = before.last.slice(0, 4);
    const dp = (now.price / before.price - 1) * 100;
    priceText =
      `From ${span}, the monthly median sale price of all home types in ${city} averaged ${usd(now.price)}, ` +
      (Math.abs(dp) < 0.05 ? `the same as in the same months of ${priorYear}.` : `${pct1(Math.abs(dp))} ${dp < 0 ? "lower" : "higher"} than in the same months of ${priorYear} (${usd(before.price)}).`);
    facts.push({ id: "price_change", text: priceText, measure: { name: `Median sale price change, ${span} vs a year earlier`, value: Math.round(dp * 10) / 10, unitText: "percent" } });

    const ds = (now.sales / before.sales - 1) * 100;
    salesText =
      `${count(now.sales)} homes sold in ${city} from ${span}, ` +
      (Math.abs(ds) < 0.5 ? `about the same number as in the same months of ${priorYear}.` : `${pct0(Math.abs(ds))} ${ds < 0 ? "fewer" : "more"} than in the same months of ${priorYear} (${count(before.sales)}).`);
    facts.push({ id: "sales_change", text: salesText, measure: { name: `Number of sales, ${span}`, value: now.sales, unitText: "sales" } });

    if (now.soldToList != null && before.soldToList != null) {
      s2lText = `From ${span}, homes in ${city} sold for an average of ${pct1(now.soldToList)} of their final asking price, compared with ${pct1(before.soldToList)} a year earlier.`;
      facts.push({ id: "final_ask", text: s2lText, measure: { name: `Average sale-to-final-asking-price ratio, ${span}`, value: Math.round(now.soldToList * 10) / 10, unitText: "percent" } });
    }
  }

  // 4. Distance from the two-year high of the 3-month price.
  let peakText: string | null = null;
  if (comparable && now && full.length >= 12) {
    let peak: Window | null = null;
    for (let i = 2; i < full.length; i++) {
      const w = windowOf(full.slice(i - 2, i + 1));
      if (w && w.sales >= MIN_3M_SALES && (!peak || w.price > peak.price)) peak = w;
    }
    if (peak) {
      const gap = (now.price / peak.price - 1) * 100;
      const from = monthLabel(full[0].month);
      peakText =
        peak.last === now.last || gap > -0.05
          ? `The 3-month median sale price in ${city} is at its highest level since ${from}.`
          : `The 3-month median sale price in ${city} is ${pct1(Math.abs(gap))} below its highest level since ${from}, which was ${usd(peak.price)} from ${spanLabel(peak.first, peak.last)}.`;
      facts.push({ id: "from_high", text: peakText, measure: { name: "Gap from the highest 3-month median sale price in the period", value: Math.round(gap * 10) / 10, unitText: "percent" } });
    }
  }

  // 5. Sold below the FIRST asking price, 12 months.
  let underText: string | null = null;
  if (row.underAskShare != null && (row.soldCount12m ?? 0) >= MIN_12M_SALES) {
    underText =
      `In the last 12 months, ${pct0(row.underAskShare * 100)} of homes in ${city} sold for less than their first asking price` +
      (row.askGapMedian != null ? `; the median sale was ${pct1(Math.abs(row.askGapMedian))} ${row.askGapMedian < 0 ? "below" : "above"} it.` : ".");
    facts.push({ id: "under_first_ask", text: underText, measure: { name: "Share of homes sold below the first asking price, last 12 months", value: Math.round(row.underAskShare * 1000) / 10, unitText: "percent" } });
  }

  // 6. Price cuts on homes for sale now.
  let cutText: string | null = null;
  if (row.cutShare != null && (row.cutActive ?? 0) >= MIN_ACTIVE) {
    cutText =
      `Of the ${count(row.cutActive ?? 0)} homes for sale in ${city} now, ${pct0(row.cutShare * 100)} have cut their asking price` +
      (row.medianCutPct != null ? `; the median cut is ${pct1(row.medianCutPct)}.` : ".");
    facts.push({ id: "price_cuts", text: cutText, measure: { name: "Share of homes for sale with a price cut", value: Math.round(row.cutShare * 1000) / 10, unitText: "percent" } });
  }

  // 7. Market type (sale-to-list first, supply second — temperatureOf).
  const marketType =
    row.temperature === "hot" ? "seller's market" : row.temperature === "cold" ? "buyer's market" : row.temperature === "balanced" ? "balanced market" : null;
  const typeText = marketType
    ? `PureProperty rates ${city} a ${marketType} now, from how close homes sell to their asking price and how many homes are for sale.`
    : null;

  if (!facts.length) return null;

  // Sales by month of the year (5 years). PRICE by month is deliberately NOT used: the
  // precompute normalises each sale by its own year's median, so in a falling year the
  // early months read "high" (Oshawa showed January as its best month in 2026). Sales
  // counts carry no such bias, and "when do the most buyers act" is the honest half of
  // "when is the best time to sell".
  let seasonText: string | null = null;
  const season = row.seasonality.filter((m) => m.sales >= MIN_SEASON_SALES);
  if (season.length === 12) {
    const busy = [...season].sort((a, b) => b.sales - a.sales).slice(0, 3).map((m) => MONTHS[m.month - 1]);
    const quiet = season.reduce((a, b) => (b.sales < a.sales ? b : a));
    const ratio = season.reduce((a, b) => (b.sales > a.sales ? b : a)).sales / quiet.sales;
    seasonText =
      `Over the last 5 years, the most homes in ${city} sold in ${busy[0]}, ${busy[1]} and ${busy[2]}, ` +
      `and the fewest in ${MONTHS[quiet.month - 1]}: the busiest month had ${ratio.toFixed(1)} times as many sales as the quietest.`;
  }

  const year = outlookYear(dataAsOf);
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ");
  const faqs: { q: string; a: string }[] = [];
  faqs.push({
    q: `Will house prices drop in ${city} in ${year}?`,
    a: join("No one can know future prices, and PureProperty does not forecast them. The measures that forecasts watch show this:", priceText, s2lText, underText),
  });
  faqs.push({
    q: `Is it a good time to buy a house in ${city}?`,
    a: join("That depends on the home and on your plans. The data shows how much room buyers have now:", underText, cutText, typeText),
  });
  faqs.push({
    q: `Is it a good time to sell a house in ${city}?`,
    a: join(typeText, salesText, seasonText, "A REALTOR® can give you a price opinion for your own home."),
  });
  if (peakText) faqs.push({ q: `Is the ${city} housing market crashing?`, a: join(peakText, priceText) });
  if (seasonText) faqs.push({ q: `What is the best month to sell a house in ${city}?`, a: join(seasonText, "More sales means more buyers in the market. The price of one home depends on the home and on the market at the time, not on the month alone.") });

  const updatedLabel = new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
  const lead = [priceText, underText].filter(Boolean)[0] ?? facts[0].text;
  const summary = join(lead, typeText).slice(0, 300);

  const table: OutlookRow[] = full
    .slice(-12)
    .reverse()
    .map((p) => ({ month: p.month, label: monthLabel(p.month), medianPrice: p.medianPrice, sales: p.sales, soldToList: p.soldToList ?? null }));

  return {
    city,
    year,
    title: `${city} Housing Market ${year}: What the Data Shows Now`,
    summary,
    facts,
    typeText,
    seasonText,
    faqs: faqs.filter((f) => f.a.trim().length > 0),
    table,
    marketType,
    updatedLabel,
    updatedIso: new Date(dataAsOf).toISOString(),
  };
}
