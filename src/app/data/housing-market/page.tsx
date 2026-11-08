/**
 * /data/housing-market — index of the city housing-market pages. One line per city: the
 * first sentence its page opens with. Aggregates only; hourly revalidate.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { boardRowFor } from "@/lib/data/cityFacts";
import { buildOutlook, outlookYear } from "@/lib/data/marketOutlook";
import { OUTLOOK_CITIES, outlookPath } from "@/lib/data/outlookCities";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

async function rows() {
  try {
    const board = await getMarketBoard();
    return {
      year: board.dataAsOf ? outlookYear(board.dataAsOf) : null,
      items: OUTLOOK_CITIES.map((c) => ({ ...c, outlook: buildOutlook(c.city, boardRowFor(board.rows, c.city), board.dataAsOf) })),
    };
  } catch {
    return { year: null, items: OUTLOOK_CITIES.map((c) => ({ ...c, outlook: null })) };
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const { year } = await rows();
  const title = year ? `Ontario Housing Market ${year}: What the Data Shows Now` : "Ontario Housing Market: What the Data Shows Now";
  const description =
    "Sale prices, sales, sale-to-asking ratios and price cuts for 15 Ontario cities against a year earlier, from MLS® data, updated nightly. No forecasts.";
  return {
    metadataBase: new URL(SITE_URL),
    title: `${title} | PureProperty`,
    description,
    alternates: { canonical: `${SITE_URL}/data/housing-market` },
    openGraph: { title, description, url: `${SITE_URL}/data/housing-market`, siteName: "PureProperty", type: "website" },
  };
}

export default async function HousingMarketIndex() {
  const { year, items } = await rows();
  return (
    <main className="min-h-app bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Housing market</span>
        </nav>
        <h1 className="text-2xl font-bold sm:text-3xl">
          {year ? `Ontario Housing Market ${year}: What the Data Shows Now` : "Ontario Housing Market: What the Data Shows Now"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          PureProperty does not forecast prices. Each city page shows the measures that forecasts are built from: prices and sales against a year
          earlier, how close homes sell to asking, and how many sellers cut. From MLS® data, refreshed nightly.
        </p>
        <ul className="mt-6 divide-y divide-border">
          {items.map((c) => (
            <li key={c.slug} className="py-4">
              <Link href={outlookPath(c.slug)} className="font-semibold underline hover:text-foreground">
                {year ? `${c.city} housing market ${year}` : `${c.city} housing market`}
              </Link>
              {c.outlook?.facts[0] && <p className="mt-1 text-sm text-muted-foreground">{c.outlook.facts[0].text}</p>}
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
