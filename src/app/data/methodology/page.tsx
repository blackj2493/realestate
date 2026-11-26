/**
 * /data/methodology — how every public data page is built: the source, the rules all pages
 * share (medians, deal-signed dates, price bands, minimum sample sizes), the definitions of the
 * terms the pages use, update times, limits and corrections. Each tracker keeps its own
 * "How we measured it" note; this page is the one place that covers all of them, and the
 * cite box on every data page links here (src/components/dataPage/parts.tsx).
 *
 * Static. Change METHOD_UPDATED when a rule on this page changes.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { HeaderCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import HubFaq from "@/components/seo/HubFaq";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER, METHODOLOGY_PATH } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const METHOD_UPDATED = "2026-11-26";
const TITLE = "How PureProperty Calculates Its Ontario Housing Data";
const DESCRIPTION =
  "The source, rules and definitions behind every PureProperty data page: MLS® sales, medians, deal-signed dates, minimum sample sizes, update times and limits.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: metaDescription(DESCRIPTION),
  alternates: { canonical: `${SITE_URL}${METHODOLOGY_PATH}` },
  openGraph: {
    title: TITLE,
    description: metaDescription(DESCRIPTION),
    url: `${SITE_URL}${METHODOLOGY_PATH}`,
    siteName: "PureProperty",
    type: "article",
    images: [ogImageUrl({ eyebrow: "Methodology", title: "How we calculate the data", subtitle: "Source, rules, definitions and limits." })],
  },
};

const SECTION = "mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6";
const H2 = "text-lg font-semibold";
const P = "mt-3 text-sm leading-relaxed text-muted-foreground";
const LINK = "underline underline-offset-4 hover:text-foreground";

/** Terms used across the data pages. Each page's own note gives its exact window and filters. */
const TERMS: { term: string; id: string; def: React.ReactNode }[] = [
  {
    term: "Median sale price",
    id: "median",
    def: "The middle price: half the homes sold for more, half for less. We use medians, not averages, because one very expensive sale moves an average a lot and a median very little.",
  },
  {
    term: "Same-home price change",
    id: "price-change",
    def: (
      <>
        A city&rsquo;s median moves when the mix of homes sold changes, not only when prices change. So we group each sale with similar
        homes (same community, home type, bedrooms above ground and size band), compare each group with its own median a year earlier,
        and weight the groups by sales. See <Link href="/data/price-change" className={LINK}>price change by city</Link>.
      </>
    ),
  },
  {
    term: "Sale-to-asking (sale-to-list) ratio",
    id: "sale-to-list",
    def: "The sale price divided by the asking price, as a percentage. Over 100% means the home sold over asking.",
  },
  {
    term: "Days on market",
    id: "dom",
    def: (
      <>
        Days to sell counts only homes that sold. Some pages also measure homes that are still for sale (true days on market), which reads
        higher because the hardest homes to sell have not sold yet. Each page says which one it shows. See <Link href="/data/days-on-market" className={LINK}>days on market</Link>.
      </>
    ),
  },
  {
    term: "Price cut",
    id: "price-cut",
    def: (
      <>
        An active listing whose asking price is 0.5% to 60% below its first asking price (outside that range is treated as an entry error). Sold, leased and cancelled listings are not counted. See{" "}
        <Link href="/data/price-cuts" className={LINK}>price cuts</Link>.
      </>
    ),
  },
  {
    term: "Months of supply",
    id: "supply",
    def: "Active listings divided by the recent monthly sales pace: how many months the homes for sale would last at that pace.",
  },
  {
    term: "Market temperature",
    id: "temperature",
    def: (
      <>
        Seller&rsquo;s, balanced or buyer&rsquo;s, scored first from the sale-to-asking ratio and second from months of supply. See{" "}
        <Link href="/data/market-temperature" className={LINK}>market temperature</Link>.
      </>
    ),
  },
  {
    term: "Homes that did not sell",
    id: "not-selling",
    def: "Listings that came off the market without a sale (cancelled or expired) over 12 months, compared with homes that sold in the same months.",
  },
  {
    term: "Power of sale",
    id: "power-of-sale",
    def: (
      <>
        A sale by the lender after the owner falls behind on the mortgage. The MLS® record has no power-of-sale field, so we read each
        listing description for power of sale, foreclosure, bank-owned, court-ordered or receivership. See the{" "}
        <Link href="/data/power-of-sale-index" className={LINK}>Power of Sale Index</Link>.
      </>
    ),
  },
  {
    term: "Property tax",
    id: "property-tax",
    def: (
      <>
        The annual tax the seller entered on the listing: their last bill, not the buyer&rsquo;s first one. Amounts under $300, over
        $100,000, or outside 0.1% to 3% of the sale price are left out as entry errors. See{" "}
        <Link href="/data/property-tax" className={LINK}>property tax by city</Link>.
      </>
    ),
  },
  {
    term: "Land transfer tax",
    id: "ltt",
    def: (
      <>
        Calculated from the Ontario and Toronto rate tables in force, with the first-time buyer refunds, on each city&rsquo;s median
        price. It is a calculation, not a figure from sales. See the{" "}
        <Link href="/data/land-transfer-tax" className={LINK}>land transfer tax calculator</Link>.
      </>
    ),
  },
  {
    term: "Bank forecasts",
    id: "forecasts",
    def: "Price and sales forecasts published by banks and CREA, quoted with their date and source. They are the banks' forecasts, not ours. We do not forecast prices.",
  },
];

