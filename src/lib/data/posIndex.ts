/**
 * The monthly Ontario Power of Sale Index (/data/power-of-sale-index and its editions).
 *
 * One edition per full calendar month. All figures are counts and shares of home SALES
 * (deal date) from pos_monthly_stats (migration 166): how many sales were power of sale.
 *
 * NOISE. Ontario has ~40-50 power-of-sale sales a month, so one month moves a lot by chance.
 * The headline is therefore the 3 months to the edition month against the same 3 months a
 * year earlier; the single month is stated second; cities use 12 months (most cities have a
 * handful a month) and always show the count, so the reader sees the size.
 *
 * Aggregates only. The builder is pure; the loader is getPosMonthly.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";

export interface PosMonthRow {
  region: string;
  month: string; // YYYY-MM-01
  sales: number;
  pos_sales: number;
  pos_s2l: number | null;
  other_s2l: number | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** An edition needs a full month with at least this many Ontario sales (a thin month is a feed gap). */
export const MIN_EDITION_SALES = 2000;
/** A city row in the table needs this many sales in its 12 months. */
const MIN_CITY_SALES_12M = 500;
/** A city's year-on-year change needs this many power-of-sale sales in each 12-month period. */
const MIN_CITY_POS_FOR_CHANGE = 10;

export const posIndexPath = (edition?: string) => (edition ? `/data/power-of-sale-index/${edition}` : "/data/power-of-sale-index");

const ym = (d: string) => d.slice(0, 7);
export const editionLabel = (e: string) => `${MONTHS[Number(e.slice(5, 7)) - 1]} ${e.slice(0, 4)}`;
function addMonths(e: string, n: number): string {
  const t = Number(e.slice(0, 4)) * 12 + Number(e.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const pct2 = (n: number) => `${n.toFixed(2)}%`;
const count = (n: number) => n.toLocaleString("en-CA");

async function loadPosMonthly(): Promise<PosMonthRow[]> {
  const regions = ["ontario", ...OUTLOOK_CITIES.map((c) => c.city.toLowerCase())];
  const { data, error } = await getServiceRoleClient()
    .from("pos_monthly_stats")
    .select("region, month, sales, pos_sales, pos_s2l, other_s2l")
    .in("region", regions)
    .order("month", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    region: String(r.region),
    month: String(r.month),
    sales: Number(r.sales),
    pos_sales: Number(r.pos_sales),
    pos_s2l: r.pos_s2l == null ? null : Number(r.pos_s2l),
    other_s2l: r.other_s2l == null ? null : Number(r.other_s2l),
  }));
}

/** Ontario + the covered cities, by month (~420 rows). Cached 1h; [] on failure. */
export async function getPosMonthly(): Promise<PosMonthRow[]> {
  try {
    return await unstable_cache(loadPosMonthly, ["pos-monthly-stats", "v1"], { revalidate: 3600 })();
  } catch (err) {
    console.error("[posIndex] monthly read failed:", err);
    return [];
  }
}

/**
 * Drop the months before the power-of-sale flags start. pos_sales was backfilled 25 months
 * while pos_monthly_stats counts sales a month further back, so the oldest month(s) have
 * sales but no flags: a false 0%. Coverage starts at the first Ontario month with a flag.
 */
export function trimToCoverage(rows: PosMonthRow[]): PosMonthRow[] {
  const start = rows
    .filter((r) => r.region === "ontario" && r.pos_sales > 0)
    .map((r) => ym(r.month))
    .sort()[0];
  return start ? rows.filter((r) => ym(r.month) >= start) : [];
}

/** Editions ("YYYY-MM"), oldest first: full months before `todayIso`'s Toronto month with enough Ontario sales. */
export function availableEditions(all: PosMonthRow[], todayIso: string): string[] {
  const rows = trimToCoverage(all);
  const current = new Date(todayIso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 7);
  return rows
    .filter((r) => r.region === "ontario" && ym(r.month) < current && r.sales >= MIN_EDITION_SALES)
    .map((r) => ym(r.month))
    .sort()
    // Only months whose edition can be built (its 3-month headline needs 2 earlier months).
    .filter((e) => buildPosIndex(rows, e) != null);
}

