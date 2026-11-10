/**
 * /data/power-of-sale-index — the latest edition of the monthly Ontario Power of Sale Index.
 * Every edition also has a permanent URL (/data/power-of-sale-index/{YYYY-MM}) for citation.
 */
import type { Metadata } from "next";
import Link from "next/link";
import PosIndexView, { posIndexJsonLd } from "@/components/powerOfSale/PosIndexView";
import { availableEditions, buildPosIndex, getPosMonthly, posIndexPath } from "@/lib/data/posIndex";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function load() {
  const rows = await getPosMonthly();
  const editions = availableEditions(rows, new Date().toISOString());
  const latest = editions[editions.length - 1];
  return { editions, d: latest ? buildPosIndex(rows, latest) : null };
}

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await load();
  const canonical = `${SITE_URL}${posIndexPath()}`;
  const title = d ? `${d.title} | PureProperty` : "Ontario Power of Sale Index | PureProperty";
  const description = d?.headline.slice(0, 300) ?? "Monthly share of Ontario home sales that were power of sale, by city, from MLS® data.";
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: d?.title ?? "Ontario Power of Sale Index",
      description,
      url: canonical,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Monthly index", title: d?.title ?? "Ontario Power of Sale Index", subtitle: "Share of home sales that were power of sale." })],
    },
  };
}

export default async function PowerOfSaleIndexPage() {
  const { d, editions } = await load();
  if (!d) {
    return (
      <main className="min-h-app bg-background text-foreground">
        <div className="mx-auto max-w-3xl px-4 py-8">
          <h1 className="text-2xl font-bold">Ontario Power of Sale Index</h1>
          <p className="mt-4 text-muted-foreground">
            The index is not available right now. See <Link href="/power-of-sale" className="underline">power of sale in Ontario</Link>.
          </p>
        </div>
      </main>
    );
  }
  return (
    <>
      {posIndexJsonLd(d, `${SITE_URL}${posIndexPath()}`).map((j, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(j) }} />
      ))}
      <PosIndexView d={d} editions={editions} isLatest />
    </>
  );
}
