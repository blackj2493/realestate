import raw from "@/data/condo-prices.json";
import { getPriceChangeData, trendText } from "@/lib/data/priceChange";
import { UNIT_LABEL, UNIT_TYPES, type CondoArea, type CondoPricesFile } from "@/lib/data/condoPricesModel";
export * from "@/lib/data/condoPricesModel";

// ── Page facts ───────────────────────────────────────────────────────────────
//
// /data/condo-prices and /data/condo-prices/{city}: "{city} condo prices {year}" and
// "average condo fees {city} per square foot" (AI-search panel, 2026-11-24: the newest
// figures in the results were from 2023). Built monthly by scripts/data/buildCondoPrices.ts.
// Per-sq-ft figures divide by the size-range midpoint (the feed gives a range, not an area),
// so the copy calls them approximate. The same-home price change comes from the price change
// study (data/price-change.json) so both pages state one number.


export const condoPricesPath = (slug?: string) => (slug ? `/data/condo-prices/${slug}` : "/data/condo-prices");

export const CONDO_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive). Medians only. Per-square-foot figures use the midpoint of the listed size range and are approximate.";

export function getCondoData(): CondoPricesFile {
  return raw as unknown as CondoPricesFile;
}

export function condoAreaBySlug(slug: string): CondoArea | null {
  return getCondoData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const lastMonthLabel = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
};
export const money = (n: number) => `$${n.toLocaleString("en-CA")}`;
export const fee2 = (n: number) => `$${n.toFixed(2)}`;

export interface CondoFacts {
  title: string;
  summary: string;
  window: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
  measures: { name: string; value: number; unitText: string }[];
}

export function buildCondoFacts(c: CondoArea, file: CondoPricesFile, year: number): CondoFacts | null {
  const a = c.all;
  if (!a.medianPrice) return null;
  const window = `${monthLabel(file.from)} to ${lastMonthLabel(file.to)}`;
  const facts: { id: string; text: string }[] = [
    {
      id: "price",
      text: `A condo apartment in ${c.city} sold for a median ${money(a.medianPrice)} (${a.sales.toLocaleString("en-CA")} sales, ${window})${
        a.pricePsf ? `, about ${money(a.pricePsf)} a square foot` : ""
      }.`,
    },
  ];
  const units = UNIT_TYPES.filter((u) => c.byUnit[u]?.medianPrice);
  if (units.length) {
    facts.push({ id: "units", text: `By unit: ${units.map((u) => `${UNIT_LABEL[u].toLowerCase()} ${money(c.byUnit[u]!.medianPrice!)}`).join(", ")}.` });
  }
  const pc = getPriceChangeData().cities.find((x) => x.slug === c.slug);
  const change = pc?.byType.condoApt;
  if (change) {
    facts.push({
      id: "change",
      text: change.significant
        ? `Same-unit condo apartment prices were ${Math.abs(change.pct).toFixed(1)}% ${change.pct < 0 ? "lower" : "higher"} than a year earlier.`
        : `Same-unit condo apartment prices were about the same as a year earlier.`,
    });
  }
  const trend = pc ? trendText(pc.quarters.map((q) => ({ label: q.label, c: q.condo })), "condos") : null;
  if (trend) facts.push({ id: "trend", text: trend });
  if (a.medianFee) {
    facts.push({
      id: "fee",
      text: `The median monthly condo fee was ${money(a.medianFee)}${a.feePsf ? `, about ${fee2(a.feePsf)} a square foot a month` : ""} (${a.feeSample.toLocaleString("en-CA")} sales with a fee).`,
    });
  }
  if (a.saleToAsk != null) {
    facts.push({
      id: "market",
      text: `Condos sold at a median ${a.saleToAsk.toFixed(1)}% of the asking price; ${a.overAskShare}% sold over asking${a.medianDom != null ? `, and the median time on the market was ${a.medianDom} days` : ""}.`,
    });
  }
  const psfRanked = c.communities.filter((h) => h.pricePsf).sort((x, y) => y.pricePsf! - x.pricePsf!);
  if (psfRanked.length >= 4) {
    const hi = psfRanked[0];
    const lo = psfRanked[psfRanked.length - 1];
    facts.push({ id: "range", text: `By community, from about ${money(hi.pricePsf!)} a square foot (${hi.name}) to ${money(lo.pricePsf!)} (${lo.name}).` });
  }

  const title = `${c.city} Condo Prices ${year}: Median Price, Price per Sq Ft and Condo Fees`;
  const summary = `${facts[0].text}${a.medianFee ? ` Median condo fee ${money(a.medianFee)} a month${a.feePsf ? ` (about ${fee2(a.feePsf)}/sq ft)` : ""}.` : ""}`;
  const faqs = [
    { q: `How much is a condo in ${c.city}?`, a: `${facts[0].text} ${facts.find((f) => f.id === "units")?.text ?? ""}`.trim() },
    ...(change ? [{ q: `Are condo prices dropping in ${c.city}?`, a: [facts.find((f) => f.id === "change")?.text, trend].filter(Boolean).join(" ") }] : []),
    ...(a.medianFee
      ? [{ q: `What are average condo fees in ${c.city} per square foot?`, a: `${facts.find((f) => f.id === "fee")!.text} Fees depend on the building and what the fee includes (heat, hydro, water).` }]
      : []),
    {
      q: "How are these figures measured?",
      a: `Condo apartment sales in ${c.city} with the deal signed ${window}, from MLS® records. Medians only. The feed gives each unit's size as a range (for example 600–699 sq ft), so per-square-foot figures use the middle of the range and are approximate.`,
    },
  ];
  const measures = [
    { name: "Median condo apartment sale price", value: a.medianPrice, unitText: "CAD" },
    ...(a.pricePsf ? [{ name: "Median price per square foot (approximate)", value: a.pricePsf, unitText: "CAD per sq ft" }] : []),
    ...(a.medianFee ? [{ name: "Median monthly condo fee", value: a.medianFee, unitText: "CAD per month" }] : []),
    ...(a.feePsf ? [{ name: "Median condo fee per square foot (approximate)", value: a.feePsf, unitText: "CAD per sq ft per month" }] : []),
  ];
  return { title, summary, window, facts, faqs, measures };
}

/** Cities by median price per sq ft, highest first. */
export function rankedCondoCities(file: CondoPricesFile): CondoArea[] {
  return [...file.cities].sort((x, y) => (y.all.pricePsf ?? 0) - (x.all.pricePsf ?? 0));
}
