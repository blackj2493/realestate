/**
 * /llms.txt — a curated, LLM-friendly map of the site (emerging llmstxt.org convention).
 * Concise on purpose: it points AI assistants at the high-value entry points and explains
 * the unique, citable data, rather than dumping all 47k URLs (that's what sitemap.xml is
 * for). Static content + daily revalidate; no DB/Typesense calls so it can't fail or stall.
 */
export const revalidate = 86400;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export function GET() {
  const body = `# PureProperty

> PureProperty is an Ontario (Canada) real estate platform showing every active MLS® listing with proprietary intelligence the major consumer portals don't provide: estimated cap rate, school ratings, walkability, and development potential. Built for serious buyers and investors.

## Browse listings by city
- [Homes for sale by city in Ontario](${SITE_URL}/property): directory of every Ontario city with active listings; each city links to its neighbourhoods and analytics views.
- [Homes for sale in Toronto](${SITE_URL}/property/on/toronto)
- [Homes for sale in Mississauga](${SITE_URL}/property/on/mississauga)
- [Homes for sale in Hamilton](${SITE_URL}/property/on/hamilton)

## Investment & development hubs (unique data)
- [Highest cap-rate homes in Toronto](${SITE_URL}/investments/toronto/highest-cap-rate): active listings ranked by estimated cap rate for cash-flow investors.
- [Development-potential homes in Mississauga](${SITE_URL}/investments/mississauga/development-potential): properties flagged as prime multi-unit / surplus-parking lot candidates, ranked by lot size.

## Family & lifestyle hubs (unique data)
- [Homes near top-rated schools in Toronto](${SITE_URL}/family/toronto/top-rated-schools): listings ranked by the rating of nearby schools (PureProperty School Score, from EQAO / Government of Ontario data).
- [Most walkable homes in Toronto](${SITE_URL}/lifestyle/toronto/most-walkable): listings ranked by walking distance to grocery stores.
- [New construction homes in Toronto](${SITE_URL}/lifestyle/toronto/new-construction): new-build and recently built (≤5 year) homes.

## About the data
- Listings are active MLS® IDX inventory across the Greater Toronto Area and surrounding Ontario, refreshed daily. Listing information is deemed reliable but is not guaranteed.
- School scores: the PureProperty School Score (0–10) is derived from EQAO data published by the Government of Ontario (OGL-Ontario). Proximity is straight-line and is not a guaranteed catchment.
- Walkability: straight-line distance to amenities from Overture Maps / OpenStreetMap.
- Cap rate and development analysis are PureProperty estimates; per-property figures require a free sign-in.

## Full index
- [Sitemap](${SITE_URL}/sitemap.xml): the complete list of pages.
`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
