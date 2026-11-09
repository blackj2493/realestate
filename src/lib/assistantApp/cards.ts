/**
 * The assistant app's answers ("cards"). Each tool returns one card: dated, sourced
 * sentences from the same builders as the public pages, a link to that page, and the
 * second-opinion link. The card is both the widget's data (structuredContent) and, as
 * plain text, what the assistant reads.
 *
 * COMPLIANCE. Aggregates only: totals, medians and shares for a city or a neighbourhood.
 * No listing records, no single-home prices, no address, no value for one home. Every
 * input is a place name; nothing personal is asked for or kept.
 */
import { getMarketBoard } from "@/lib/data/marketBoard";
import { boardRowFor, SOURCE_LINE } from "@/lib/data/cityFacts";
import { buildOutlook } from "@/lib/data/marketOutlook";
import { outlookPath } from "@/lib/data/outlookCities";
import { buildCommunityFacts, type CommunityFactsRow } from "@/lib/data/communityFacts";
import { buildNotSellingFacts, getOutcomeStats } from "@/lib/data/notSelling";
import { buildPosFacts, getPosStats } from "@/lib/data/powerOfSale";
import { homeValuePath } from "@/lib/homeValue/content";
import { cityDisplayName, cityHubSlug, slugify } from "@/lib/listings/listingPath";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { appLink, coverageSentence, isProvince, resolveCity } from "./resolve";

export type ToolName = "market_facts" | "neighbourhood_facts" | "not_selling_facts" | "power_of_sale_facts" | "price_opinion_link";

export interface CardBar {
  label: string;
  value: number;
  /** The value as text, written next to the bar. */
  display: string;
  /** "a" = the main series, "b" = the comparison series. */
  tone: "a" | "b";
}

export interface AppCard {
  tool: ToolName;
  title: string;
  place: string;
  /** "November 8, 2026", or null when the data has no date. */
  updated: string | null;
  facts: string[];
  chart: { title: string; bars: CardBar[] } | null;
  /** A short caution, for example "these show what unsold homes had in common". */
  note: string | null;
  page: { url: string; label: string } | null;
  cta: { url: string; label: string };
  source: string;
}

const CTA_LABEL = "Get a free second opinion on a specific home";
const POS_SOURCE =
  "Source: PureProperty analysis of MLS® sales from the MLS® VOW feed. A sale counts as power of sale when the listing says so. Totals and shares only, refreshed nightly.";

function cta(slug: string | null, tool: ToolName) {
  return { url: appLink(homeValuePath(slug ?? undefined), tool), label: CTA_LABEL };
}

/** The reply when the place is not one of the 15 board cities. */
function notCovered(tool: ToolName, asked: string | null, pagePath: string | null, pageLabel: string): AppCard {
  return {
    tool,
    title: asked ? `No PureProperty data for ${asked}` : "Which city?",
    place: asked ?? "Ontario",
    updated: null,
    facts: [coverageSentence()],
    chart: null,
    note: "Ask about one of these cities by name.",
    page: pagePath ? { url: appLink(pagePath, tool), label: pageLabel } : null,
    cta: cta(null, tool),
    source: SOURCE_LINE,
  };
}

