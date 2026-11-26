/**
 * Published forecasts for the Ontario resale market, by the banks and CREA. PureProperty does
 * not forecast prices; the /data/housing-market pages quote these, with the source and date,
 * next to our own measured figures.
 *
 * WHY. "{city} housing market forecast {year}" is the most-searched housing question in
 * Ontario. On 2026-11-25 the top results were news stories on these same bank reports. No bank
 * publishes a forecast for a single city, so the pages say so and show the Ontario figures.
 *
 * Each number was read from the publisher's own report or table (not press coverage).
 * Update after each release: CREA mid-January / April / July / October, TD and RBC quarterly,
 * Desjardins about every two months. `year` is the forecast year; pages show only the
 * forecasts for the year they are about.
 */
export interface BankForecast {
  source: string;
  /** The report, as named by the publisher. */
  report: string;
  url: string;
  /** Publication date, YYYY-MM-DD. */
  published: string;
  year: number;
  /** Ontario annual % change in home prices in `year`. */
  pricePct: number;
  /** What the price figure measures, when it is not the MLS® average price. */
  priceMeasure?: string;
  /** Ontario annual % change in home sales in `year`. */
  salesPct: number;
}

export const BANK_FORECASTS: BankForecast[] = [
  {
    source: "Desjardins",
    report: "Canadian Housing Outlook",
    url: "https://www.desjardins.com/en/savings-investment/economic-studies/canada-housing-outlook-november-16-2026.html",
    published: "2026-11-16",
    year: 2027,
    pricePct: 2.3,
    salesPct: 4.6,
  },
  {
    source: "CREA",
    report: "Resale housing market forecast",
    url: "https://www.globenewswire.com/news-release/2026/10/16/3382342/0/en/crea-revises-resale-housing-market-forecast.html",
    published: "2026-10-16",
    year: 2027,
    pricePct: 0.7,
    salesPct: 5.3,
  },
  {
    source: "TD Economics",
    report: "Provincial Resale Market Outlook",
    url: "https://economics.td.com/ca-provincial-housing-outlook",
    published: "2026-09-29",
    year: 2027,
    pricePct: 0.6,
    salesPct: 7.4,
  },
  {
    source: "RBC Economics",
    report: "Mid-year outlook for Canada's housing market",
    url: "https://www.rbc.com/en/economics/canadian-analysis/canadian-housing/special-housing-reports/mid-year-outlook-for-canadas-housing-market-between-correction-and-recovery/",
    published: "2026-09-01",
    year: 2027,
    pricePct: 0.7,
    priceMeasure: "the RPS home price index",
    salesPct: 8.2,
  },
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "November 16, 2026". */
export function forecastDateLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export interface ForecastRange {
  year: number;
  forecasts: BankForecast[];
  priceLow: number;
  priceHigh: number;
  salesLow: number;
  salesHigh: number;
  /** "September to November 2026". */
  publishedSpan: string;
}

/** The forecasts for `year`, newest first, with their range; null when there are none. */
export function forecastRange(year: number, all: BankForecast[] = BANK_FORECASTS): ForecastRange | null {
  const forecasts = all.filter((f) => f.year === year).sort((a, b) => b.published.localeCompare(a.published));
  if (forecasts.length === 0) return null;
  const prices = forecasts.map((f) => f.pricePct);
  const sales = forecasts.map((f) => f.salesPct);
  const first = forecasts[forecasts.length - 1].published;
  const last = forecasts[0].published;
  const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
  const publishedSpan =
    first.slice(0, 7) === last.slice(0, 7)
      ? `${month(last)} ${last.slice(0, 4)}`
      : first.slice(0, 4) === last.slice(0, 4)
        ? `${month(first)} to ${month(last)} ${last.slice(0, 4)}`
        : `${month(first)} ${first.slice(0, 4)} to ${month(last)} ${last.slice(0, 4)}`;
  return {
    year,
    forecasts,
    priceLow: Math.min(...prices),
    priceHigh: Math.max(...prices),
    salesLow: Math.min(...sales),
    salesHigh: Math.max(...sales),
    publishedSpan,
  };
}

const range = (lo: number, hi: number) => (lo === hi ? signed(lo) : `${signed(lo)} to ${signed(hi)}`);

/**
 * The answer to "What is the {city} housing market forecast for {year}?". `measured` is our own
 * sentence on the city's price change, appended when present.
 */
export function forecastAnswer(city: string, r: ForecastRange, measured: string | null): string {
  const n = r.forecasts.length;
  const who = r.forecasts.map((f) => f.source).join(", ");
  return [
    "PureProperty does not forecast prices.",
    `The ${n} forecasts for Ontario published from ${r.publishedSpan} (${who}) expect home prices to change by ${range(r.priceLow, r.priceHigh)} in ${r.year}, and home sales by ${range(r.salesLow, r.salesHigh)}.`,
    `None of them publishes a forecast for ${city} alone.`,
    measured,
  ]
    .filter(Boolean)
    .join(" ");
}

export { signed as forecastPct };
