/**
 * "Are home prices dropping in {city}?" facts for /data/price-change and
 * /data/price-change/{city}.
 *
 * WHY. "{city} housing market forecast 2027" and "will house prices drop in ontario 2027" are
 * the most-searched Ontario home questions (autocomplete, 2026-11-08), and the results are
 * news articles and bank forecasts. We do not forecast. We measure what same homes sold for
 * against a year earlier, and whether that drop is growing or shrinking quarter by quarter —
 * the measured part of the question.
 *
 * DATA. data/price-change.json, built monthly by scripts/data/buildPriceChange.ts
 * (model: src/lib/data/priceChangeModel.ts). Static pages: nothing here reads the database.
 *
 * HONESTY. A change whose 95% range includes zero is "no clear change". The 2027 answer says
 * plainly that this is not a forecast. Medians shown as context are plain medians, not
 * same-home figures, and are labelled so.
 */
import raw from "@/data/price-change.json";
import { TYPE_GROUPS, TYPE_LABEL, type Change, type TypeGroup } from "@/lib/data/priceChangeModel";

export interface QuarterChange {
  /** "Q3 2026": that quarter against the same quarter a year earlier. */
  label: string;
  all: Change | null;
  /** Detached, semi-detached and townhouses. */
  house: Change | null;
  /** Condo apartments and condo townhouses. */
  condo: Change | null;
}

export interface PriceChangeArea {
  city: string;
  slug: string;
  /** Sales in the later 12 months. */
  sales: number;
  all: Change | null;
  byType: Record<TypeGroup, Change | null>;
  /** Plain median sale price in the later 12 months (context only; not same-home). */
  medianPrice: Record<TypeGroup, number | null>;
  quarters: QuarterChange[];
}

export interface PriceChangeFile {
  generatedAt: string;
  earlierFrom: string;
  laterFrom: string;
  /** Exclusive. */
  laterTo: string;
  ontario: PriceChangeArea;
  cities: PriceChangeArea[];
}

export const priceChangePath = (slug?: string) => (slug ? `/data/price-change/${slug}` : "/data/price-change");

export const PRICE_CHANGE_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive). Same-home medians only. Not a forecast.";

export function getPriceChangeData(): PriceChangeFile {
  return raw as unknown as PriceChangeFile;
}