const shortMonth = (label: string) => label.slice(0, 3);
const shortUsd = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000)}K`);

/** "Is the Markham market cooling?" — price and sales against a year earlier, and more. */
export async function marketFacts(cityText: string): Promise<AppCard> {
  const tool: ToolName = "market_facts";
  const hit = resolveCity(cityText);
  if (!hit) return notCovered(tool, isProvince(cityText) ? null : cityText, "/data/housing-market", "Housing market data by city");
  const board = await getMarketBoard();
  const o = buildOutlook(hit.city, boardRowFor(board.rows, hit.city), board.dataAsOf);
  if (!o) return notCovered(tool, hit.city, outlookPath(hit.slug), `${hit.city} housing market`);
  const facts = [...o.facts.map((f) => f.text)];
  if (o.typeText) facts.push(o.typeText);
  const last12 = o.series.slice(-12);
  return {
    tool,
    title: `${hit.city} housing market now`,
    place: hit.city,
    updated: o.updatedLabel,
    facts,
    chart:
      last12.length >= 6
        ? {
            title: "Median sale price by month",
            bars: last12.map((r) => ({ label: shortMonth(r.label), value: r.medianPrice, display: shortUsd(r.medianPrice), tone: "a" as const })),
          }
        : null,
    note: "PureProperty does not forecast prices. These are the measures a forecast starts from.",
    page: { url: appLink(outlookPath(hit.slug), tool), label: `${hit.city} housing market, month by month` },
    cta: cta(hit.slug, tool),
    source: SOURCE_LINE,
  };
}

/** Community rows whose name matches the neighbourhood, optionally inside one city. */
async function communityRows(hoodSlug: string, citySlug: string | null): Promise<CommunityFactsRow[]> {
  // ilike on a loose pattern ("Cornell" → "%cornell%"), then an exact slug match in JS.
  const pattern = `%${hoodSlug.replace(/-/g, "%")}%`;
  const { data, error } = await getServiceRoleClient()
    .from("community_market_facts")
    .select("*")
    .ilike("city_region", pattern)
    .order("sales_12m", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return ((data ?? []) as CommunityFactsRow[]).filter(
    (r) => slugify(r.city_region) === hoodSlug && (citySlug == null || cityHubSlug(r.city) === citySlug)
  );
}

/** "How fast do homes sell in Cornell, Markham?" */
export async function neighbourhoodFacts(neighbourhood: string, cityText: string | null): Promise<AppCard> {
  const tool: ToolName = "neighbourhood_facts";
  const hoodSlug = slugify(neighbourhood);
  const cityHit = cityText ? resolveCity(cityText) : null;
  const citySlug = cityHit?.slug ?? (cityText && !isProvince(cityText) ? slugify(cityText) : null);
  let rows: CommunityFactsRow[] = [];
  if (hoodSlug) {
    try {
      rows = await communityRows(hoodSlug, citySlug);
    } catch (err) {
      console.error("[assistantApp] community lookup failed:", err);
    }
  }
  const row = rows[0] ?? null;
  const city = row ? cityDisplayName(row.city) : cityHit?.city ?? null;
  const facts = row ? buildCommunityFacts(row.city_region, city as string, row) : null;
  if (!row || !facts || facts.facts.length === 0) {
    return {
      tool,
      title: `Not enough data for ${neighbourhood}${city ? `, ${city}` : ""}`,
      place: neighbourhood,
      updated: null,
      facts: [
        `PureProperty has no neighbourhood figures for ${neighbourhood}${city ? ` in ${city}` : ""}. A neighbourhood needs at least 30 sales in 12 months, and the name must match the MLS® community name.`,
      ],
      chart: null,
      note: cityHit ? `City-wide figures for ${cityHit.city} are available.` : null,
      page: cityHit ? { url: appLink(outlookPath(cityHit.slug), tool), label: `${cityHit.city} housing market` } : null,
      cta: cta(cityHit?.slug ?? null, tool),
      source: SOURCE_LINE,
    };
  }
  const hubCity = cityHubSlug(row.city);
  const homeSlug = resolveCity(city)?.slug ?? null;
  return {
    tool,
    title: `${row.city_region}, ${city}: how homes sell`,
    place: `${row.city_region}, ${city}`,
    updated: facts.updatedLabel,
    facts: facts.facts.map((f) => f.text),
    chart: null,
    note: rows.length > 1 && !cityText ? `More than one city has a community with this name. This answer is for ${city}.` : null,
    page: { url: appLink(`/property/on/${hubCity}/${slugify(row.city_region)}`, tool), label: `${row.city_region} homes and market facts` },
    cta: cta(homeSlug, tool),
    source: SOURCE_LINE,
  };
}

/** "Why is my house not selling in Brampton?" — sold vs came off the market unsold. */
export async function notSellingFacts(cityText: string | null): Promise<AppCard> {
  const tool: ToolName = "not_selling_facts";
  const hit = resolveCity(cityText);
  if (!hit && !isProvince(cityText)) return notCovered(tool, cityText, "/house-not-selling", "Why homes do not sell in Ontario");
  const place = hit?.city ?? "Ontario";
  const region = hit ? hit.city.toLowerCase() : "ontario";
  const f = buildNotSellingFacts(place, region, await getOutcomeStats());
  const ch = f.chart;
  const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(0)}%`;
  return {
    tool,
    title: `Why homes do not sell in ${place}`,
    place,
    updated: f.updatedLabel,
    facts: f.facts.map((x) => x.text),
    chart: ch
      ? {
          title: `Median asking price compared with similar homes that sold${ch.basis !== place ? ` (${ch.basis})` : ""}`,
          bars: [
            { label: "Did not sell", value: ch.unsoldGap, display: pct(ch.unsoldGap), tone: "b" },
            { label: "Sold", value: ch.soldGap, display: pct(ch.soldGap), tone: "a" },
          ],
        }
      : null,
    note: "Similar homes share the neighbourhood, type and bedrooms. The numbers show what unsold homes had in common, not why each one did not sell.",
    page: { url: appLink(hit ? `/house-not-selling/${hit.slug}` : "/house-not-selling", tool), label: `House not selling in ${place}` },
    cta: cta(hit?.slug ?? null, tool),
    source: SOURCE_LINE,
  };
}