const RULES: { title: string; body: React.ReactNode }[] = [
  {
    title: "Medians, with the sample size",
    body: "Every price, ratio and day count is a median unless the page says otherwise. Pages show how many sales a figure uses, so you can judge whether it is thick enough to quote.",
  },
  {
    title: "Dated by the signed deal",
    body: "A sale counts in the month its deal was signed, not the month it closed. Closings can be months later, so dating by closing would mix two different markets.",
  },
  {
    title: "Sales and rentals kept apart",
    body: "Leased homes are never counted as sales. Rent figures come only from leases.",
  },
  {
    title: "Price bands against entry errors",
    body: "Each page keeps sales inside a price band (for example $150,000 to $8,000,000) and states it, so a mistyped price does not move a median.",
  },
  {
    title: "A minimum number of sales",
    body: "Each page sets a minimum number of sales for a city, community or home type. Below it, the page shows no figure, or says that the sample is small.",
  },
  {
    title: "Sales counts show the sample, not the market",
    body: (
      <>
        Our feed is a large share of the Ontario market, not all of it. That is fine for medians, ratios and shares, but not for &ldquo;how
        many homes sold&rdquo;. A sales count on our pages tells you the size of the sample. A change in sales compares the same months a
        year apart. For market totals, use your local board.
      </>
    ),
  },
];

const UPDATES: { what: string; when: string }[] = [
  { what: "Sales, listings, prices, days on market, price cuts, market temperature", when: "Every night" },
  { what: "Open houses", when: "Every 6 hours" },
  { what: "Property tax", when: "Every month" },
  { what: "Bank forecasts and land transfer tax rates", when: "When a bank publishes a new forecast or a rate changes" },
  { what: "Research findings (/data/findings)", when: "Dated once; not updated" },
];

const FAQS = [
  {
    q: "Where does PureProperty's housing data come from?",
    a: "From MLS® listing and sale records in the PropTx feed, the data service of the Toronto Regional Real Estate Board and partner boards, read every night. Property tax comes from the tax amount on each listing. Bank forecasts come from the banks' own reports.",
  },
  {
    q: "Why do your numbers differ from TRREB or CREA?",
    a: "Three reasons: we use medians, not averages or a benchmark price; we date sales by the signed deal, not the closing; and our feed covers a large share of the market, not all of it. The direction of a change usually agrees; the exact level can differ.",
  },
  {
    q: "Can I quote PureProperty data?",
    a: "Yes. Every data page is free to quote with attribution, and its cite box gives the exact citation line with the date. Journalists can ask for custom cuts on the For journalists page.",
  },
];