interface Sum { sales: number; pos: number }
function sum(rows: PosMonthRow[], region: string, from: string, to: string): Sum | null {
  const want = new Set<string>();
  for (let e = from; e <= to; e = addMonths(e, 1)) want.add(e);
  const got = rows.filter((r) => r.region === region && want.has(ym(r.month)));
  if (got.length !== want.size) return null;
  return { sales: got.reduce((a, r) => a + r.sales, 0), pos: got.reduce((a, r) => a + r.pos_sales, 0) };
}
const share = (s: Sum) => (s.sales > 0 ? (s.pos / s.sales) * 100 : 0);

export interface PosIndexFact {
  id: string;
  text: string;
  measure: { name: string; value: number; unitText: string };
}

export interface PosIndexEdition {
  edition: string;
  label: string;
  title: string;
  headline: string;
  facts: PosIndexFact[];
  /** Ontario monthly share, oldest first, up to and including the edition month; avg3Pct =
   *  the 3 months ending that month (pooled counts), null for the first two. */
  series: { edition: string; label: string; sales: number; pos: number; sharePct: number; avg3Pct: number | null }[];
  /** The numbers behind the headline, for the stat cards. */
  hero: { from: string; sharePct: number; pos: number; sales: number; prevSharePct: number | null };
  month: { sharePct: number; pos: number; sales: number; prevSharePct: number | null };
  s2l: { pos: number; other: number } | null;
  /** Ontario share over the cities' 12 months, the reference line in the city chart. */
  ontario12Pct: number | null;
  cities: { city: string; slug: string; sales: number; pos: number; sharePct: number; prevSharePct: number | null }[];
  cityWindow: string;
  faqs: { q: string; a: string }[];
}

