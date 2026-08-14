/**
 * /data/for-journalists — the press desk.
 *
 * WHY THIS PAGE EXISTS: we do not have a scoop, and chasing one was a mistake. TRREB has
 * published PDOM since 2020, Valery/Better Dwelling already run the power-of-sale numbers,
 * and WOWA/Zolo publish active-listing age. What is genuinely absent in Canada is a data
 * DESK — someone free, fast, granular and reachable. TRREB serves members, CREA serves
 * boards, CMHC is slow and aggregate, and the portal competitors have no service layer at
 * all. Redfin's Data Center earns its citations by being the path of least resistance at
 * 4pm on deadline, not by breaking news. This page is that offer, written down.
 *
 * The limitations section is not throat-clearing — it is the conversion mechanism. Editors
 * fact-check, content-marketing brokerages overclaim, and being the source that says "here
 * is where my number would mislead you" is the cheapest durable advantage available.
 */
import type { Metadata } from "next";
import Link from "next/link";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { TRACKERS } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const CONTACT = "support@pureproperty.ca";

const TITLE = "For Journalists — Free Ontario Housing Data | PureProperty";
const DESCRIPTION =
  "Free, neighbourhood-level Ontario housing data for newsrooms — updated nightly from live MLS® data. " +
  "Embeddable charts, a written methodology, and custom cuts on request within one business day.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data/for-journalists` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data/for-journalists`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: "For Journalists",
        title: "Free Ontario Housing Data",
        subtitle: "Nightly, neighbourhood-level, free to cite.",
      }),
    ],
  },
};

const H2 = "text-xl font-bold text-foreground sm:text-2xl";
const P = "mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base";
const SECTION = "mt-12 border-t border-border pt-8";

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-4 text-xs leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

