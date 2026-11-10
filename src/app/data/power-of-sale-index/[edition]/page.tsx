/**
 * /data/power-of-sale-index/{YYYY-MM} — one edition of the Ontario Power of Sale Index, at a
 * permanent URL so a citation keeps pointing at the figures it quoted. Unknown or too-new
 * months 404.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PosIndexView, { posIndexJsonLd } from "@/components/powerOfSale/PosIndexView";
import { availableEditions, buildPosIndex, getPosMonthly, posIndexPath } from "@/lib/data/posIndex";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load(edition: string) {
  if (!/^\d{4}-\d{2}$/.test(edition)) return null;
  const rows = await getPosMonthly();
  const editions = availableEditions(rows, new Date().toISOString());
  if (!editions.includes(edition)) return null;
  const d = buildPosIndex(rows, edition);
  return d ? { d, editions } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ edition: string }> }): Promise<Metadata> {
  const { edition } = await params;
  const data = await load(edition);
  if (!data) return {};
  const { d } = data;
  const canonical = `${SITE_URL}${posIndexPath(edition)}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${d.title} | PureProperty`,
    description: d.headline.slice(0, 300),
    alternates: { canonical },
    openGraph: {
      title: d.title,
      description: d.headline.slice(0, 300),
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Monthly index", title: d.title, subtitle: "Share of home sales that were power of sale." })],
    },
  };
}

export default async function PowerOfSaleIndexEditionPage({ params }: { params: Promise<{ edition: string }> }) {
  const { edition } = await params;
  const data = await load(edition);
  if (!data) notFound();
  const { d, editions } = data;
  return (
    <>
      {posIndexJsonLd(d, `${SITE_URL}${posIndexPath(edition)}`).map((j, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
      ))}
      <PosIndexView d={d} editions={editions} isLatest={edition === editions[editions.length - 1]} />
    </>
  );
}
