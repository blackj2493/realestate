/**
 * /house-not-selling/{city} — "Why Is My House Not Selling in {City}?" for the 15 board
 * cities. listing_outcome_stats (migration 165): the city's unsold share and days on market;
 * the asking-price comparison uses the city at 100+ unsold homes, else Ontario (and says
 * so). Hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import NotSellingView, { notSellingPath } from "@/components/notSelling/NotSellingView";
import { buildNotSellingFacts, getOutcomeStats } from "@/lib/data/notSelling";
import { OUTLOOK_CITIES, outlookCityBySlug } from "@/lib/data/outlookCities";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return OUTLOOK_CITIES.map((c) => ({ city: c.slug }));
}

const load = cache(async (slug: string) => {
  const city = outlookCityBySlug(slug);
  if (!city) return null;
  const rows = await getOutcomeStats();
  return { city, facts: buildNotSellingFacts(city, city.toLowerCase(), rows) };
});

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  const canonical = `${SITE_URL}${notSellingPath(slug)}`;
  const title = `Why Is My House Not Selling in ${data.city}? What the Sales Data Shows`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: data.facts.summary.slice(0, 300),
    alternates: { canonical },
    openGraph: { title, description: data.facts.summary.slice(0, 300), url: canonical, siteName: "PureProperty", type: "website" },
  };
}

export default async function NotSellingCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <NotSellingView city={data.city} slug={slug} facts={data.facts} />;
}
