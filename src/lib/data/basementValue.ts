/**
 * "Does a finished basement add value?" facts for /data/basement-value and
 * /data/basement-value/{city}.
 *
 * WHY. Ontario buyers and owners ask what a finished basement, a basement apartment or a
 * separate entrance adds at sale. An AI-search audit (2026-11-24) found no Ontario source with
 * measured numbers: the results were US articles and listing pages. We have the sales.
 *
 * DATA. data/basement-value.json, built monthly by scripts/data/buildBasementValue.ts from
 * MLS® sales (model: src/lib/data/basementValueModel.ts). The pages are static: nothing
 * here reads the database.
 *
 * HONESTY. Each gap compares similar houses (same community, type, above-grade bedrooms and
 * size band) and controls for parking, lot width, renovation words and the quarter of the
 * sale. It is an association, not a quote: condition and finish quality still differ. A gap
 * whose 95% range includes zero is called "not significant" and gets no dollar figure. Build
 * costs are typical GTA contractor figures, labelled as such, never measured by us.
 */
import raw from "@/data/basement-value.json";
import type { Effect, FitResult } from "@/lib/data/basementValueModel";

export interface RentMedian {
  median: number;
  leases: number;
}

export interface BasementCity {
  city: string;
  slug: string;
  sales: number;
  medianPrice: number | null;
  groups: { apt: number; fin: number; ref: number };
  /** Without the bathroom count: the basement as listed. */
  modelA: FitResult | null;
  /** With the bathroom count. */
  modelB: FitResult | null;
  rent: { oneBed: RentMedian | null; twoBed: RentMedian | null };
}

export interface BasementValueFile {
  generatedAt: string;
  salesFrom: string;
  /** Exclusive. */
  salesTo: string;
  rentsFrom: string;
  rentsTo: string;
  cities: BasementCity[];
}

/** Typical GTA contractor costs (2024–2026), not quotes. Shown as context only. */
export const TYPICAL_COST = { fin: 40_000, apt: 75_000, sep: 25_000 } as const;

export const basementValuePath = (slug?: string) => (slug ? `/data/basement-value/${slug}` : "/data/basement-value");

export const BASEMENT_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold and leased records from the MLS® VOW feed (comprehensive but not exhaustive). Medians and model estimates only. Build costs are typical GTA contractor figures, not quotes.";

export function getBasementData(): BasementValueFile {
  return raw as unknown as BasementValueFile;
}

