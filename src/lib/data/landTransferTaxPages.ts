// ── Page facts ───────────────────────────────────────────────────────────────
//
// /data/land-transfer-tax and /data/land-transfer-tax/{city}: "land transfer tax calculator
// {toronto, vaughan, ontario}" and "first time home buyer ontario" (Google Trends 2026-11-26:
// land transfer tax ~5x, first time home buyer ~5x "toronto housing market"). Each city page
// applies the tax to that city's median sold price by home type (data/sold-prices.json), so the
// page answers "how much would I pay here" before the reader types a price.
import { getSoldData, type SoldCity } from "@/lib/data/soldPrices";
import { TYPE_GROUPS, TYPE_LABEL, type TypeGroup } from "@/lib/data/priceChangeModel";
import { landTransferTax, type LttResult } from "@/lib/tax/landTransferTax";

export const landTransferTaxPath = (slug?: string) => (slug ? `/data/land-transfer-tax/${slug}` : "/data/land-transfer-tax");

/** Only the City of Toronto charges a municipal land transfer tax in Ontario. */
export const isToronto = (slug: string) => slug === "toronto";

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export function lttCities(): SoldCity[] {
  return getSoldData().cities.filter((c) => c.all.medianPrice);
}

export function lttCityBySlug(slug: string): SoldCity | null {
  return lttCities().find((c) => c.slug === slug.toLowerCase()) ?? null;
}

export interface LttRow {
  type: TypeGroup | "all";
  label: string;
  price: number;
  buyer: LttResult;
  firstTime: LttResult;
}

export function lttRows(c: SoldCity): LttRow[] {
  const toronto = isToronto(c.slug);
  const row = (type: TypeGroup | "all", label: string, price: number): LttRow => ({
    type,
    label,
    price,
    buyer: landTransferTax(price, { toronto, firstTime: false }),
    firstTime: landTransferTax(price, { toronto, firstTime: true }),
  });
  return [
    row("all", "All homes", c.all.medianPrice!),
    ...TYPE_GROUPS.filter((t) => c.byType[t]?.medianPrice).map((t) => row(t, TYPE_LABEL[t], c.byType[t]!.medianPrice!)),
  ];
}

export interface LttFacts {
  title: string;
  summary: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
}

export function buildLttFacts(c: SoldCity, year: number): LttFacts {
  const toronto = isToronto(c.slug);
  const rows = lttRows(c);
  const all = rows[0];
  const taxes = toronto ? "Ontario and Toronto land transfer tax" : "Ontario land transfer tax";
  const facts = [
    {
      id: "median",
      text: `On ${c.city}'s median sold price of ${money(all.price)}, a buyer pays ${money(all.buyer.total)} in ${taxes}${
        toronto ? ` (${money(all.buyer.ontario)} to Ontario and ${money(all.buyer.toronto)} to the City)` : ""
      }; a first-time buyer pays ${money(all.firstTime.total)}.`,
    },
    ...rows.slice(1).map((r) => ({ id: r.type, text: `${r.label} (median ${money(r.price)}): ${money(r.buyer.total)}, or ${money(r.firstTime.total)} for a first-time buyer.` })),
    {
      id: "city",
      text: toronto
        ? "Toronto is the only Ontario city that adds its own land transfer tax, so a Toronto buyer pays the tax twice. Since April 1, 2026, the City charges more on homes over $3 million."
        : `${c.city} does not charge a municipal land transfer tax; only the City of Toronto does. Buyers in ${c.city} pay the Ontario tax only.`,
    },
  ];
  const title = `Land Transfer Tax in ${c.city} (${year}): Calculator and What Buyers Pay`;
  const summary = facts[0].text;
  const faqs = [
    { q: `How much is land transfer tax in ${c.city}?`, a: [facts[0].text, ...rows.slice(1).map((r) => `${r.label}: ${money(r.buyer.total)}.`)].join(" ") },
    {
      q: `How much land transfer tax does a first-time buyer pay in ${c.city}?`,
      a: toronto
        ? `A first-time buyer gets up to $4,000 back from Ontario and up to $4,475 from the City of Toronto. On the median ${money(all.price)} home, that leaves ${money(all.firstTime.total)} to pay. A first-time buyer pays nothing on a home up to about $368,000.`
        : `A first-time buyer gets up to $4,000 back from Ontario. On the median ${money(all.price)} home, that leaves ${money(all.firstTime.total)} to pay. A first-time buyer pays nothing on a home up to about $368,000.`,
    },
    {
      q: `Does ${c.city} have a municipal land transfer tax?`,
      a: toronto
        ? "Yes. Toronto is the only municipality in Ontario with its own land transfer tax. Its rates match Ontario's up to $3 million and are higher above that (4.4% to 8.6% since April 1, 2026)."
        : `No. Only the City of Toronto charges a municipal land transfer tax. In ${c.city} you pay the Ontario land transfer tax only.`,
    },
    {
      q: "When do you pay land transfer tax?",
      a: "On the closing day. Your real estate lawyer pays it when they register the transfer, from the funds you give them for closing, and claims the first-time buyer refund at the same time.",
    },
  ];
  return { title, summary, facts, faqs };
}
