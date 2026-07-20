import type { Metadata } from "next";
import { getMarketBoard } from "@/lib/data/marketBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { RentVsBuyBoard } from "./RentVsBuyBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "rent-vs-buy";
const DEF = trackerBySlug(SLUG)!;

const H1 = "GTA & Toronto Rent-vs-Buy Tracker";
const TITLE = "GTA & Toronto Rent-vs-Buy — Rental Yield & Price-to-Rent by Market";
const DESCRIPTION =
  "Rent versus buy across Toronto and the GTA: typical rent, median price, gross rental yield and the price-to-rent ratio, by bedroom count. See where renting or owning has the edge. Updated nightly from MLS® data.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data/${SLUG}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data/${SLUG}`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: DEF.eyebrow,
        title: "GTA Rent-vs-Buy",
        subtitle: "Rental yield & price-to-rent by market.",
      }),
    ],
  },
};

export default async function RentVsBuyPage() {
  const board = await getMarketBoard();
  const rows = board.rows.filter((r) => r.rentalRows.length > 0);

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Rent vs Buy" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            <strong>Monthly Rent</strong> is the typical asking rent and <strong>Median Price</strong> the
            median sold price for the selected bedroom count in each market.{" "}
            <strong>Gross Yield</strong> is annual rent ÷ price — a landlord&apos;s return before costs.{" "}
            <strong>Price-to-Rent</strong> is price ÷ annual rent: as a rule of thumb, under ~15 tends to
            favour buying and over ~20 tends to favour renting.
          </p>
          <p>
            These are <strong>gross</strong> figures — they deliberately ignore mortgage interest, property
            tax, condo fees, insurance and maintenance, so they compare markets on a like-for-like basis
            rather than producing a personalized rent-or-buy verdict. Rents come from the MLS® rental feed and
            prices from sold data (both comprehensive but not exhaustive). Refreshed nightly.
          </p>
        </>
      }
      faqs={[
        {
          q: "Does a higher yield mean I should buy?",
          a: "Gross yield measures the rent a property earns relative to its price, before costs. A higher yield means the purchase is better supported by rent — useful for investors — but it isn't a personal recommendation, since your mortgage rate, down payment and holding costs matter.",
        },
        {
          q: "What is the price-to-rent ratio?",
          a: "It's the purchase price divided by a year of rent. Lower ratios (roughly under 15) suggest buying is relatively attractive; higher ratios (over about 20) suggest renting is, because the price is high relative to what the property rents for.",
        },
        {
          q: "Do these numbers include ownership costs?",
          a: "No — they are gross figures. They exclude mortgage interest, property tax, condo fees, insurance and maintenance. They're for comparing markets, not for deciding your own rent-vs-buy math.",
        },
        {
          q: "Which markets are covered?",
          a: "Toronto and Ottawa plus the GTA municipalities — Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Burlington, Milton, Oshawa, Whitby, Ajax, Pickering and Hamilton — for one- to four-bedroom homes.",
        },
      ]}
    >
      {rows.length > 0 ? (
        <RentVsBuyBoard rows={rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Rental data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
