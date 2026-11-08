/**
 * /house-not-selling — "Why Is My House Not Selling in Ontario?": homes that sold vs homes
 * that came off the market unsold (listing_outcome_stats, migration 165), the asking-price
 * gap, three checks, the second-opinion form, and each board city's unsold share.
 * Hourly revalidate.
 */
import type { Metadata } from "next";
import NotSellingView from "@/components/notSelling/NotSellingView";
import { buildNotSellingFacts, getOutcomeStats } from "@/lib/data/notSelling";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load() {
  const rows = await getOutcomeStats();
  const facts = buildNotSellingFacts("Ontario", "ontario", rows);
  const cityRows = OUTLOOK_CITIES.map((c) => {
    const f = buildNotSellingFacts(c.city, c.city.toLowerCase(), rows);
    return { city: c.city, slug: c.slug, unsoldShare: f.unsoldShare, unsold: f.unsold };
  }).sort((a, b) => (b.unsoldShare ?? -1) - (a.unsoldShare ?? -1));
  return { facts, cityRows };
}

export async function generateMetadata(): Promise<Metadata> {
  const { facts } = await load();
  const title = "Why Is My House Not Selling in Ontario? What the Sales Data Shows";
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: facts.summary.slice(0, 300),
    alternates: { canonical: `${SITE_URL}/house-not-selling` },
    openGraph: { title, description: facts.summary.slice(0, 300), url: `${SITE_URL}/house-not-selling`, siteName: "PureProperty", type: "website" },
  };
}

export default async function NotSellingOntarioPage() {
  const { facts, cityRows } = await load();
  return <NotSellingView city={null} slug={null} facts={facts} cityRows={cityRows} />;
}