export default function ForJournalistsPage() {
  const live = TRACKERS.filter((t) => t.status === "live");

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "For Journalists", item: `${SITE_URL}/data/for-journalists` },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[820px] px-4 py-10">
        <header>
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            For Journalists
          </p>
          <h1 className="mt-1 text-3xl font-bold text-foreground sm:text-4xl">
            Free Ontario housing data for newsrooms
          </h1>
          <p className={P}>
            We publish neighbourhood-level housing data for Ontario, updated nightly from live MLS® data.
            It is free, requires no account, and is free to quote, chart and embed. If you need a cut that
            isn&apos;t on the site, ask — we&apos;ll usually have it back to you the same day.
          </p>
          <p className={P}>
            No embargo, no exclusivity required, and nothing here is gated. The only thing we ask is a
            credit and a link.
          </p>
        </header>

        {/* ── What's available ─────────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>What&apos;s available</h2>
          <p className={P}>
            Every tracker below covers Toronto, Ottawa, Hamilton, Mississauga and the wider GTA, broken out
            by neighbourhood rather than region, and is rebuilt nightly.
          </p>
          <ul className="mt-4 space-y-3">
            {live.map((t) => (
              <li key={t.slug} className="rounded-lg border border-border p-4">
                <Link
                  href={`/data/${t.slug}`}
                  className="font-semibold text-foreground underline underline-offset-4 hover:text-cyan-700 dark:hover:text-cyan-400"
                >
                  {t.title}
                </Link>
                <p className="mt-1 text-sm text-muted-foreground">{t.tagline}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── How to cite ──────────────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>How to cite us</h2>
          <p className={P}>
            In copy, &ldquo;according to PureProperty.ca&rdquo; with a link to the tracker page is plenty.
            For a formal reference list:
          </p>
          <Code>{`PureProperty Ontario Market Trackers, retrieved [date],\nhttps://www.pureproperty.ca/data`}</Code>
          <p className={P}>
            Tracker URLs are stable. If we ever restructure them we will keep redirects in place and give
            advance notice to anyone who has cited us, so published pieces and research guides don&apos;t rot.
          </p>
        </section>

        {/* ── Embeds ───────────────────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>Embed a live chart</h2>
          <p className={P}>
            Every tracker has an embeddable version that updates itself, so a piece published today still
            shows current numbers next month. It is deliberately plain — it should read as part of your
            article, not as an ad — and it carries a small source line back to us.
          </p>
          <Code>{`<iframe
  src="https://www.pureproperty.ca/embed/days-on-market"
  width="100%" height="620" loading="lazy"
  style="border:1px solid #e5e7eb;border-radius:12px"
  title="Days-on-Market Leaderboard — PureProperty"
></iframe>`}</Code>
          <p className={P}>
            Swap <code className="rounded bg-muted px-1">days-on-market</code> for any tracker slug above.
          </p>
        </section>

        {/* ── Custom requests ──────────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>Ask for a custom cut</h2>
          <p className={P}>
            This is the part worth using. If you need a specific neighbourhood, property type, price band or
            date range, email{" "}
            <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
              {CONTACT}
            </a>{" "}
            and we&apos;ll pull it. Same day where we can, within one business day otherwise.
          </p>
          <p className={P}>Things people ask for that we can usually answer:</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground sm:text-base">
            <li>A single neighbourhood&apos;s numbers, rather than the city aggregate</li>
            <li>One property type only — detached, condo apartment, townhouse</li>
            <li>A price band, or a comparison across bands</li>
            <li>A ranked list, so you can say who is fastest, slowest, cheapest or most discounted</li>
            <li>The same cut a month or a year ago, where our archive reaches back that far</li>
          </ul>
          <p className={P}>
            We&apos;ll also tell you when we think a number is too thin to publish, and say so before you run
            it rather than after.
          </p>
        </section>

        {/* ── Methodology + limits ─────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>Methodology, and what we won&apos;t claim</h2>
          <p className={P}>
            Each tracker page carries its own method note. Two things are worth knowing before you quote
            anything from us, and we&apos;d rather you heard them here than found them later.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">We don&apos;t publish sales counts</h3>
          <p className={P}>
            Our feed is a large subset of the Ontario market, not the whole of it. That is fine for prices,
            days on market, price cuts, fees and ratios — all of which are proportions or medians and hold up
            on a subset. It is <strong>not</strong> fine for &ldquo;how many homes sold last month&rdquo;, so we
            don&apos;t answer that. For transaction volumes, use TRREB, CREA or your local board. We will point
            you there rather than give you a number we don&apos;t stand behind.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">We measure listings that are sitting, not listings that sold</h3>
          <p className={P}>
            Boards report days-on-market for homes that <em>found a buyer</em>. That is a real number, but it
            is survivorship-biased: it can only count the winners. Several of our figures measure the homes
            still on the market instead, which is a different population and will read higher. Neither is
            wrong; they answer different questions, and they should not be compared directly or presented as
            a correction of the board&apos;s figure.
          </p>
          <p className={P}>
            Where a board already publishes something similar, we&apos;ll tell you. TRREB, for example, has
            published both list-date and property days-on-market since 2020. Our version is nightly and
            neighbourhood-level rather than monthly and regional — that&apos;s the difference, and it&apos;s the
            only claim we make about it.
          </p>

          <h3 className="mt-6 font-semibold text-foreground">Medians, not averages</h3>
          <p className={P}>
            Housing data has a long tail, and one $12M sale moves an average and tells you nothing. We report
            medians unless a chart says otherwise, and we show the sample size so you can judge whether a
            neighbourhood is thick enough to quote.
          </p>
        </section>

        {/* ── Contact ──────────────────────────────────────────────────────── */}
        <section className={SECTION}>
          <h2 className={H2}>Contact</h2>
          <p className={P}>
            {/* TODO(owner): replace with a named person + title. A named source converts far better
                than an inbox — it is also the one thing the portal competitors structurally cannot
                offer, because there is nobody to call. */}
            <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
              {CONTACT}
            </a>{" "}
            — we read this and reply. Happy to be quoted on the record, to explain how a figure is built, or
            to be on background if you just need to sanity-check something you&apos;ve got from elsewhere.
          </p>
          <p className={P}>
            If you&apos;re on deadline, say so in the subject line and we&apos;ll jump it.
          </p>
        </section>

        <div className="mt-12">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
