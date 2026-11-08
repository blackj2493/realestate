/**
 * /home-value — "How much is my house worth in Ontario?" The request form for a free,
 * written price opinion checked by a person, plus links to the 15 city pages. No per-home
 * valuation is rendered (see src/lib/homeValue/content.ts).
 */
import type { Metadata } from "next";
import HomeValueView from "@/components/homeValue/HomeValueView";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const TITLE = "How Much Is My House Worth in Ontario? Free Price Opinion";
const DESCRIPTION =
  "Get a free written price opinion for your Ontario home, based on real sales nearby and checked by a person. A range with the reasons, by email. No calls unless you ask.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/home-value` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${SITE_URL}/home-value`, siteName: "PureProperty", type: "website" },
};

export default function HomeValueIndex() {
  return <HomeValueView city={null} slug={null} facts={null} canonical={`${SITE_URL}/home-value`} />;
}