export function priceChangeAreaBySlug(slug: string): PriceChangeArea | null {
  return getPriceChangeData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** The last month inside an exclusive end date: "2026-11-01" → "Oct 2026". */
export function lastMonthLabel(exclusiveIso: string): string {
  const y = Number(exclusiveIso.slice(0, 4));
  const m = Number(exclusiveIso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
}

/** "−7.6%", or "−1.2% (no clear change)". */
export function changeLabel(c: Change): string {
  const s = `${c.pct >= 0 ? "+" : "−"}${Math.abs(c.pct).toFixed(1)}%`;
  return c.significant ? s : `${s} (no clear change)`;
}

/** "7.6% lower" / "2.1% higher" / "about the same". */
export function directionWords(c: Change): string {
  if (!c.significant) return "about the same as";
  return `${Math.abs(c.pct).toFixed(1)}% ${c.pct < 0 ? "lower than" : "higher than"}`;
}

/** Trend of the year-over-year change across the published quarters, in words. */
export function trendText(series: { label: string; c: Change | null }[], what: string): string | null {
  const pts = series.filter((p): p is { label: string; c: Change } => Boolean(p.c));
  if (pts.length < 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  // The deepest (most negative) or highest point, to describe a turn.
  const extreme = pts.reduce((m, p) => (Math.abs(p.c.pct) > Math.abs(m.c.pct) ? p : m), first);
  const f = (p: { c: Change }) => `${p.c.pct >= 0 ? "+" : "−"}${Math.abs(p.c.pct).toFixed(1)}%`;
  const gap = Math.abs(last.c.pct) - Math.abs(extreme.c.pct);
  if (extreme !== last && gap <= -1 && Math.sign(extreme.c.pct) === Math.sign(last.c.pct)) {
    return `For ${what}, the change against a year earlier was ${f(extreme)} in ${extreme.label} and ${f(last)} in ${last.label}: the ${last.c.pct < 0 ? "drop" : "rise"} got smaller.`;
  }
  const d = Math.abs(last.c.pct) - Math.abs(first.c.pct);
  if (d >= 1) return `For ${what}, the change against a year earlier went from ${f(first)} in ${first.label} to ${f(last)} in ${last.label}: the ${last.c.pct < 0 ? "drop" : "rise"} got larger.`;
  return `For ${what}, the change against a year earlier stayed close to ${f(last)} from ${first.label} to ${last.label}.`;
}

export interface PriceChangeFacts {
  title: string;
  summary: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
  window: string;
  earlierWindow: string;
  outlook: string;
  measures: { name: string; value: number; unitText: string }[];
}

export function buildPriceChangeFacts(a: PriceChangeArea, file: PriceChangeFile, year: number): PriceChangeFacts | null {
  if (!a.all) return null;
  const place = a.city;
  const window = `${monthLabel(file.laterFrom)} to ${lastMonthLabel(file.laterTo)}`;
  const earlierWindow = `${monthLabel(file.earlierFrom)} to ${lastMonthLabel(file.laterFrom)}`;
  const facts: { id: string; text: string }[] = [
    {
      id: "all",
      text: `Homes in ${place} sold for ${directionWords(a.all)} the same kind of home a year earlier (${window} against ${earlierWindow}, ${a.all.cells.toLocaleString("en-CA")} matched groups of similar homes).`,
    },
  ];
  const typed = TYPE_GROUPS.filter((t) => a.byType[t]);
  if (typed.length) {
    facts.push({
      id: "types",
      text: `By home type: ${typed.map((t) => `${TYPE_LABEL[t].toLowerCase()} ${changeLabel(a.byType[t]!)}`).join(", ")}.`,
    });
  }
  const det = a.byType.detached;
  const cap = a.byType.condoApt;
  if (det?.significant && cap?.significant && Math.abs(cap.pct - det.pct) >= 1) {
    facts.push({
      id: "gap",
      text: `${cap.pct < det.pct ? "Condo apartments fell more than detached houses" : "Detached houses fell more than condo apartments"}: ${changeLabel(cap)} against ${changeLabel(det)}.`,
    });
  }
  facts.push({
    id: "share",
    text: `In ${Math.round(a.all.shareDown * 100)}% of the matched groups of similar homes, the median sale price was lower than a year earlier.`,
  });
  const houseTrend = trendText(a.quarters.map((q) => ({ label: q.label, c: q.house })), "houses");
  const condoTrend = trendText(a.quarters.map((q) => ({ label: q.label, c: q.condo })), "condos");
  const allTrend = !houseTrend && !condoTrend ? trendText(a.quarters.map((q) => ({ label: q.label, c: q.all })), "all homes") : null;
  for (const [id, t] of [["trend-house", houseTrend], ["trend-condo", condoTrend], ["trend-all", allTrend]] as const) {
    if (t) facts.push({ id, text: t });
  }

  const lastQ = [...a.quarters].reverse().find((q) => q.all);
  const outlook =
    `PureProperty does not forecast prices. What the sales show: ` +
    (lastQ?.all ? `in ${lastQ.label}, homes in ${place} sold for ${directionWords(lastQ.all)} a year earlier. ` : "") +
    [houseTrend, condoTrend, allTrend].filter(Boolean).join(" ") +
    ` These figures describe sales that already happened, not where prices go next.`;

  const title = `Are Home Prices Dropping in ${place}? ${year} Same-Home Price Change`;
  // The summary names houses and condo apartments (the two ends) when both exist.
  const lead = (["detached", "condoApt"] as const).filter((t) => a.byType[t]);
  const shown = lead.length === 2 ? lead : typed.slice(0, 2);
  const summary = `Homes in ${place} sold for ${directionWords(a.all)} similar homes a year earlier (${window}).${
    shown.length ? ` ${shown.map((t) => `${TYPE_LABEL[t]}: ${changeLabel(a.byType[t]!)}`).join("; ")}.` : ""
  }`;

  const faqs = [
    { q: `Are house prices dropping in ${place}?`, a: `${facts[0].text} ${facts.find((f) => f.id === "types")?.text ?? ""}`.trim() },
    { q: `Will house prices drop in ${place} in ${year + 1}?`, a: outlook },
  ];
  if (cap) faqs.push({ q: `How much have condo prices dropped in ${place}?`, a: `Condo apartments in ${place}: ${changeLabel(cap)} against similar units a year earlier (${window}).` });
  faqs.push({
    q: "How is the same-home price change measured?",
    a: `Each sale is grouped with similar homes: the same community, home type, bedrooms above ground and size band. Each group's median price in ${window} is compared with its own median in ${earlierWindow}, so a change in the mix of homes sold does not move the figure. Groups need at least 3 sales in each period. "No clear change" means the 95% range includes zero.`,
  });

  const measures = [
    { name: "Same-home price change, all home types", value: Math.round(a.all.pct * 10) / 10, unitText: "percent" },
    ...typed.map((t) => ({ name: `Same-home price change, ${TYPE_LABEL[t].toLowerCase()}`, value: Math.round(a.byType[t]!.pct * 10) / 10, unitText: "percent" })),
  ];
  return { title, summary, facts, faqs, window, earlierWindow, outlook, measures };
}

/** Cities with a figure, largest drop first. */
export function rankedAreas(file: PriceChangeFile): PriceChangeArea[] {
  return file.cities.filter((c) => c.all).sort((x, y) => x.all!.pct - y.all!.pct);
}
