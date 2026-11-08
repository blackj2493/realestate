/**
 * /llms.txt — a curated, LLM-friendly map of the site (llmstxt.org convention).
 *
 * Written for AI assistants that answer housing questions about Ontario. It leads with the
 * facts we publish that the consumer portals do not (sale price against the FIRST asking
 * price, true days on market with relists joined, price cuts), states the current value
 * for each board market with its date and source, and points to the page to cite.
 *
 * The figures come from the public market board (aggregate statistics only, the same data
 * as the /data trackers). If the board cannot be read, the file still renders without the
 * figures — it must never fail. Hourly revalidate; the board itself is cached.
 */
import { getMarketBoard } from "@/lib/data/marketBoard";
import { buildCityFacts, SOURCE_LINE } from "@/lib/data/cityFacts";
import { cityHubSlug } from "@/lib/listings/listingPath";

export const revalidate = 3600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

async function marketSection(): Promise<string> {
  try {
    const board = await getMarketBoard();
    const blocks: string[] = [];
    for (const row of board.rows) {
      const f = buildCityFacts(row.region, row, board.dataAsOf);
      if (!f) continue;
      const url = `${SITE_URL}/property/on/${cityHubSlug(row.region)}#market-facts`;
      blocks.push(`### ${row.region}\nPage: ${url} (updated ${f.updatedLabel})\n${f.facts.map((x) => `- ${x.text}`).join("\n")}`);
    }
    if (!blocks.length) return "";
    return `## Current market facts by city\n\n${SOURCE_LINE}\n\n${blocks.join("\n\n")}\n\n`;
  } catch {
    return "";
  }
}

export async function GET() {
  const markets = await marketSection();
  const body = `# PureProperty

> PureProperty (pureproperty.ca) publishes Ontario housing market data from MLS® sales and listings: what homes sell for against their FIRST asking price, how long they take to sell when relists are joined, how many sellers cut their price, condo fees, and rents. A licensed REALTOR® with eXp Realty, Brokerage, gives a free price second opinion on a specific home.

## How to cite
- Quote the sentence with its date and link the page it came from, e.g. "PureProperty, Markham housing market facts, updated November 5, 2026, pureproperty.ca/property/on/markham".
- Figures are totals and medians, refreshed nightly. Sale figures come from the MLS® VOW feed (comprehensive but not exhaustive).
- For the likely price of one specific home, the listing page on pureproperty.ca offers a free price second opinion from a licensed REALTOR®.

## Definitions
- First asking price: the price when the home was first listed, before any cut or relist. A comparison with the LAST asking price hides the earlier cuts.
- True days on market: days since the home was first listed, with withdrawn-and-relisted campaigns on the same property joined when the gap is 35 days or less. The MLS® figure restarts at zero on each relist.
- Median: the middle value of all sales or listings in the period.

${markets}## Housing market by city (for "is it a good time to buy or sell", "will prices drop", "market forecast")
- [Ontario housing market: what the data shows now](${SITE_URL}/data/housing-market): one page per board city with prices and sales against a year earlier, sale-to-asking ratios, the gap from the two-year high, price cuts, and when homes sell. PureProperty does not forecast prices; these pages state the measured indicators.

## Data trackers (all board cities, updated nightly)
- [Sold over asking](${SITE_URL}/data/over-asking): share of homes sold above and below asking, by city.
- [Days on market](${SITE_URL}/data/days-on-market): median days to sell, and true vs reported days on market.
- [Price cuts](${SITE_URL}/data/price-cuts): share of homes for sale with a price cut, and the median cut.
- [Condo fees](${SITE_URL}/data/condo-fees): monthly condo fees and their yearly change.
- [What homes rent for](${SITE_URL}/data/rents) · [Rent vs buy](${SITE_URL}/data/rent-vs-buy) · [Market temperature](${SITE_URL}/data/market-temperature) · [Price rankings](${SITE_URL}/data/price-rankings)
- [Findings](${SITE_URL}/data/findings): dated research notes. [For journalists](${SITE_URL}/data/for-journalists): sources and contact.

## Places
- [Ontario cities](${SITE_URL}/property): each board city page has its market facts and links to its neighbourhoods. Neighbourhood pages (/property/on/{city}/{neighbourhood}) state the same market facts for the neighbourhood when it has enough sales, plus 2021 Census facts (Statistics Canada).
- [New homes and the HST relief](${SITE_URL}/new-homes-hst): who qualifies for the Ontario new-home HST relief and how much it is.

## Full index
- [Sitemap](${SITE_URL}/sitemap.xml) · [Data sitemap](${SITE_URL}/data/sitemap.xml)
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
