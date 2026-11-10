/**
 * Home sales by calendar month — "when do the most buyers act" — for the best-month-to-sell
 * sentence on /data/housing-market/{city} and /data/days-on-market/{city}.
 *
 * WHY NOT region_seasonality. That RPC sums every sale of the last "5 years" by calendar
 * month, but raw_vow_sold holds only ~24 rolling months, so the window really covers ~2 years
 * and the months at its edges are counted 3 times while the rest are counted twice. October
 * (3 Octobers in the window on 2026-11-09) read as the busiest month in Toronto, Markham and
 * others. Found 2026-11-10; the live pages said "over the last 5 years".
 *
 * Here: the last 24 FULL months of the board's monthly series (deal-date sales, leases
 * excluded upstream), so every calendar month is counted exactly twice. Price by month is
 * never used: a falling year biases it (see marketOutlook.ts).
 */
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const WINDOW = 24;

export interface MonthSales {
  month: number; // 1-12
  label: string;
  sales: number; // sum over the 2 years
}

function torontoMonth(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" }).slice(0, 7);
}

function prevMonth(ym: string): string {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Sales per calendar month over the last 24 full months, or null when any month is missing or below the floor. */
export function salesByCalendarMonth(
  monthly: { month: string; sales: number }[],
  dataAsOf: string,
  minPerMonth = 30,
): { months: MonthSales[]; from: string; to: string } | null {
  const byMonth = new Map(monthly.map((p) => [p.month, p.sales]));
  // The 24 calendar months before the current (partial) Toronto month, newest first.
  const keys: string[] = [];
  let k = prevMonth(torontoMonth(dataAsOf));
  for (let i = 0; i < WINDOW; i++) {
    keys.push(k);
    k = prevMonth(k);
  }
  if (keys.some((key) => !byMonth.has(key))) return null;
  const sums = new Array(12).fill(0) as number[];
  for (const key of keys) sums[Number(key.slice(5, 7)) - 1] += byMonth.get(key) ?? 0;
  if (sums.some((s) => s < minPerMonth)) return null;
  return {
    months: sums.map((sales, i) => ({ month: i + 1, label: MONTH_NAMES[i], sales })),
    from: keys[keys.length - 1],
    to: keys[0],
  };
}

const ymLabel = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** The best-month sentence, with its period stated. */
export function seasonSentence(city: string, s: { months: MonthSales[]; from: string; to: string }): { text: string; ratio: number } {
  const busy = [...s.months].sort((a, b) => b.sales - a.sales).slice(0, 3).map((m) => m.label);
  const quiet = s.months.reduce((a, b) => (b.sales < a.sales ? b : a));
  const peak = s.months.reduce((a, b) => (b.sales > a.sales ? b : a));
  const ratio = peak.sales / quiet.sales;
  return {
    ratio,
    text:
      `Over the last 2 years (${ymLabel(s.from)} to ${ymLabel(s.to)}), the most homes in ${city} sold in ${busy[0]}, ${busy[1]} and ${busy[2]}, ` +
      `and the fewest in ${quiet.label}. ${peak.label} had ${ratio.toFixed(1)} times as many sales as ${quiet.label}.`,
  };
}
