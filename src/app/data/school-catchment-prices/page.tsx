/**
 * /data/school-catchment-prices — "Do better schools raise house prices in Ontario?" One row per
 * city with public-board catchment maps: premium per school-score point and the 9+ vs 7–8 gap,
 * similar houses in the same community. Fully static from data/school-prices.json.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { GraduationCap } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, PriceOpinionCard } from "@/components/dataPage/parts";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { SCHOOL_SOURCE_LINE, gapCell, getSchoolData, premiumKind, rankedSchoolCities, schoolPricesPath, signedPct } from "@/lib/data/schoolPrices";
import { titleYear } from "@/lib/seo/titleYear";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

function load() {
  const file = getSchoolData();
  const ranked = rankedSchoolCities(file);
  const title = `Do Better Schools Raise House Prices in Ontario? ${titleYear()} School Catchment Premium by City`;
  const strong = ranked.filter((c) => premiumKind(c) === "strong");
  const none = ranked.filter((c) => premiumKind(c) === "none");
  const sales = ranked.reduce((s, c) => s + c.sales, 0);
  const summary =
    (strong.length
      ? `Inside the same community, a better-scored elementary school raised house prices in ${strong.map((c) => `${c.city} (${signedPct(c.perPoint!.pct)} per score point)`).join(" and ")}.`
      : "Inside the same community, the school score made no measurable difference to house prices in any covered city.") +
    (none.length ? ` In ${none.map((c) => c.city).join(", ")} it made no measurable difference.` : "") +
    ` ${sales.toLocaleString("en-CA")} house sales.`;
  return { file, ranked, title, summary, sales };
}

export function generateMetadata(): Metadata {
  const { title, summary } = load();
  const canonical = `${SITE_URL}${schoolPricesPath()}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description: metaDescription(summary),
    alternates: { canonical },
    openGraph: {
      title,
      description: metaDescription(summary),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "School catchments", title: "Do better schools raise house prices?", subtitle: "Similar houses, same community, by city." })],
    },
  };
}

export default function SchoolPricesIndexPage() {
  const { file, ranked, title, summary } = load();
  const canonical = `${SITE_URL}${schoolPricesPath()}`;
  const updatedIso = file.generatedAt.slice(0, 10);
  const updatedLabel = new Date(file.generatedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${title}", updated ${updatedLabel}, ${canonical.replace(/^https?:\/\/(www\.)?/, "")}`;
  const faqs = [
    { q: "Do better schools raise house prices in Ontario?", a: summary },
    {
      q: "Do school catchment boundaries change?",
      a: "Yes. Boards redraw catchments, and new schools open. Always check the zoned school for an address with the school board before you buy.",
    },
    {
      q: "How is this measured?",
      a: "Each house sale is placed by its postal code and matched to the public board's elementary catchment, with the PureProperty School Score (0–10, from EQAO). Only similar houses in the same community are compared, with controls for bathrooms, parking, lot width, basement, renovation words and the quarter of the sale.",
    },
  ];

  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">School catchment prices</span>
        </nav>

        <HeaderCard
          Icon={GraduationCap}
          eyebrow="School catchments · Ontario"
          title={title}
          lede={
            <>
              <p>{summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={updatedIso}>{updatedLabel}</time> · MLS® sales and public school board catchments, refreshed monthly
              </p>
            </>
          }
          hero={`${ranked.length} cities`}
          heroSub="public elementary catchments"
        />

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="table">
          <h2 id="table" className="text-lg font-semibold">By city</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">City</th>
                  <th className="py-2 pr-3 font-medium">Board</th>
                  <th className="py-2 pr-3 text-right font-medium">Per score point</th>
                  <th className="py-2 pr-3 text-right font-medium">9+ vs 7–8</th>
                  <th className="py-2 text-right font-medium">Sales</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((c) => (
                  <tr key={c.slug} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <Link href={schoolPricesPath(c.slug)} className="underline underline-offset-4 hover:text-foreground">{c.city}</Link>
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.board.replace(" District School Board", " DSB")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{gapCell(c.perPoint)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{gapCell(c.bands["9plus"])}</td>
                    <td className="py-2 text-right tabular-nums">{c.sales.toLocaleString("en-CA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            * Not significant: the 95% range includes zero. – = too few sales in 9+ catchments. Cities whose public board catchment maps we do not
            have (Halton, Durham, Ottawa) are not covered yet.
          </p>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <PriceOpinionCard citySlug={null} />
        </section>

        <div className="mx-auto max-w-3xl">
          <div className="mt-8">
            <HubFaq faqs={faqs} heading="Schools and house prices: common questions" />
          </div>
          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{SCHOOL_SOURCE_LINE}</p>
          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
