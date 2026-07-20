import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { trackerBySlug } from "@/lib/data/trackers";
import { PriceCutsBoard } from "@/app/data/price-cuts/PriceCutsBoard";
import { PriceRankingsBoard } from "@/app/data/price-rankings/PriceRankingsBoard";
import { DaysOnMarketBoard } from "@/app/data/days-on-market/DaysOnMarketBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tracker: string }>;
}): Promise<Metadata> {
  const { tracker } = await params;
  const def = trackerBySlug(tracker);
  // Embeds are duplicate views of the /data page — never indexed; canonical points home.
  return {
    title: def ? `${def.title} — PureProperty` : "PureProperty",
    robots: { index: false, follow: true },
    alternates: def ? { canonical: `${SITE_URL}/data/${tracker}` } : undefined,
  };
}

/** Build the bare widget body for a live tracker; null → 404. */
async function renderWidget(slug: string): Promise<ReactNode> {
  if (slug === "price-cuts") {
    const board = await getMarketBoard();
    const rows = board.rows.filter((r) => r.cutShare != null);
    return <PriceCutsBoard rows={rows} embed />;
  }
  if (slug === "price-rankings") {
    const board = await getMarketBoard();
    const rows = board.rows.filter((r) => r.medianPrice != null);
    return <PriceRankingsBoard rows={rows} embed />;
  }
  if (slug === "days-on-market") {
    const board = await getMarketBoard();
    const rows = board.rows.filter((r) => r.soldMedianDom != null);
    return <DaysOnMarketBoard rows={rows} embed />;
  }
  return null;
}

export default async function EmbedPage({ params }: { params: Promise<{ tracker: string }> }) {
  const { tracker } = await params;
  const def = trackerBySlug(tracker);
  if (!def || def.status !== "live") notFound();

  const body = await renderWidget(tracker);
  if (!body) notFound();

  const pageUrl = `${SITE_URL}/data/${tracker}`;
  return (
    <div className="bg-background p-3 text-foreground">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h1 className="text-sm font-bold text-foreground">{def.title}</h1>
        <Link
          href={pageUrl}
          target="_blank"
          className="text-[11px] font-medium text-cyan-700 hover:underline dark:text-cyan-400"
        >
          PureProperty.ca
        </Link>
      </div>
      {body}
      <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
        Source:{" "}
        <Link href={pageUrl} target="_blank" className="underline">
          {def.title} — PureProperty.ca
        </Link>
        . Live MLS® data, deemed reliable but not guaranteed accurate.
      </p>
    </div>
  );
}
