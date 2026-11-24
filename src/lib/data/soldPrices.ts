/**
 * "{city} sold prices" for /data/sold-prices and /data/sold-prices/{city}.
 *
 * WHY. "toronto house sold prices" (AI-search panel 2026-11-24): the top result was a UK site,
 * then an Australian one and a news gallery. No Ontario page gave sold-price medians by
 * neighbourhood and home type.
 *
 * DATA. data/sold-prices.json, built monthly by scripts/data/buildSoldPrices.ts. Static pages.
 * Medians only (15+ sales per figure); no address or single sale is shown — a reader who wants
 * the sales behind a median signs in (VOW). Plain medians move with the mix of homes sold, so
 * the facts point to the same-home price change for "are prices falling".
 */
import raw from "@/data/sold-prices.json";
import { TYPE_GROUPS, TYPE_LABEL } from "@/lib/data/priceChangeModel";
import { priceChangeAreaBySlug } from "@/lib/data/priceChange";
import type { SoldCity, SoldPricesFile } from "@/lib/data/soldPricesModel";
export * from "@/lib/data/soldPricesModel";

export const soldPricesPath = (slug?: string) => (slug ? `/data/sold-prices/${slug}` : "/data/sold-prices");

export const SOLD_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive). Medians of 15 or more sales only.";

export function getSoldData(): SoldPricesFile {
  return raw as unknown as SoldPricesFile;
}

export function soldCityBySlug(slug: string): SoldCity | null {
  return getSoldData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const lastMonthLabel = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
};
export const money = (n: number) => `$${n.toLocaleString("en-CA")}`;

export interface SoldFacts {
  title: string;
  summary: string;
  window: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
}

export function buildSoldFacts(c: SoldCity, file: SoldPricesFile, year: number): SoldFacts | null {
  const a = c.all;
  if (!a.medianPrice) return null;
  const window = `${monthLabel(file.from)} to ${lastMonthLabel(file.to)}`;
  const facts: { id: string; text: string }[] = [
    {
      id: "all",
      text: `Homes in ${c.city} sold for a median ${money(a.medianPrice)} (${a.sales.toLocaleString("en-CA")} sales, ${window})${
        a.saleToAsk != null ? `, at a median ${a.saleToAsk.toFixed(1)}% of the asking price` : ""
      }${a.overAskShare != null ? `; ${a.overAskShare}% sold over asking` : ""}${a.medianDom != null ? `, after a median ${a.medianDom} days on the market` : ""}.`,
    },
  ];
  const types = TYPE_GROUPS.filter((t) => c.byType[t]?.medianPrice);
  if (types.length) facts.push({ id: "types", text: `By home type: ${types.map((t) => `${TYPE_LABEL[t].toLowerCase()} ${money(c.byType[t]!.medianPrice!)}`).join(", ")}.` });
  if (c.detachedByBeds.length >= 2) {
    facts.push({ id: "beds", text: `Detached houses by bedrooms above ground: ${c.detachedByBeds.map((b) => `${b.beds} bedrooms ${money(b.medianPrice)}`).join(", ")}.` });
  }
  const change = priceChangeAreaBySlug(c.slug)?.all;
  if (change) {
    facts.push({
      id: "change",
      text: change.significant
        ? `Against a year earlier, the same kind of home sold for ${Math.abs(change.pct).toFixed(1)}% ${change.pct < 0 ? "less" : "more"} (same-home comparison; a plain median also moves with the mix of homes sold).`
        : "Against a year earlier, the same kind of home sold for about the same.",
    });
  }
  const det = c.communities.filter((h) => h.byType.detached).sort((x, y) => y.byType.detached! - x.byType.detached!);
  if (det.length >= 4) {
    facts.push({
      id: "range",
      text: `Detached houses by community: from a median ${money(det[0].byType.detached!)} (${det[0].name}) to ${money(det[det.length - 1].byType.detached!)} (${det[det.length - 1].name}).`,
    });
  }

  const title = `${c.city} Sold Prices ${year}: Median Sold Price by Neighbourhood and Home Type`;
  const summary = `${facts[0].text}${facts.find((f) => f.id === "types") ? ` ${facts.find((f) => f.id === "types")!.text}` : ""}`;
  const faqs = [
    { q: `What are homes selling for in ${c.city}?`, a: summary },
    ...(c.byType.detached?.medianPrice ? [{ q: `What is the median sold price of a detached house in ${c.city}?`, a: [`${money(c.byType.detached.medianPrice)} (${c.byType.detached.sales.toLocaleString("en-CA")} sales, ${window}).`, facts.find((f) => f.id === "beds")?.text].filter(Boolean).join(" ") }] : []),
    ...(change ? [{ q: `Are sold prices in ${c.city} going down?`, a: facts.find((f) => f.id === "change")!.text }] : []),
    {
      q: `Where can I see the sold price of a specific home in ${c.city}?`,
      a: "Individual sold prices come from the MLS® and, under the board's rules, are shown only to signed-in users. Sign in free on PureProperty to see each sale with its history; this page shows medians only.",
    },
  ];
  return { title, summary, window, facts, faqs };
}

/** Cities by median sold price, highest first. */
export function rankedSoldCities(file: SoldPricesFile): SoldCity[] {
  return [...file.cities].sort((x, y) => (y.all.medianPrice ?? 0) - (x.all.medianPrice ?? 0));
}
