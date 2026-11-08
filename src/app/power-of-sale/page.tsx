/**
 * /power-of-sale — "Power of Sale Homes in Ontario": today's power-of-sale homes across
 * Ontario (IDX), the Ontario facts, and each board city's 12-month share with a link to its
 * page. Hourly revalidate.
 */
import type { Metadata } from "next";
import PowerOfSaleView from "@/components/powerOfSale/PowerOfSaleView";
import { buildPosFacts, getPosStats } from "@/lib/data/powerOfSale";
import { powerOfSaleListings } from "@/lib/data/powerOfSaleListings";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load() {
  const [rows, { listings, totalFound }] = await Promise.all([getPosStats(), powerOfSaleListings(null)]);
  const facts = buildPosFacts("Ontario", "ontario", rows, totalFound);
  const cityShares = OUTLOOK_CITIES.map((c) => {
    const f = buildPosFacts(c.city, c.city.toLowerCase(), rows, null);
    return { city: c.city, slug: c.slug, share: f.share, posSales: f.posSales };
  }).sort((a, b) => (b.share ?? -1) - (a.share ?? -1));
  return { facts, listings, totalFound, cityShares };
}

export async function generateMetadata(): Promise<Metadata> {
  const { facts, totalFound } = await load();
  const title = `Power of Sale Homes in Ontario: ${totalFound.toLocaleString("en-CA")} For Sale Now`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: facts.summary.slice(0, 300),
    alternates: { canonical: `${SITE_URL}/power-of-sale` },
    openGraph: { title, description: facts.summary.slice(0, 300), url: `${SITE_URL}/power-of-sale`, siteName: "PureProperty", type: "website" },
  };
}

export default async function PowerOfSaleOntarioPage() {
  const { facts, listings, totalFound, cityShares } = await load();
  return <PowerOfSaleView city={null} slug={null} facts={facts} listings={listings} totalFound={totalFound} cityShares={cityShares} />;
}
