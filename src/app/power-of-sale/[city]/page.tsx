/**
 * /power-of-sale/{city} — "Power of Sale Homes in {City}" for the 15 board cities.
 * Today's power-of-sale homes (IDX), the city's power-of-sale share and how those homes
 * sold (pos_market_stats, migration 164), what a power of sale means, FAQ.
 * Hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import PowerOfSaleView, { powerOfSalePath } from "@/components/powerOfSale/PowerOfSaleView";
import { buildPosFacts, getPosStats } from "@/lib/data/powerOfSale";
import { powerOfSaleListings } from "@/lib/data/powerOfSaleListings";
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
  const [rows, { listings, totalFound }] = await Promise.all([getPosStats(), powerOfSaleListings(slug)]);
  return { city, listings, totalFound, facts: buildPosFacts(city, city.toLowerCase(), rows, totalFound) };
});

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  const canonical = `${SITE_URL}${powerOfSalePath(slug)}`;
  const title = `Power of Sale Homes in ${data.city}: ${data.totalFound.toLocaleString("en-CA")} For Sale Now`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: data.facts.summary.slice(0, 300),
    alternates: { canonical },
    openGraph: { title, description: data.facts.summary.slice(0, 300), url: canonical, siteName: "PureProperty", type: "website" },
  };
}

export default async function PowerOfSaleCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <PowerOfSaleView city={data.city} slug={slug} facts={data.facts} listings={data.listings} totalFound={data.totalFound} />;
}
