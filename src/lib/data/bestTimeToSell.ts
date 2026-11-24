/**
 * "Best time to sell a house in {city}" for /data/best-time-to-sell and /data/best-time-to-sell/{city}.
 *
 * WHY. "best time to sell a house in toronto" (AI-search panel 2026-11-24): the results were
 * agent blog posts with US seasonality or no numbers. No page measured Ontario sales by month
 * against similar homes.
 *
 * DATA. data/best-time-to-sell.json, built monthly by scripts/data/buildBestTimeToSell.ts. Static.
 *
 * HONESTY. The month is the month the deal was signed, so the advice converts it to a listing
 * date with the city's own days on market. A price claim needs a 95% range that excludes zero;
 * otherwise the copy names the speed and over-asking figures only. The price figure compares
 * similar homes with the year's trend removed, so it is the season, not the market moving.
 */
import raw from "@/data/best-time-to-sell.json";
import { soldCityBySlug } from "@/lib/data/soldPrices";
import type { BestTimeFile, MonthStats, SellCity } from "@/lib/data/bestTimeToSellModel";
export * from "@/lib/data/bestTimeToSellModel";

export const bestTimeToSellPath = (slug?: string) => (slug ? `/data/best-time-to-sell/${slug}` : "/data/best-time-to-sell");

export const BEST_TIME_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive). Month = the month the deal was signed; price = similar homes in the same community against the average month, with the trend removed.";

export function getBestTimeData(): BestTimeFile {
  return raw as unknown as BestTimeFile;
}

