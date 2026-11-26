import raw from "@/data/property-tax.json";
import { TAX_HOME_LABEL, TAX_HOME_TYPES, type PropertyTaxFile, type TaxArea } from "@/lib/data/propertyTaxModel";
export * from "@/lib/data/propertyTaxModel";

// ── Page facts ───────────────────────────────────────────────────────────────
//
// /data/property-tax and /data/property-tax/{city}: "how much is property tax in {city}"
// (Google Trends 2026-11-26: "property tax" ~34x "toronto housing market" in Ontario; autocomplete
// "property tax toronto / vaughan / brampton / mississauga", "... per month"). Other sites publish
// the tax RATE; these pages show what owners actually pay, from the tax bill on each sold listing.
// Built monthly by scripts/data/buildPropertyTax.ts.

export const propertyTaxPath = (slug?: string) => (slug ? `/data/property-tax/${slug}` : "/data/property-tax");

export const TAX_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive). Annual property tax as reported on each listing (the seller's last tax bill). Medians only.";

export function getTaxData(): PropertyTaxFile {
  return raw as unknown as PropertyTaxFile;
}

export function taxAreaBySlug(slug: string): TaxArea | null {
  return getTaxData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const lastMonthLabel = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
};
export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/** Cities by tax per $100,000 of sale price, lowest first. */
export function rankedTaxCities(file: PropertyTaxFile): TaxArea[] {
  return [...file.cities].filter((c) => c.all.taxPer100k != null).sort((x, y) => x.all.taxPer100k! - y.all.taxPer100k!);
}

export interface TaxFacts {
  title: string;
  summary: string;
  window: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
  measures: { name: string; value: number; unitText: string }[];
}

export function buildTaxFacts(c: TaxArea, file: PropertyTaxFile, year: number): TaxFacts | null {
  const a = c.all;
  if (!a.medianTax) return null;
  const window = `${monthLabel(file.from)} to ${lastMonthLabel(file.to)}`;
  const monthly = Math.round(a.medianTax / 12);
  const facts: { id: string; text: string }[] = [
    {
      id: "tax",
      text: `Homes that sold in ${c.city} from ${window} carried a median property tax of ${money(a.medianTax)} a year (about ${money(monthly)} a month)${
        a.lowTax && a.highTax ? `; the middle half paid ${money(a.lowTax)} to ${money(a.highTax)}` : ""
      }.`,
    },
  ];
  const types = TAX_HOME_TYPES.filter((t) => c.byType[t]?.medianTax);
  if (types.length) {
    facts.push({ id: "types", text: `By home type: ${types.map((t) => `${TAX_HOME_LABEL[t].toLowerCase()} ${money(c.byType[t]!.medianTax!)}`).join(", ")} a year.` });
  }
  const ranked = rankedTaxCities(file);
  const rank = ranked.findIndex((x) => x.slug === c.slug) + 1;
  if (a.taxPer100k != null && rank > 0 && ranked.length >= 5) {
    const lo = ranked[0];
    const hi = ranked[ranked.length - 1];
    facts.push({
      id: "rate",
      text: `Owners in ${c.city} pay about ${money(a.taxPer100k)} a year for every $100,000 of sale price, the ${ordinal(rank)} lowest of ${ranked.length} Ontario cities (from ${money(lo.all.taxPer100k!)} in ${lo.city} to ${money(hi.all.taxPer100k!)} in ${hi.city}).`,
    });
  }
  const byTax = c.communities.filter((h) => h.medianTax).sort((x, y) => y.medianTax! - x.medianTax!);
  if (byTax.length >= 4) {
    const hi = byTax[0];
    const lo = byTax[byTax.length - 1];
    facts.push({ id: "range", text: `By community, the median tax runs from ${money(hi.medianTax!)} a year in ${hi.name} to ${money(lo.medianTax!)} in ${lo.name}.` });
  }
  if (c.taxYear) facts.push({ id: "year", text: `Most sellers listed their ${c.taxYear} tax bill. A bill rises each year with the municipal budget.` });

  const title = `How Much Is Property Tax in ${c.city}? (${year}) By Home Type and Community`;
  const summary = `${facts[0].text}${a.taxPer100k != null ? ` About ${money(a.taxPer100k)} a year per $100,000 of price.` : ""}`;
  const typeFact = facts.find((f) => f.id === "types")?.text;
  const rateFact = facts.find((f) => f.id === "rate")?.text;
  const faqs = [
    { q: `How much is property tax in ${c.city}?`, a: [facts[0].text, typeFact].filter(Boolean).join(" ") },
    {
      q: `How much is property tax in ${c.city} per month?`,
      a: `About ${money(monthly)} a month for the median home (${money(a.medianTax)} a year).${
        types.length ? ` By home type: ${types.map((t) => `${TAX_HOME_LABEL[t].toLowerCase()} ${money(c.byType[t]!.medianTax! / 12)}`).join(", ")} a month.` : ""
      } Many owners pay in instalments set by the city, or through their mortgage payment.`,
    },
    ...(rateFact ? [{ q: `Is property tax high in ${c.city}?`, a: rateFact }] : []),
    {
      q: "How is property tax calculated in Ontario?",
      a: "Your municipality multiplies your home's assessed value from MPAC by its residential tax rate, which includes the provincial education rate. The assessed value is not the market price, so two homes with the same price can have different bills. The amounts on this page are what sellers paid, as reported on their listings.",
    },
    {
      q: "How are these figures measured?",
      a: `Home sales in ${c.city} with the deal signed ${window}, from MLS® records, using the annual property tax entered on each listing. Medians only. Amounts under $300, over $100,000, or outside 0.1% to 3% of the sale price are left out as errors.`,
    },
  ];
  const measures = [
    { name: "Median annual property tax, all home types", value: a.medianTax, unitText: "CAD per year" },
    ...TAX_HOME_TYPES.filter((t) => c.byType[t]?.medianTax).map((t) => ({ name: `Median annual property tax, ${TAX_HOME_LABEL[t].toLowerCase()}`, value: c.byType[t]!.medianTax!, unitText: "CAD per year" })),
    ...(a.taxPer100k != null ? [{ name: "Median property tax per $100,000 of sale price", value: a.taxPer100k, unitText: "CAD per year" }] : []),
  ];
  return { title, summary, window, facts, faqs, measures };
}
