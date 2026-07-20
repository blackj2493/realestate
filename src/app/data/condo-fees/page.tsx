import type { Metadata } from "next";
import { getCondoFeeBoard } from "@/lib/data/condoFeeBoard";
import { TrackerShell } from "@/components/data/TrackerShell";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { CondoFeesBoard } from "./CondoFeesBoard";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const SLUG = "condo-fees";
const DEF = trackerBySlug(SLUG)!;

const H1 = "Toronto & GTA Condo Fee Tracker";
const TITLE = "Toronto & GTA Condo Fee Tracker — Where Maintenance Fees Are Rising Fastest";
const DESCRIPTION =
  "Where condo maintenance fees are climbing fastest across Toronto and the GTA — the annualized trend in fee per square foot, by neighbourhood, with the typical current fee. Built from MLS® sold data.";

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
        title: "GTA Condo Fee Tracker",
        subtitle: "Where maintenance fees are rising fastest.",
      }),
    ],
  },
};

export default async function CondoFeesPage() {
  const board = await getCondoFeeBoard();

  return (
    <TrackerShell
      slug={SLUG}
      eyebrow={DEF.eyebrow}
      title={H1}
      description={DESCRIPTION}
      crumbs={[{ name: "Home", href: "/" }, { name: "Data", href: "/data" }, { name: "Condo Fee Tracker" }]}
      dataAsOf={board.dataAsOf}
      methodology={
        <>
          <p>
            For every condo building with enough recent sales, we track its{" "}
            <strong>maintenance fee per square foot</strong> over the trailing 24 months and fit an{" "}
            <strong>annualized trend</strong> (a robust log-slope, shrunk toward the long-run baseline when a
            building has few sales, and capped at ±40%/yr). A neighbourhood&apos;s figure is the{" "}
            <strong>median of its buildings&apos; trends</strong> — one vote per building, so a single
            outlier complex cannot define an area. Neighbourhoods need at least five qualifying buildings to
            appear.
          </p>
          <p>
            Bands are set relative to real condo-fee inflation (~3%/yr): <strong>Stable</strong> is at or
            below it, <strong>Moderate</strong> to 6%, <strong>Rising</strong> to 10%, and{" "}
            <strong>Steep</strong> above 10%. Fees are compared per square foot because a bigger unit
            naturally pays more; note that buildings differ in what the fee includes (heat, hydro, water),
            which the per-sqft view does not adjust for. Individual buildings are not named. Source: MLS®
            sold data, refreshed weekly.
          </p>
        </>
      }
      faqs={[
        {
          q: "Why are condo fees rising faster in some neighbourhoods?",
          a: "Fee increases track a building's real costs — insurance, utilities, staffing, and contributions to the reserve fund for major repairs. Areas with older buildings, more amenities, or recent insurance and utility shocks tend to see faster increases.",
        },
        {
          q: "How is the trend calculated?",
          a: "For each building we fit an annualized trend through its fee per square foot across the last 24 months of sales, shrinking toward the long-run baseline when a building has few sales. The neighbourhood figure is the median of its buildings' trends, so one unusual building can't skew an area.",
        },
        {
          q: "What is a normal condo fee increase?",
          a: "Long-run condo-fee inflation in Ontario runs around 2–3% a year. We treat that as the Stable band; anything consistently above roughly 6% a year is climbing meaningfully faster than costs generally.",
        },
        {
          q: "Do you name individual buildings?",
          a: "No. This tracker reports neighbourhood-level aggregates only. Building-level fee history is shown on the relevant listing page rather than published as a ranking.",
        },
      ]}
    >
      {board.rows.length > 0 ? (
        <CondoFeesBoard rows={board.rows} />
      ) : (
        <p className="rounded-md border border-border bg-card/40 p-6 text-sm text-muted-foreground">
          Condo fee data is refreshing — please check back shortly.
        </p>
      )}
    </TrackerShell>
  );
}