export function buildPosIndex(all: PosMonthRow[], edition: string): PosIndexEdition | null {
  const rows = trimToCoverage(all);
  const label = editionLabel(edition);
  const month = sum(rows, "ontario", edition, edition);
  const q3 = sum(rows, "ontario", addMonths(edition, -2), edition);
  if (!month || !q3 || month.sales < MIN_EDITION_SALES) return null;
  const q3Prev = sum(rows, "ontario", addMonths(edition, -14), addMonths(edition, -12));
  const monthPrev = sum(rows, "ontario", addMonths(edition, -12), addMonths(edition, -12));
  const facts: PosIndexFact[] = [];
  const q3From = editionLabel(addMonths(edition, -2));

  // Headline: the 3 months to the edition month.
  const headline =
    `In the 3 months from ${q3From} to ${label}, ${count(q3.pos)} of ${count(q3.sales)} home sales in Ontario (${pct2(share(q3))}) were power of sale` +
    (q3Prev && q3Prev.pos > 0
      ? `, ${share(q3) >= share(q3Prev) ? "up" : "down"} from ${pct2(share(q3Prev))} (${count(q3Prev.pos)} of ${count(q3Prev.sales)}) in the same months a year earlier.`
      : ".");
  facts.push({ id: "q3_share", text: headline, measure: { name: `Power-of-sale share of Ontario home sales, ${q3From} to ${label}`, value: Math.round(share(q3) * 100) / 100, unitText: "percent" } });

  const monthText =
    `In ${label} alone, ${count(month.pos)} of ${count(month.sales)} sales (${pct2(share(month))}) were power of sale` +
    (monthPrev && monthPrev.pos > 0 ? `, against ${pct2(share(monthPrev))} in ${editionLabel(addMonths(edition, -12))}.` : ".") +
    " One month moves a lot by chance; the 3-month figure is steadier.";
  facts.push({ id: "month_share", text: monthText, measure: { name: `Power-of-sale share of Ontario home sales, ${label}`, value: Math.round(share(month) * 100) / 100, unitText: "percent" } });

  // Price: medians cannot be pooled across months, so state the edition month's own medians,
  // and only when that month has 30+ power-of-sale sales.
  const mrow = rows.find((r) => r.region === "ontario" && ym(r.month) === edition);
  if (mrow && mrow.pos_sales >= 30 && mrow.pos_s2l != null && mrow.other_s2l != null) {
    const t = `In ${label}, power-of-sale homes in Ontario sold for a median of ${mrow.pos_s2l.toFixed(1)}% of their final asking price, against ${mrow.other_s2l.toFixed(1)}% for other homes.`;
    facts.push({ id: "s2l", text: t, measure: { name: `Median sale-to-final-asking price of power-of-sale sales, Ontario, ${label}`, value: mrow.pos_s2l, unitText: "percent" } });
  }

  // Cities: 12 months to the edition month, against the 12 before when both are large enough.
  const c12From = addMonths(edition, -11);
  const cities = OUTLOOK_CITIES.map((c) => {
    const cur = sum(rows, c.city.toLowerCase(), c12From, edition);
    if (!cur || cur.sales < MIN_CITY_SALES_12M) return null;
    const prev = sum(rows, c.city.toLowerCase(), addMonths(edition, -23), addMonths(edition, -12));
    const prevOk = prev && prev.sales >= MIN_CITY_SALES_12M && prev.pos >= MIN_CITY_POS_FOR_CHANGE && cur.pos >= MIN_CITY_POS_FOR_CHANGE;
    return { city: c.city, slug: c.slug, sales: cur.sales, pos: cur.pos, sharePct: share(cur), prevSharePct: prevOk ? share(prev) : null };
  })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => b.sharePct - a.sharePct);
  const cityWindow = `${editionLabel(c12From)} to ${label}`;
  if (cities.length >= 3) {
    const top = cities[0];
    const t = `Of the ${cities.length} largest markets, ${top.city} had the highest power-of-sale share in the 12 months from ${cityWindow}: ${count(top.pos)} of ${count(top.sales)} sales (${pct2(top.sharePct)}).`;
    facts.push({ id: "top_city", text: t, measure: { name: `Highest city power-of-sale share, ${cityWindow}`, value: Math.round(top.sharePct * 100) / 100, unitText: "percent" } });
  }

  const series = rows
    .filter((r) => r.region === "ontario" && ym(r.month) <= edition && r.sales >= MIN_EDITION_SALES)
    .map((r) => ({ edition: ym(r.month), label: editionLabel(ym(r.month)), sales: r.sales, pos: r.pos_sales, sharePct: r.sales > 0 ? (r.pos_sales / r.sales) * 100 : 0 }))
    .sort((a, b) => a.edition.localeCompare(b.edition))
    .map((p, i, arr) => {
      if (i < 2) return { ...p, avg3Pct: null };
      const w = arr.slice(i - 2, i + 1);
      // Pooled counts, and only when the 3 months are consecutive.
      const consecutive = w[2].edition === addMonths(w[0].edition, 2);
      const s3 = w.reduce((a, x) => a + x.sales, 0);
      return { ...p, avg3Pct: consecutive && s3 > 0 ? (w.reduce((a, x) => a + x.pos, 0) / s3) * 100 : null };
    });
  const ont12 = sum(rows, "ontario", c12From, edition);

  const faqs = [
    { q: "Are power of sales going up in Ontario?", a: headline },
    {
      q: "What is a power of sale?",
      a: "A power of sale is a sale by the lender after the owner falls behind on the mortgage. In Ontario, the lender can sell the home without a court order after the notice period ends.",
    },
    {
      q: "How does PureProperty count power-of-sale sales?",
      a: "A sale counts as power of sale when its MLS® listing description says so (power of sale, foreclosure, bank-owned, court-ordered or receivership), and does not say it is not one. Sales are dated by the day the deal was made, not the closing day. Listings that do not mention it are not counted, so the true number can be higher.",
    },
  ];

  return {
    edition,
    label,
    title: `Ontario Power of Sale Index: ${label}`,
    headline,
    facts,
    series,
    cities,
    cityWindow,
    faqs,
    hero: { from: q3From, sharePct: share(q3), pos: q3.pos, sales: q3.sales, prevSharePct: q3Prev && q3Prev.pos > 0 ? share(q3Prev) : null },
    month: { sharePct: share(month), pos: month.pos, sales: month.sales, prevSharePct: monthPrev && monthPrev.pos > 0 ? share(monthPrev) : null },
    s2l: mrow && mrow.pos_sales >= 30 && mrow.pos_s2l != null && mrow.other_s2l != null ? { pos: mrow.pos_s2l, other: mrow.other_s2l } : null,
    ontario12Pct: ont12 ? share(ont12) : null,
  };
}
