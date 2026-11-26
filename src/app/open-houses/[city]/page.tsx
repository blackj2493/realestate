/**
 * /open-houses/{city} — "open houses {city}" / "open houses {city} this weekend": the public open
 * houses on homes for sale in the next 7 days, grouped by day, soonest first, as the same IDX
 * cards as the city hub (src/lib/openHouses/openHouses.ts). Refreshed hourly from a table the
 * sync fills every 6 hours. One stable URL per city: the page changes every day, the URL never.
 *
 * Any city hub slug works (citiesForHubSlug); the 34 study cities are built ahead and listed in
 * the sitemap. Thin pages (under 3 homes) are not indexed.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { CalendarDays } from "lucide-react";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import { citiesForHubSlug } from "@/lib/listings/cityHubs";
import { deslugCity } from "@/lib/listings/listingPath";
import { STUDY_CITIES, studyCityBySlug } from "@/lib/data/studyCities";
import { WINDOW_DAYS, dayLabel, getCityOpenHouses, openHouseWindow, openHousesPath, timeLabel } from "@/lib/openHouses/openHouses";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = true;
const MIN_INDEXABLE = 3;

export function generateStaticParams() {
  return STUDY_CITIES.map((c) => ({ city: c.slug }));
}

const load = cache(async (slug: string) => {
  const { cities } = await citiesForHubSlug(slug);
  if (cities.length === 0) return null;
  const name = studyCityBySlug(slug)?.city ?? (cities.length === 1 ? cities[0] : deslugCity(slug));
  const { listings, total } = await getCityOpenHouses(cities);
  const weekend = listings.filter((l) => l.slots.some((s) => [0, 6].includes(new Date(`${s.date}T12:00:00Z`).getUTCDay()))).length;
  return { name, listings, total, weekend };
});

function summaryOf(name: string, total: number, weekend: number): string {
  if (total === 0) return `No public open houses are listed in ${name} for the next ${WINDOW_DAYS} days yet. Agents add most weekend open houses from Wednesday on.`;
  return `${total.toLocaleString("en-CA")} homes for sale in ${name} have a public open house in the next ${WINDOW_DAYS} days${
    weekend ? `, ${weekend.toLocaleString("en-CA")} of them this weekend` : ""
  }. Times, prices and photos from the MLS®, refreshed through the day.`;
}

export async function generateMetadata({ params }: { params: Promise<{ city: string }> }): Promise<Metadata> {
  const { city: slug } = await params;
  const d = await load(slug);
  if (!d) return {};
  const canonical = `${SITE_URL}${openHousesPath(slug)}`;
  const title = `Open Houses in ${d.name} This Week${d.total ? `: ${d.total.toLocaleString("en-CA")} Homes` : ""}`;
  const description = summaryOf(d.name, d.total, d.weekend);
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(description),
    alternates: { canonical },
    robots: d.total >= MIN_INDEXABLE ? undefined : { index: false, follow: true },
    openGraph: {
      title,
      description: metaDescription(description),
      url: canonical,
      siteName: "PureProperty",
      type: "website",
      images: [ogImageUrl({ eyebrow: "Open houses", title: `Open houses in ${d.name}`, subtitle: "This week, from the MLS®." })],
    },
  };
}

export default async function OpenHousesCityPage({ params }: { params: Promise<{ city: string }> }) {
  const { city: slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const { from, to } = openHouseWindow();
  const days = [...new Set(d.listings.flatMap((l) => l.slots.map((s) => s.date)))].filter((x) => x >= from && x <= to).sort();
  const canonical = `${SITE_URL}${openHousesPath(slug)}`;
  const cityHubPath = `/property/on/${slug}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Open houses", item: `${SITE_URL}${openHousesPath()}` },
      { "@type": "ListItem", position: 3, name: d.name, item: canonical },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[1400px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href={openHousesPath()} className="hover:text-foreground">Open houses</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">{d.name}</span>
        </nav>

        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
            <CalendarDays className="h-6 w-6 text-teal-700 dark:text-teal-400" />
            Open Houses in {d.name} This Week
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{summaryOf(d.name, d.total, d.weekend)}</p>
          {d.total > d.listings.length && (
            <p className="mt-1 text-xs text-muted-foreground">
              Showing the next {d.listings.length} homes, soonest first. <Link href={cityHubPath} className="underline">See all homes for sale in {d.name}</Link>.
            </p>
          )}
        </header>

        {days.length === 0 ? (
          <div className="rounded-lg border border-border bg-card/40 p-8 text-center text-muted-foreground">
            <p>No public open houses listed yet.</p>
            <Link href={cityHubPath} className="mt-3 inline-block text-sm underline">See all homes for sale in {d.name} →</Link>
          </div>
        ) : (
          days.map((day) => {
            const onDay = d.listings.filter((l) => l.slots.some((s) => s.date === day));
            return (
              <section key={day} className="mb-10" aria-labelledby={`d-${day}`}>
                <h2 id={`d-${day}`} className="mb-3 text-lg font-semibold">
                  {dayLabel(day)} <span className="text-sm font-normal text-muted-foreground">· {onDay.length} {onDay.length === 1 ? "home" : "homes"}</span>
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {onDay.map(({ doc, slots }) => {
                    const s = slots.find((x) => x.date === day)!;
                    return (
                      <div key={`${day}-${doc.id}`}>
                        <p className="mb-1.5 text-sm font-medium text-teal-800 dark:text-teal-300">
                          {timeLabel(s) || "Time to be confirmed"}
                          {s.virtual ? " · virtual" : ""}
                        </p>
                        <PropertyCard property={toCardData(doc)} showSaveButton={false} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}

        <div className="mx-auto max-w-3xl">
          <HubFaq
            faqs={[
              {
                q: `Are there open houses in ${d.name} this weekend?`,
                a: d.weekend
                  ? `Yes. ${d.weekend.toLocaleString("en-CA")} homes for sale in ${d.name} have a public open house this weekend, and ${d.total.toLocaleString("en-CA")} in the next ${WINDOW_DAYS} days. This page lists them by day with the times.`
                  : `None are listed for this weekend yet. Agents add most weekend open houses from Wednesday on; this page updates through the day.`,
              },
              {
                q: "Do I need to book an open house?",
                a: "No. A public open house is open to anyone during the listed time. Bring photo ID; some agents ask visitors to sign in. To see a home at another time, book a private showing.",
              },
              { q: "How current are these times?", a: "The list is read from the MLS® every 6 hours and the page refreshes every hour. Agents sometimes cancel or move an open house, so check the listing before you go." },
            ]}
            heading={`Open houses in ${d.name}: common questions`}
          />
          <CityTopicLinks citySlug={slug} />
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