/** "Are there more power-of-sale homes in Brampton now?" — 12-month share and change. */
export async function powerOfSaleFacts(cityText: string | null): Promise<AppCard> {
  const tool: ToolName = "power_of_sale_facts";
  const hit = resolveCity(cityText);
  if (!hit && !isProvince(cityText)) return notCovered(tool, cityText, "/power-of-sale", "Power of sale in Ontario");
  const place = hit?.city ?? "Ontario";
  // activeNow = null: the app shows no listing data, so no "N homes for sale now" count.
  const f = buildPosFacts(place, hit ? hit.city.toLowerCase() : "ontario", await getPosStats(), null);
  return {
    tool,
    title: `Power of sale in ${place}`,
    place,
    updated: f.updatedLabel,
    facts: f.facts.map((x) => x.text),
    chart: null,
    note: "A power of sale is a sale by the lender after the owner falls behind on the mortgage.",
    page: { url: appLink(hit ? `/power-of-sale/${hit.slug}` : "/power-of-sale", tool), label: `Power of sale in ${place}` },
    cta: cta(hit?.slug ?? null, tool),
    source: POS_SOURCE,
  };
}

/** "What is my home worth?" — never a number; the link to a written opinion by a person. */
export function priceOpinionLink(cityText: string | null): AppCard {
  const tool: ToolName = "price_opinion_link";
  const hit = resolveCity(cityText);
  const place = hit?.city ?? "Ontario";
  return {
    tool,
    title: `A second opinion on a home in ${place}`,
    place,
    updated: null,
    facts: [
      "A licensed Ontario REALTOR® at PureProperty reads the recent sales of similar homes and writes a price opinion for one home.",
      "It is free. The reply usually comes the same day, by email.",
      "The request form is on the PureProperty website. This app does not ask for an address or an email.",
    ],
    chart: null,
    note: "This app does not give a value for one home. A price needs the home's details and a person who checks them.",
    page: null,
    cta: cta(hit?.slug ?? null, tool),
    source: "PureProperty is operated by a licensed Ontario REALTOR®. See pureproperty.ca/operated-by.",
  };
}

/** The card as plain text for the assistant: facts, caution, source and the two links. */
export function cardText(c: AppCard): string {
  const lines = [c.title + (c.updated ? ` (data as of ${c.updated})` : ""), ...c.facts.map((f) => `- ${f}`)];
  if (c.note) lines.push(`Note: ${c.note}`);
  lines.push(c.source);
  if (c.page) lines.push(`More: ${c.page.label}: ${c.page.url}`);
  lines.push(`${c.cta.label}: ${c.cta.url}`);
  return lines.join("\n");
}
