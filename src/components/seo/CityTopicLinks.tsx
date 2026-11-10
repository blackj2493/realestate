/**
 * "More about {city}" — links from any city-level page to that city's four question pages
 * (and its homes-for-sale hub). Renders nothing for a city outside the covered set. Plain
 * server-rendered links, so crawlers that do not run JavaScript follow them.
 */
import Link from "next/link";
import { CITY_TOPICS, topicCity, type CityTopic } from "@/lib/seo/cityTopics";

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
  const links = CITY_TOPICS.filter((t) => t.id !== current).map((t) => ({ href: t.path(c.slug), label: t.label(c.city) }));
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