export function basementCityBySlug(slug: string): BasementCity | null {
  return getBasementData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 2024" for a YYYY-MM-DD date. */
export function monthLabel(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
/** The last month inside an exclusive end date: "2026-11-01" → "Oct 2026". */
export function lastMonthLabel(exclusiveIso: string): string {
  const y = Number(exclusiveIso.slice(0, 4));
  const m = Number(exclusiveIso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
}

const signed = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;
const dollars = (n: number) => `$${(Math.round(n / 1000) * 1000).toLocaleString("en-CA")}`;
const money = (n: number) => `$${n.toLocaleString("en-CA")}`;

/** "+6.6%", or "+0.6%, not significant". */
export function pctLabel(e: Effect): string {
  return e.significant ? signed(e.pct) : `${signed(e.pct)}, not significant`;
}

/** "+6.6% (about $83,000)", or "+0.6%, not significant". */
export function gapText(e: Effect, medianPrice: number | null): string {
  if (!e.significant) return `${signed(e.pct)}, not significant`;
  return medianPrice ? `${signed(e.pct)} (about ${dollars((e.pct / 100) * medianPrice)})` : signed(e.pct);
}

/** Dollar value of a significant gap at the city median, else null. */
export function gapDollars(e: Effect | undefined, medianPrice: number | null): number | null {
  if (!e || !e.significant || !medianPrice) return null;
  return Math.round(((e.pct / 100) * medianPrice) / 1000) * 1000;
}

export interface BasementFacts {
  title: string;
  summary: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
  window: string;
  rentWindow: string;
  /** Measured values for the Dataset JSON-LD. */
  measures: { name: string; value: number; unitText: string }[];
}

export function buildBasementFacts(c: BasementCity, file: BasementValueFile): BasementFacts | null {
  const a = c.modelA;
  if (!a) return null;
  const b = c.modelB;
  const window = `${monthLabel(file.salesFrom)} to ${lastMonthLabel(file.salesTo)}`;
  const rentWindow = `${monthLabel(file.rentsFrom)} to ${lastMonthLabel(file.rentsTo)}`;
  const med = c.medianPrice;
  const fin = a.effects.fin;
  const apt = a.effects.apt;
  const sep = a.effects.sep;
  const finUsd = gapDollars(fin, med);
  const aptUsd = gapDollars(apt, med);

  const payback = (usd: number | null, cost: number) =>
    usd == null
      ? "No measurable gain at sale."
      : usd >= cost * 1.15
        ? `More than its typical cost of about ${money(cost)}.`
        : usd >= cost * 0.85
          ? `About its typical cost of ${money(cost)}.`
          : `Less than its typical cost of about ${money(cost)}.`;

  const facts: { id: string; text: string }[] = [
    {
      id: "fin",
      text: `A finished basement (no apartment): ${gapText(fin, med)} against a similar ${c.city} house without one. ${payback(finUsd, TYPICAL_COST.fin)}`,
    },
    {
      id: "apt",
      text: `A basement apartment: ${gapText(apt, med)}. ${payback(aptUsd, TYPICAL_COST.apt)}${
        a.aptMinusFin.significant
          ? ` That is ${Math.abs(a.aptMinusFin.pct).toFixed(1)} points ${a.aptMinusFin.pct > 0 ? "more" : "less"} than a plain finished basement.`
          : " The difference from a plain finished basement is not significant."
      }`,
    },
  ];
  if (b) {
    facts.push({
      id: "baths",
      text: `With the same number of bathrooms, a finished basement adds ${gapText(b.effects.fin, med)} and an apartment ${gapText(b.effects.apt, med)}. Each extra bathroom adds ${gapText(b.effects.baths, med)}: much of the basement gain is its bathroom.`,
    });
  }
  facts.push({
    id: "sep",
    text: `A separate entrance, on top of the same basement: ${gapText(sep, med)}.`,
  });
  const r2 = c.rent.twoBed;
  const r1 = c.rent.oneBed;
  if (r2 || r1) {
    const parts = [
      r2 ? `${money(r2.median)} a month for 2 bedrooms (${r2.leases.toLocaleString("en-CA")} leases)` : null,
      r1 ? `${money(r1.median)} for 1 bedroom (${r1.leases.toLocaleString("en-CA")} leases)` : null,
    ].filter(Boolean);
    facts.push({ id: "rent", text: `Basement units in ${c.city} leased for a median ${parts.join(" and ")}, ${rentWindow}.` });
  }

  const title = `Does a Finished Basement Add Value in ${c.city}?`;
  const summary =
    `In ${c.city}, a finished basement added ${gapText(fin, med)} and a basement apartment ${gapText(apt, med)} to the sale price of a similar house` +
    ` (${c.sales.toLocaleString("en-CA")} house sales, ${window}).`;

  const faqs = [
    {
      q: `Does a finished basement add value in ${c.city}?`,
      a: `${facts[0].text} Based on ${c.sales.toLocaleString("en-CA")} ${c.city} house sales, ${window}, each compared with similar houses in the same community.`,
    },
    { q: `Does a basement apartment add value in ${c.city}?`, a: facts[1].text },
    {
      q: `Is a separate entrance worth it in ${c.city}?`,
      a: sep.significant
        ? `${facts.find((f) => f.id === "sep")!.text} Typical cost: about ${money(TYPICAL_COST.sep)}.`
        : `At sale, a separate entrance added ${signed(sep.pct)} on top of the same basement, which is not significant. Its value is the rent it makes possible, not the sale price.`,
    },
  ];
  const rentFact = facts.find((f) => f.id === "rent");
  if (rentFact) faqs.push({ q: `How much does a basement apartment rent for in ${c.city}?`, a: rentFact.text });
  faqs.push({
    q: "How did PureProperty measure this?",
    a: `Each house sold in ${c.city} is compared only with similar houses: same community, home type, bedrooms above ground and size band. The model also controls for parking, lot width, "fully renovated" or fixer-upper words in the listing, and the quarter of the sale. A gap is "not significant" when its 95% range includes zero.`,
  });

  const measures = [
    { name: "Finished basement price gap", value: Math.round(fin.pct * 10) / 10, unitText: "percent" },
    { name: "Basement apartment price gap", value: Math.round(apt.pct * 10) / 10, unitText: "percent" },
    { name: "Separate entrance price gap", value: Math.round(sep.pct * 10) / 10, unitText: "percent" },
    ...(r2 ? [{ name: "Median 2-bedroom basement rent", value: r2.median, unitText: "CAD per month" }] : []),
  ];

  return { title, summary, facts, faqs, window, rentWindow, measures };
}

/** Cities with a model, ordered by the finished-basement gap, largest first. */
export function rankedCities(file: BasementValueFile): BasementCity[] {
  return file.cities.filter((c) => c.modelA).sort((x, y) => y.modelA!.effects.fin.pct - x.modelA!.effects.fin.pct);
}
