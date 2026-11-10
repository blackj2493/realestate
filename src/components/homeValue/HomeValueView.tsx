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
import { Home } from "lucide-react";
import { StatCard } from "@/components/dataPage/parts";
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
  // Three market figures for the stat cards (the full sentences are in CityMarketFacts below).
  const m = (id: string) => facts?.facts.find((f) => f.id === id)?.measure ?? null;
  const price = m("price");
  const days = m("days_to_sell");
  const under = m("under_first_ask");
  const s2l = m("final_ask");
  const cards = [
    price && { label: "Median sale price", value: `$${Math.round(price.value).toLocaleString("en-CA")}`, sub: `${price.name}.` },
    days && { label: "Days to sell", value: `${days.value} days`, sub: "Median for homes sold in the last 12 months." },
    under
      ? { label: "Sold below first ask", value: `${Math.round(under.value)}%`, sub: "Of the homes sold in the last 12 months." }
      : s2l && { label: "Sale to asking price", value: `${s2l.value.toFixed(1)}%`, sub: "Average share of the final asking price, last 90 days." },
  ].filter((c): c is { label: string; value: string; sub: string } => !!c);

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
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

        <header className="grid gap-6 rounded-2xl border border-border bg-card/60 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <div>
            <p className="terminal-font flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
              <Home className="h-3.5 w-3.5" aria-hidden="true" />
              Free price opinion · {place}
            </p>
            <h1 className="mt-3 text-2xl font-bold leading-tight sm:text-3xl">How much is my house worth in {place}?</h1>
            <p className="mt-3 text-base leading-relaxed text-muted-foreground">
              Get a free written price opinion for your home, based on real sales {city ? `in ${city}` : "near you"} and checked by a person.
              No automated guess, and no calls unless you ask.
            </p>
            <HowItWorks />
          </div>
          <div>
            <HomeValueRequestCard city={city} />
            <p className="mt-2 text-xs text-muted-foreground">
              A licensed REALTOR® checks every price opinion.{" "}
              <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">Operated under licence</Link>.
            </p>
          </div>
        </header>

        {cards.length > 0 && facts && (
          <section className="mt-4" aria-label={`${place} market now`}>
            <div className={`grid gap-3 ${cards.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              {cards.map((c) => (
                <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {place} market, MLS® data updated <time dateTime={facts.updatedIso}>{facts.updatedLabel}</time>. A city figure is not the price of your home.
            </p>
          </section>
        )}

        <div className="mx-auto max-w-3xl">
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
          <div className="mt-2 flex flex-wrap gap-2">
            {others.map((c) => (
              <Link
                key={c.slug}
                href={homeValuePath(c.slug)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
              >
                {c.city}
              </Link>
            ))}
          </div>
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
        </div>
      </div>
    </main>
  );
}
