/**
 * /data/reports/{YYYY-MM} — one edition of the monthly Ontario Housing Market Report, at a
 * permanent URL so a citation keeps pointing at the figures it quoted. Static: the edition is
 * a committed snapshot (src/lib/data/reportEditions.ts). Unknown months 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReportView, { reportJsonLd } from "@/components/data/ReportView";
import { reportPath } from "@/lib/data/reportPaths";
import { EDITIONS, editionBySlug, latestEdition } from "@/lib/data/reportEditions";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const dynamicParams = false;

export function generateStaticParams() {
  return EDITIONS.map((e) => ({ edition: e.edition }));
}

export async function generateMetadata({ params }: { params: Promise<{ edition: string }> }): Promise<Metadata> {
  const { edition } = await params;
  const d = editionBySlug(edition);
  if (!d) return {};
  const canonical = `${SITE_URL}${reportPath(edition)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${d.title} | PureProperty`,
    description: metaDescription(d.summary),
    alternates: { canonical },
    openGraph: {
      title: d.title,
      description: metaDescription(d.summary),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      publishedTime: d.publishedAt,
      images: [ogImageUrl({ eyebrow: "Monthly report", title: d.title, subtitle: `Sales to the end of ${d.lastMonth}, from MLS® data.` })],
    },
  };
}

export default async function ReportEditionPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = await params;
  const d = editionBySlug(edition);
  if (!d) notFound();
  return (
    <>
      {reportJsonLd(d, `${SITE_URL}${reportPath(edition)}`).map((j, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
      ))}
      <ReportView d={d} editions={EDITIONS} isLatest={d.edition === latestEdition().edition} />
    </>
  );
}
