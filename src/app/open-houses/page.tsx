/**
 * /open-houses — "open houses near me / this weekend" in Ontario: the number of homes with a
 * public open house in the next 7 days in each covered city, linking to /open-houses/{city}.
 * Counts come from public.open_houses (see src/lib/openHouses/openHouses.ts). Hourly.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import { STUDY_CITIES, studyCitySlugForFeedCity } from "@/lib/data/studyCities";
import { WINDOW_DAYS, getOpenHouseCounts, openHousesPath } from "@/lib/openHouses/openHouses";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load() {
  const byFeedCity = await getOpenHouseCounts();
  const bySlug = new Map<string, number>();
  for (const [feedCity, n] of byFeedCity) {
    const slug = studyCitySlugForFeedCity(feedCity);
    if (slug) bySlug.set(slug, (bySlug.get(slug) ?? 0) + n);
  }
  const cities = STUDY_CITIES.map((c) => ({ ...c, n: bySlug.get(c.slug) ?? 0 })).sort((a, b) => b.n - a.n);
  const total = cities.reduce((s, c) => s + c.n, 0);
  return { cities, total };
}

export async function generateMetadata(): Promise<Metadata> {
  const { total, cities } = await load();
  const title = `Open Houses in Ontario This Week: ${total.toLocaleString("en-CA")} Homes in ${cities.filter((c) => c.n).length} Cities`;
  const description = `${total.toLocaleString("en-CA")} homes for sale have a public open house in the next ${WINDOW_DAYS} days. Pick a city for the homes and times by day, from the MLS®.`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(description),
    alternates: { canonical: `${SITE_URL}${openHousesPath()}` },
    openGraph: {
      title,
      description: metaDescription(description),
      url: `${SITE_URL}${openHousesPath()}`,
      siteName: "PureProperty",
      type: "website",
      images: [ogImageUrl({ eyebrow: "Open houses", title: "Open houses in Ontario this week", subtitle: "By city, from the MLS®." })],
    },
  };
}

export default async function OpenHousesIndexPage() {
  const { cities, total } = await load();
  const max = Math.max(...cities.map((c) => c.n), 1);
  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <CalendarDays className="h-6 w-6 text-teal-700 dark:text-teal-400" />
          Open Houses in Ontario This Week
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {total.toLocaleString("en-CA")} homes for sale in the cities below have a public open house in the next {WINDOW_DAYS} days. Each city page lists them by
          day with the times. Read from the MLS® every 6 hours.
        </p>

        <section className="mt-6 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="cities">
          <h2 id="cities" className="text-lg font-semibold">Homes with an open house, by city</h2>
          <ul className="mt-4 space-y-2">
            {cities.map((c) => (
              <li key={c.slug} className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <Link href={openHousesPath(c.slug)} className="truncate text-sm underline-offset-4 hover:underline">{c.city}</Link>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 shrink-0 rounded-r-[3px]" style={{ width: `${Math.max(0.8, (c.n / max) * 100) * 0.8}%`, background: "#0d9488" }} aria-hidden="true" />
                  <span className="text-xs tabular-nums text-muted-foreground">{c.n.toLocaleString("en-CA")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8">
          <HubFaq
            faqs={[
              { q: "Where can I find open houses this weekend in Ontario?", a: `Pick a city above. Each page lists the homes for sale with a public open house in the next ${WINDOW_DAYS} days, by day, with the times, refreshed through the day.` },
              { q: "Do I need to book an open house?", a: "No. A public open house is open to anyone during the listed time. Bring photo ID; some agents ask visitors to sign in." },
            ]}
            heading="Open houses: common questions"
          />
        </div>
        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