export function bestTimeCityBySlug(slug: string): SellCity | null {
  return getBestTimeData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const lastMonthLabel = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${SHORT[m - 2]} ${y}`;
};
export const signedPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
const money = (n: number) => `$${n.toLocaleString("en-CA")}`;
const listJoin = (a: string[]) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);

/** Months with a significant premium, best first (at most 3). */
export function bestMonths(c: SellCity): MonthStats[] {
  return c.months
    .filter((m) => m.price?.significant && m.price.pct > 0)
    .sort((a, b) => b.price!.pct - a.price!.pct)
    .slice(0, 3);
}

/** Months with a significant discount, worst first (at most 2). */
export function worstMonths(c: SellCity): MonthStats[] {
  return c.months
    .filter((m) => m.price?.significant && m.price.pct < 0)
    .sort((a, b) => a.price!.pct - b.price!.pct)
    .slice(0, 2);
}

/** Best minus worst month, in percent of price; null without a significant month on each side. */
export function seasonSpread(c: SellCity): number | null {
  const b = bestMonths(c)[0];
  const w = worstMonths(c)[0];
  return b && w ? b.price!.pct - w.price!.pct : null;
}

export interface BestTimeFacts {
  title: string;
  summary: string;
  window: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
}

export function buildBestTimeFacts(c: SellCity, file: BestTimeFile, year: number): BestTimeFacts {
  const window = `${monthLabel(file.from)} to ${lastMonthLabel(file.to)}`;
  const best = bestMonths(c);
  const worst = worstMonths(c);
  const spread = seasonSpread(c);
  const facts: { id: string; text: string }[] = [];

  if (best.length) {
    facts.push({
      id: "best",
      text: `In ${c.city}, similar homes sold for the most when the deal was signed in ${listJoin(best.map((m) => MONTH_NAMES[m.month - 1]))}: ${listJoin(
        best.map((m) => `${signedPct(m.price!.pct)} in ${MONTH_NAMES[m.month - 1]}`),
      )}, against the average month.`,
    });
  } else {
    facts.push({ id: "best", text: `In ${c.city}, no month gave a measurable price premium on similar homes once the year's trend is removed.` });
  }
  if (worst.length) {
    facts.push({
      id: "worst",
      text: `The weakest: ${listJoin(worst.map((m) => `${MONTH_NAMES[m.month - 1]} (${signedPct(m.price!.pct)})`))}.`,
    });
  }
  const median = soldCityBySlug(c.slug)?.all.medianPrice ?? null;
  if (spread != null && median) {
    facts.push({
      id: "dollars",
      text: `On the ${c.city} median sold price of ${money(median)}, the gap between ${MONTH_NAMES[best[0].month - 1]} and ${MONTH_NAMES[worst[0].month - 1]} is about ${money(Math.round((spread / 100) * median / 1000) * 1000)}.`,
    });
  }
  const withDom = c.months.filter((m) => m.medianDom != null);
  const fastest = [...withDom].sort((a, b) => a.medianDom! - b.medianDom!)[0];
  const slowest = [...withDom].sort((a, b) => b.medianDom! - a.medianDom!)[0];
  const withOver = c.months.filter((m) => m.overAskShare != null);
  const mostOver = [...withOver].sort((a, b) => b.overAskShare! - a.overAskShare!)[0];
  const leastOver = [...withOver].sort((a, b) => a.overAskShare! - b.overAskShare!)[0];
  if (fastest && slowest && mostOver && leastOver) {
    facts.push({
      id: "speed",
      text: `Homes sold fastest in ${MONTH_NAMES[fastest.month - 1]} (median ${fastest.medianDom} days on the market) and slowest in ${MONTH_NAMES[slowest.month - 1]} (${slowest.medianDom} days). ${mostOver.overAskShare}% sold over asking in ${MONTH_NAMES[mostOver.month - 1]}, against ${leastOver.overAskShare}% in ${MONTH_NAMES[leastOver.month - 1]}.`,
    });
  }
  const target = best[0] ?? fastest;
  if (target?.medianDom != null) {
    const listMonth = MONTH_NAMES[(target.month + 10) % 12];
    facts.push({
      id: "list",
      text: `A deal signed in ${MONTH_NAMES[target.month - 1]} took a median ${target.medianDom} days from listing, so a home listed in ${target.medianDom >= 20 ? `late ${listMonth} or early ${MONTH_NAMES[target.month - 1]}` : `early ${MONTH_NAMES[target.month - 1]}`} lands in that month.`,
    });
  }
  const days = c.weekdays.filter((w) => w.day >= 1 && w.day <= 5 && w.medianDom != null);
  if (days.length >= 4) {
    const quick = [...days].sort((a, b) => a.medianDom! - b.medianDom!)[0];
    const slow = [...days].sort((a, b) => b.medianDom! - a.medianDom!)[0];
    facts.push({
      id: "weekday",
      text:
        slow.medianDom! - quick.medianDom! <= 2
          ? `The weekday a home was listed made little difference: ${days.length} weekdays within ${slow.medianDom! - quick.medianDom!} days of each other on the median time to sell.`
          : `Homes listed on a ${WEEKDAY_NAMES[quick.day]} sold in a median ${quick.medianDom} days, against ${slow.medianDom} days for a ${WEEKDAY_NAMES[slow.day]}.`,
    });
  }
  facts.push({ id: "basis", text: `${c.sales.toLocaleString("en-CA")} sales in ${c.city}, ${window} (every calendar month counted twice).` });

  const title = `Best Time to Sell a House in ${c.city} (${year}): Price, Speed and Over-Asking by Month`;
  const summary = [facts[0].text, facts.find((f) => f.id === "worst")?.text].filter(Boolean).join(" ");
  const faqs = [
    { q: `What is the best month to sell a house in ${c.city}?`, a: [facts[0].text, facts.find((f) => f.id === "list")?.text].filter(Boolean).join(" ") },
    ...(worst.length ? [{ q: `What is the worst month to sell a house in ${c.city}?`, a: [facts.find((f) => f.id === "worst")!.text, facts.find((f) => f.id === "dollars")?.text].filter(Boolean).join(" ") }] : []),
    ...(facts.find((f) => f.id === "speed") ? [{ q: `When do homes sell fastest in ${c.city}?`, a: facts.find((f) => f.id === "speed")!.text }] : []),
    ...(facts.find((f) => f.id === "weekday") ? [{ q: "What day of the week is best to list a house?", a: facts.find((f) => f.id === "weekday")!.text }] : []),
    {
      q: "How is the month effect measured?",
      a: "Each sale is placed in the month its deal was signed. The model compares similar homes (same community, home type, bedrooms above ground and size band) and removes the price trend over the 2 years, so a month's figure is the season alone. A month is called better or worse only when its 95% range excludes zero. Days on market and sale-to-asking are plain medians of the homes that sold.",
    },
  ];
  return { title, summary, window, facts, faqs };
}

/** How many cities had their best month in spring (March–June). */
export function springShare(file: BestTimeFile): { spring: number; withBest: number } {
  const withBest = file.cities.filter((c) => bestMonths(c).length);
  return { spring: withBest.filter((c) => bestMonths(c)[0].month >= 3 && bestMonths(c)[0].month <= 6).length, withBest: withBest.length };
}
