/**
 * /power-of-sale/{city} — "Power of Sale Homes in {City}": the 15 board cities, plus any
 * other city with MIN_POS_CITY+ power-of-sale homes for sale now (posCityHubs). A city
 * without sold-data rows shows its listings and the Ontario figures only (buildPosFacts).
 * Today's power-of-sale homes (IDX), the city's power-of-sale share and how those homes
 * sold (pos_market_stats, migration 164), what a power of sale means, FAQ.
 * Hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import PowerOfSaleView, { powerOfSalePath } from "@/components/powerOfSale/PowerOfSaleView";
import { buildPosFacts, getPosStats } from "@/lib/data/powerOfSale";
import { MIN_POS_CITY, posCityHubs, powerOfSaleListings } from "@/lib/data/powerOfSaleListings";
import { citiesForHubSlug } from "@/lib/listings/cityHubs";
import { deslugCity } from "@/lib/listings/listingPath";
import { OUTLOOK_CITIES, outlookCityBySlug } from "@/lib/data/outlookCities";
import { titleYear } from "@/lib/seo/titleYear";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateStaticParams() {
  const extra = (await posCityHubs()).filter((h) => !outlookCityBySlug(h.slug));
  return [...OUTLOOK_CITIES.map((c) => ({ city: c.slug })), ...extra.map((h) => ({ city: h.slug }))];
}

const load = cache(async (slug: string) => {
  const board = outlookCityBySlug(slug);
  let city = board;
  if (!city) {
    // Outside the 15: a real city hub, named by its feed City value when it has one.
    const { cities } = await citiesForHubSlug(slug);
    if (cities.length === 0) return null;
    city = cities.length === 1 ? cities[0] : deslugCity(slug);
  }
  const [rows, { listings, totalFound }] = await Promise.all([getPosStats(), powerOfSaleListings(slug)]);
  // A non-board city page exists only while it has homes to show.
  if (!board && totalFound === 0) return null;
  return { city, board: Boolean(board), listings, totalFound, facts: buildPosFacts(city, city.toLowerCase(), rows, totalFound) };
});

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  const canonical = `${SITE_URL}${powerOfSalePath(slug)}`;
  const title = `Power of Sale Homes in ${data.city} (${titleYear()}): ${data.totalFound.toLocaleString("en-CA")} For Sale Now`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(data.facts.summary.slice(0, 300)),
    alternates: { canonical },
    // Thin non-board pages are not indexed (same floor as the city hubs).
    robots: data.board || data.totalFound >= MIN_POS_CITY ? undefined : { index: false, follow: true },
    openGraph: { title, description: metaDescription(data.facts.summary), url: canonical, siteName: "PureProperty", type: "website" },
  };
}

export default async function PowerOfSaleCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const moreCities = (await posCityHubs()).filter((h) => !outlookCityBySlug(h.slug));
  return <PowerOfSaleView city={data.city} slug={slug} facts={data.facts} listings={data.listings} totalFound={data.totalFound} moreCities={moreCities} />;
}
