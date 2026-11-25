/**
 * /home-value/{city} — "How much is my house worth in {City}?" for the 15 board cities and
 * the extra study cities (their facts from data/city-markets.json, built weekly).
 * The request form, the city's market facts (public aggregates), how a price is worked
 * out, and FAQ answers. No per-home valuation is rendered (see src/lib/homeValue/content.ts).
 * Static per city, hourly revalidate; unknown slugs 404.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import HomeValueView from "@/components/homeValue/HomeValueView";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { boardRowFor, buildCityFacts } from "@/lib/data/cityFacts";
import { cityMarketBySlug, getCityMarkets, toMarketRow } from "@/lib/data/cityMarkets";
import { HOME_VALUE_CITIES, homeValueCityBySlug, homeValuePath } from "@/lib/homeValue/content";
import { titleYear } from "@/lib/seo/titleYear";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return HOME_VALUE_CITIES.map((c) => ({ city: c.slug }));
}

const load = cache(async (slug: string) => {
  const city = homeValueCityBySlug(slug);
  if (!city) return null;
  const extra = cityMarketBySlug(slug);
  if (extra) return { city, weekly: true, facts: buildCityFacts(city, toMarketRow(extra), getCityMarkets().generatedAt) };
  try {
    const board = await getMarketBoard();
    return { city, weekly: false, facts: buildCityFacts(city, boardRowFor(board.rows, city), board.dataAsOf) };
  } catch (err) {
    console.error(`[home-value] board read failed for ${slug}:`, err);
    return { city, weekly: false, facts: null };
  }
});

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) return {};
  const { city } = data;
  const canonical = `${SITE_URL}${homeValuePath(slug)}`;
  const title = `How Much Is My House Worth in ${city}? (${titleYear()}) Free Price Opinion`;
  const description = `Get a free written price opinion for your ${city} home, based on real ${city} sales and checked by a person. A range with the reasons, by email. No calls unless you ask.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: "PureProperty", type: "website" },
  };
}

export default async function HomeValueCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  return <HomeValueView city={data.city} slug={slug} facts={data.facts} weekly={data.weekly} canonical={`${SITE_URL}${homeValuePath(slug)}`} />;
}