export default function MethodologyPage() {
  const canonical = `${SITE_URL}${METHODOLOGY_PATH}`;
  const updatedLabel = new Date(`${METHOD_UPDATED}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TechArticle",
        headline: TITLE,
        description: DESCRIPTION,
        url: canonical,
        dateModified: METHOD_UPDATED,
        author: DATA_PUBLISHER,
        publisher: DATA_PUBLISHER,
        about: { "@type": "Thing", name: "Ontario housing market statistics" },
        isAccessibleForFree: true,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Data", item: `${SITE_URL}/data` },
          { "@type": "ListItem", position: 2, name: "Methodology", item: canonical },
        ],
      },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Methodology</span>
        </nav>

        <HeaderCard
          Icon={BookOpen}
          eyebrow="Methodology"
          title={TITLE}
          lede={
            <>
              <p>
                Every figure on our data pages comes from MLS® sales and listings, uses medians, and dates a sale by the day its deal was
                signed. This page covers the source, the rules all pages share, the terms they use, and what the data cannot tell you.
              </p>
              <p className="mt-2 text-sm">
                Published by PureProperty · updated <time dateTime={METHOD_UPDATED}>{updatedLabel}</time>
              </p>
            </>
          }
          hero={null}
        />

        <nav className={SECTION} aria-labelledby="contents">
          <h2 id="contents" className={H2}>On this page</h2>
          <ol className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
            {[
              ["source", "The source"],
              ["rules", "Rules every page follows"],
              ["terms", "Terms and definitions"],
              ["updates", "When the data updates"],
              ["limits", "What the data cannot tell you"],
              ["corrections", "Corrections and contact"],
            ].map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className={LINK}>{i + 1}. {label}</a>
              </li>
            ))}
          </ol>
        </nav>

        <section className={SECTION} aria-labelledby="source">
          <h2 id="source" className={H2}>1. The source</h2>
          <p className={P}>
            The sales and listings come from the MLS® system through PropTx, the data service of the Toronto Regional Real Estate Board and its
            partner boards. We read the feed every night. Each record is a listing that a REALTOR® entered: the asking price, the price changes,
            the status, the home&rsquo;s details and, when it sells, the sale price and the date the deal was signed.
          </p>
          <p className={P}>
            The data covers Toronto, the rest of the Greater Toronto Area, Hamilton, Ottawa and other Ontario markets in the feed. Each page names
            its cities and its time window.
          </p>
        </section>

        <section className={SECTION} aria-labelledby="rules">
          <h2 id="rules" className={H2}>2. Rules every page follows</h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {RULES.map((r) => (
              <li key={r.title} className="rounded-xl border border-border bg-background/60 p-4">
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.body}</p>
              </li>
            ))}
          </ul>
          <p className={P}>
            Each page also has its own &ldquo;How we measured it&rdquo; note with its exact window, price band and filters.
          </p>
        </section>

        <section className={SECTION} aria-labelledby="terms">
          <h2 id="terms" className={H2}>3. Terms and definitions</h2>
          <dl className="mt-4 divide-y divide-border/60">
            {TERMS.map((t) => (
              <div key={t.id} id={t.id} className="grid gap-1 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
                <dt className="text-sm font-semibold">{t.term}</dt>
                <dd className="text-sm leading-relaxed text-muted-foreground">{t.def}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={SECTION} aria-labelledby="updates">
          <h2 id="updates" className={H2}>4. When the data updates</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {UPDATES.map((u) => (
                  <tr key={u.what} className="border-b border-border/60">
                    <td className="py-2 pr-3">{u.what}</td>
                    <td className="py-2 text-muted-foreground">{u.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={P}>Every page shows the date of its data. Quote that date with the figure.</p>
        </section>

        <section className={SECTION} aria-labelledby="limits">
          <h2 id="limits" className={H2}>5. What the data cannot tell you</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
            <li>The value of one specific home. A median describes many sales. For one home, ask for a <Link href="/home-value" className={LINK}>written price opinion</Link>.</li>
            <li>The future. We report what sold. Where a page shows a forecast, it is a bank&rsquo;s forecast, quoted with its date.</li>
            <li>Why one home did not sell. We show what unsold homes had in common, not the cause for each home.</li>
            <li>Condition, renovations and the street. The MLS® record does not measure them, so no figure here includes them.</li>
            <li>Exact square footage. Most listings give size as a range, such as 600 to 699 sq ft, so price per square foot is approximate.</li>
          </ul>
        </section>

        <section className={SECTION} aria-labelledby="corrections">
          <h2 id="corrections" className={H2}>6. Corrections and contact</h2>
          <p className={P}>
            If a figure looks wrong, email{" "}
            <a href="mailto:support@pureproperty.ca" className={LINK}>support@pureproperty.ca</a> with the page and the figure. We check it
            against the source records, fix the page if it is wrong, and reply. Journalists can ask for custom figures on the{" "}
            <Link href="/data/for-journalists" className={LINK}>For journalists</Link> page.
          </p>
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={FAQS} heading="Methodology: common questions" />
          </div>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
