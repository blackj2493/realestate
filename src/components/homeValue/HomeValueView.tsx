/**
 * The /home-value page body, shared by the Ontario page (city = null) and the 15 city
 * pages. Server component: the only client part is the request form (OfferRequestCard).
 *
 * Renders NO per-home valuation (see src/lib/homeValue/content.ts). The brokerage is
 * disclosed the same way as every other page on the site: the "Operated under licence"
 * link to /operated-by, and the REALTOR® signature on the reply email (owner decision
 * 2026-11-08: no brokerage name in the page text).
 */
import Link from "next/link";
import CityTopicLinks from "@/components/seo/CityTopicLinks";
import HomeValueRequestCard from "./HomeValueRequestCard";
import { HowItWorks, SampleOpinion } from "./HomeValueExtras";
import CityMarketFacts from "@/components/seo/CityMarketFacts";
import HubFaq from "@/components/seo/HubFaq";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import type { CityFacts } from "@/lib/data/cityFacts";
import { ENGINE_BACKTEST, HOME_VALUE_CITIES, homeValueFaqs, homeValuePath } from "@/lib/homeValue/content";

export default function HomeValueView({
  city,
  slug,
  facts,
  canonical,
}: {
  city: string | null;
  slug: string | null;
  facts: CityFacts | null;
  canonical: string;
}) {
  const place = city ?? "Ontario";
  const faqs = homeValueFaqs(place, facts);
  const others = HOME_VALUE_CITIES.filter((c) => c.slug !== slug);

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">Home</Link>
          <span className="mx-2">/</span>
          {city ? (
            <>
              <Link href={homeValuePath()} className="hover:text-foreground">Home value</Link>
              <span className="mx-2">/</span>
              <span className="text-foreground">{city}</span>
            </>
          ) : (
            <span className="text-foreground">Home value</span>
          )}
        </nav>

        <h1 className="text-2xl font-bold sm:text-3xl">How much is my house worth in {place}?</h1>
        <p className="mt-3 text-base leading-relaxed">
          Get a free written price opinion for your home, based on real sales {city ? `in ${city}` : "near you"} and checked by a person.
          No automated guess, and no calls unless you ask.
        </p>

        <HowItWorks />

        <div className="mt-6">
          <HomeValueRequestCard city={city} />
          <p className="mt-2 text-xs text-muted-foreground">
            A licensed REALTOR® checks every price opinion.{" "}
            <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">Operated under licence</Link>.
          </p>
        </div>

        <SampleOpinion />

        {facts && (
          <div className="mt-10">
            <CityMarketFacts facts={facts} canonical={canonical} />
          </div>
        )}

        <section className="mt-10" aria-labelledby="how">
          <h2 id="how" className="text-lg font-semibold">How we work out a home&apos;s price</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>We start from what your home last sold for, and update it with how prices for similar homes in your city have moved since then.</li>
            <li>We compare it with the homes most like yours that sold nearby: size, lot, style, property tax and bedrooms.</li>
            <li>We check both against our price model for your neighbourhood.</li>
            <li>
              A person then reads the result and adjusts for what a model cannot see: condition, renovations, layout and the street.
              In a test on {ENGINE_BACKTEST.sales} past sales, the model&apos;s typical error was about {ENGINE_BACKTEST.medianErrorPct}%, so we give you a range, with the reasons.
            </li>
          </ul>
        </section>

        {slug && <CityTopicLinks citySlug={slug} current="home-value" className="mt-6" />}

        <div className="mt-10">
          <HubFaq faqs={faqs} heading={`Home value in ${place}: common questions`} />
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">{city ? "Other cities" : "By city"}</h2>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {others.map((c) => (
              <Link key={c.slug} href={homeValuePath(c.slug)} className="underline hover:text-foreground">
                {c.city}
              </Link>
            ))}
          </p>
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
