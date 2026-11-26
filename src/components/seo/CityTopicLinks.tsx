/**
 * "More about {city}" — links from any city-level page to that city's four question pages
 * (and its homes-for-sale hub). Renders nothing for a city outside the covered set. Plain
 * server-rendered links, so crawlers that do not run JavaScript follow them.
 */
import Link from "next/link";
import { BOARD_ONLY_TOPICS, CITY_TOPICS, topicCity, type CityTopic } from "@/lib/seo/cityTopics";
import { basementCityBySlug } from "@/lib/data/basementValue";
import { priceChangeAreaBySlug } from "@/lib/data/priceChange";
import { condoAreaBySlug } from "@/lib/data/condoPrices";
import { taxAreaBySlug } from "@/lib/data/propertyTax";
import { schoolCityBySlug } from "@/lib/data/schoolPrices";
import { soldCityBySlug } from "@/lib/data/soldPrices";
import { bestTimeCityBySlug } from "@/lib/data/bestTimeToSell";
import { cityMarketBySlug } from "@/lib/data/cityMarkets";

export default function CityTopicLinks({
  citySlug,
  current,
  showCityHub = true,
  className = "mt-8",
}: {
  citySlug: string;
  /** The page the reader is on; its link is left out. */
  current?: CityTopic;
  /** Also link /property/on/{slug} (off on the city hub itself). */
  showCityHub?: boolean;
  className?: string;
}) {
  const c = topicCity(citySlug);
  if (!c) return null;
  // The extra study cities have no live board pages (power of sale, not selling, ...); their
  // market, days-on-market, good-time-to-buy, rent-vs-buy and home-value pages read data/city-markets.json.
  // The basement study publishes a city only when it has enough sales in each group, so its
  // link follows the data file rather than the city list (a dropped city would 404).
  const links = CITY_TOPICS.filter((t) => t.id !== current && (c.board || !BOARD_ONLY_TOPICS.has(t.id)) && (!["market", "days-on-market", "good-time-to-buy", "rent-vs-buy", "home-value"].includes(t.id) || c.board || cityMarketBySlug(c.slug)) && (t.id !== "basement-value" || basementCityBySlug(c.slug)?.modelA) && (t.id !== "price-change" || priceChangeAreaBySlug(c.slug)?.all) && (t.id !== "condo-prices" || condoAreaBySlug(c.slug)) && (t.id !== "property-tax" || taxAreaBySlug(c.slug)) && (t.id !== "school-catchment-prices" || schoolCityBySlug(c.slug)) && (t.id !== "sold-prices" || soldCityBySlug(c.slug)) && (t.id !== "best-time-to-sell" || bestTimeCityBySlug(c.slug))).map((t) => ({ href: t.path(c.slug), label: t.label(c.city) }));
  if (showCityHub) links.push({ href: `/property/on/${c.slug}`, label: `Homes for sale and neighbourhoods in ${c.city}` });
  const headingId = `more-${c.slug}`;
  return (
    <section className={className} aria-labelledby={headingId}>
      <h2 id={headingId} className="text-sm font-semibold text-muted-foreground">
        More about {c.city}
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="underline hover:text-foreground">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
