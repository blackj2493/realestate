/**
 * City market facts — plain, dated, sourced sentences built from the public market board.
 *
 * WHY. AI assistants (ChatGPT search, Perplexity, Gemini, Google AI answers) quote pages
 * that state a fact in one self-contained sentence, with a number, a period, a place and a
 * source. Our city hubs held listings only; the facts that make us worth citing (% sold
 * below the FIRST asking price, true days on market, price cuts) lived on /data trackers as
 * tables. This turns one market's board row into those sentences, the FAQ answers and the
 * schema.org Dataset, from ONE builder so the visible text and the structured data agree.
 *
 * Aggregate statistics only (the same category as the /data trackers — no listing rows).
 * Pure and deterministic (no IO, no LLM, §4). Each fact is dropped when its sample is thin.
 */
import type { MarketRow } from "./marketBoard";

export interface CityFact {
  id: "price" | "under_first_ask" | "final_ask" | "days_to_sell" | "price_cuts" | "true_dom";
  /** One self-contained sentence: place, number, period. Quotable on its own. */
  text: string;
  /** schema.org PropertyValue for the Dataset JSON-LD. */
  measure: { name: string; value: number; unitText: string };
}

export interface CityFacts {
  city: string;
  facts: CityFact[];
  faqs: { q: string; a: string }[];
  /** "November 5, 2026" — the board's data-as-of date (Toronto). */
  updatedLabel: string;
  updatedIso: string;
  /** One-line summary for the meta description (≤ ~160 chars). */
  summary: string | null;
}

export const SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sales and listings from the MLS® VOW feed (comprehensive but not exhaustive). Totals and medians only, refreshed nightly.";

const MIN_MONTH_SALES = 30;
const MIN_12M_SALES = 50;
const MIN_90D_SALES = 20;
const MIN_ACTIVE = 30;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const pct0 = (n: number) => `${Math.round(n)}%`;

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Toronto calendar month "YYYY-MM" of an ISO instant. */
function torontoMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 7);
}

function prevYear(ym: string): string {
  const [y, m] = ym.split("-");
  return `${Number(y) - 1}-${m}`;
}

export function buildCityFacts(city: string, row: MarketRow | null, dataAsOf: string | null): CityFacts | null {
  if (!row || !dataAsOf) return null;
  const facts: CityFact[] = [];
  const faqs: { q: string; a: string }[] = [];

  // 1. Median sale price, last FULL month (the current month is partial), and the same month a year earlier.
  const asOfMonth = torontoMonth(dataAsOf);
  const full = row.monthly.filter((p) => p.month < asOfMonth);
  const last = full.at(-1);
  let priceText: string | null = null;
  if (last && last.sales >= MIN_MONTH_SALES) {
    const ly = full.find((p) => p.month === prevYear(last.month));
    const change = ly && ly.sales >= MIN_MONTH_SALES ? (last.medianPrice / ly.medianPrice - 1) * 100 : null;
    priceText =
      `The median sale price of all home types in ${city} was ${usd(last.medianPrice)} in ${monthLabel(last.month)} (${last.sales.toLocaleString("en-CA")} sales)` +
      (change != null
        ? Math.abs(change) < 0.05
          ? `, the same as in ${monthLabel(ly!.month)}.`
          : `, ${pct1(Math.abs(change))} ${change < 0 ? "lower than" : "higher than"} in ${monthLabel(ly!.month)} (${usd(ly!.medianPrice)}).`
        : ".");
    facts.push({ id: "price", text: priceText, measure: { name: `Median sale price, all home types, ${monthLabel(last.month)}`, value: last.medianPrice, unitText: "CAD" } });
  }

  // 2. Sold below the FIRST asking price, trailing 12 months — the figure portals do not publish.
  let underText: string | null = null;
  if (row.underAskShare != null && (row.soldCount12m ?? 0) >= MIN_12M_SALES) {
    const share = row.underAskShare * 100;
    underText =
      `In the last 12 months, ${pct0(share)} of homes in ${city} sold for less than their first asking price (${(row.soldCount12m ?? 0).toLocaleString("en-CA")} sales)` +
      (row.askGapMedian != null
        ? `; the median sale was ${pct1(Math.abs(row.askGapMedian))} ${row.askGapMedian < 0 ? "below" : "above"} the first asking price.`
        : ".");
    facts.push({ id: "under_first_ask", text: underText, measure: { name: "Share of homes sold below the first asking price, last 12 months", value: Math.round(share * 10) / 10, unitText: "percent" } });
  }

  // 3. Sold vs the FINAL asking price, trailing 90 days.
  let finalText: string | null = null;
  if (row.soldToListPct != null && (row.sales90 ?? 0) >= MIN_90D_SALES) {
    finalText =
      `In the last 90 days, homes in ${city} sold for an average of ${pct1(row.soldToListPct)} of their final asking price` +
      (row.pctOverAsking != null ? `, and ${pct1(row.pctOverAsking)} sold above it.` : ".");
    facts.push({ id: "final_ask", text: finalText, measure: { name: "Average sale-to-final-asking-price ratio, last 90 days", value: row.soldToListPct, unitText: "percent" } });
  }

  // 4. Days to sell, sold side, trailing 12 months.
  let sellText: string | null = null;
  if (row.soldMedianDom != null && (row.soldCount12m ?? 0) >= MIN_12M_SALES) {
    sellText =
      `Homes in ${city} that sold in the last 12 months were on the market for a median of ${Math.round(row.soldMedianDom)} days` +
      (row.soldP25Dom != null && row.soldP75Dom != null
        ? `; half sold in ${Math.round(row.soldP25Dom)} to ${Math.round(row.soldP75Dom)} days.`
        : ".");
    facts.push({ id: "days_to_sell", text: sellText, measure: { name: "Median days on market of sold homes, last 12 months", value: Math.round(row.soldMedianDom), unitText: "days" } });
  }

  // 5. Price cuts on homes for sale now.
  let cutText: string | null = null;
  if (row.cutShare != null && (row.cutActive ?? 0) >= MIN_ACTIVE) {
    cutText =
      `Of the ${(row.cutActive ?? 0).toLocaleString("en-CA")} homes for sale in ${city} now, ${pct0(row.cutShare * 100)} have cut their asking price` +
      (row.medianCutPct != null ? `; the median cut is ${pct1(row.medianCutPct)}.` : ".");
    facts.push({ id: "price_cuts", text: cutText, measure: { name: "Share of homes for sale with a price cut", value: Math.round(row.cutShare * 1000) / 10, unitText: "percent" } });
  }

  // 6. True days on market of homes for sale now (relists joined).
  let trueText: string | null = null;
  if (row.trueDom != null && (row.activeCount ?? 0) >= MIN_ACTIVE) {
    trueText =
      `Homes for sale in ${city} now have been on the market for a median of ${Math.round(row.trueDom)} days when relists are counted as one listing` +
      (row.medianNaiveDom != null ? ` (the listings show a median of ${Math.round(row.medianNaiveDom)} days).` : ".");
    facts.push({ id: "true_dom", text: trueText, measure: { name: "Median true days on market of homes for sale (relists joined)", value: Math.round(row.trueDom), unitText: "days" } });
  }

  if (!facts.length) return null;

  if (underText || finalText)
    faqs.push({ q: `Do homes in ${city} sell below asking price?`, a: [underText, finalText].filter(Boolean).join(" ") });
  if (sellText || trueText)
    faqs.push({ q: `How long does it take to sell a home in ${city}?`, a: [sellText, trueText].filter(Boolean).join(" ") });
  if (priceText) faqs.push({ q: `What is the median home price in ${city}?`, a: priceText });
  if (cutText) faqs.push({ q: `Are sellers in ${city} cutting prices?`, a: cutText });

  const updatedLabel = new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
  const parts = [
    last && last.sales >= MIN_MONTH_SALES ? `Median sale price ${usd(last.medianPrice)} (${monthLabel(last.month)})` : null,
    row.underAskShare != null && (row.soldCount12m ?? 0) >= MIN_12M_SALES ? `${pct0(row.underAskShare * 100)} sold below first asking (12 mo)` : null,
    row.soldMedianDom != null && (row.soldCount12m ?? 0) >= MIN_12M_SALES ? `median ${Math.round(row.soldMedianDom)} days to sell` : null,
  ].filter(Boolean);

  return {
    city,
    facts,
    faqs,
    updatedLabel,
    updatedIso: new Date(dataAsOf).toISOString(),
    summary: parts.length ? `${city} market: ${parts.join("; ")}. Updated ${updatedLabel}.` : null,
  };
}

/** The board row for a city hub's display name ("Richmond Hill"), case-insensitive. */
export function boardRowFor(rows: MarketRow[], city: string): MarketRow | null {
  const k = city.trim().toLowerCase();
  return rows.find((r) => r.region.toLowerCase() === k) ?? null;
}
