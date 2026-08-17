import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { TRACKERS } from "@/lib/data/trackers";
import { LIVE_FINDINGS } from "@/lib/data/findings";
import { getCompetitionBoard } from "@/lib/data/competitionBoard";
import { getRentBoard } from "@/lib/data/rentBoard";
import { getCondoFeeBoard } from "@/lib/data/condoFeeBoard";
import { ogImageUrl } from "@/lib/og/ogImageUrl";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const TITLE = "Ontario Housing Market Statistics — Free, by Neighbourhood | PureProperty";
const DESCRIPTION =
  "Free Ontario housing statistics by neighbourhood: how often homes sell over asking, what houses actually rent for, condo fee trends, price cuts and days on market. Toronto, Ottawa and the whole province, updated nightly from MLS® data. Free to cite and embed.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: "Market Data",
        title: "Ontario Housing Market Statistics",
        subtitle: "Over-asking, rents, condo fees & more — by neighbourhood.",
      }),
    ],
  },
};

/**
 * Headline figures for the hub.
 *
 * WHY THIS EXISTS: the hub shipped as a card grid with no numbers on it, while being
 * the /data URL linked from the homepage and every footer. Nobody cites a table of
 * contents — a reporter links the page carrying the figure they quoted. A statistics
 * page needs statistics on it.
 *
 * Over-ask and rent figures come from the PRECOMPUTED province-wide rollups the
 * refresh jobs write (city = "Ontario"), so nothing is aggregated here. The condo-fee
 * figure has no such rollup, so it is a median across covered neighbourhoods and is
 * labelled as exactly that rather than dressed up as a provincial average.
 */
interface KeyFigure {
  value: string;
  label: string;
  scope: string;
  href: string;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Best-effort: a board that fails is omitted, never rendered as a dash or a zero.
 * A missing figure should look missing, not look like the market moved to 0% —
 * the silent-null failure this codebase has been bitten by before.
 */
async function keyFigures(): Promise<KeyFigure[]> {
  const [comp, rent, condo] = await Promise.allSettled([
    getCompetitionBoard(),
    getRentBoard(),
    getCondoFeeBoard(),
  ]);

  const out: KeyFigure[] = [];

  if (comp.status === "fulfilled") {
    const houses = comp.value.summary.find((r) => r.group === "House");
    if (houses) {
      out.push({
        value: `${houses.pctOverAsk.toFixed(1)}%`,
        label: "of houses sold over asking",
        scope: "Ontario · last 12 months",
        href: "/data/over-asking",
      });
    }
  }

  if (rent.status === "fulfilled") {
    const threeBed = rent.value.summary.find((r) => r.group === "House" && r.beds === "3");
    if (threeBed) {
      out.push({
        value: `$${threeBed.medianRent.toLocaleString("en-CA")}`,
        label: "median rent, 3-bedroom house",
        scope: "Ontario · closed leases",
        href: "/data/rents",
      });
    }
  }

  if (condo.status === "fulfilled") {
    const trend = median(condo.value.rows.map((r) => r.annualPct).filter((n): n is number => n != null));
    if (trend != null) {
      out.push({
        value: `${trend >= 0 ? "+" : "−"}${Math.abs(trend).toFixed(1)}%`,
        label: "condo fees per year",
        scope: "median Ontario neighbourhood",
        href: "/data/condo-fees",
      });
    }
    // Coverage is the differentiator worth stating plainly: the monthly reports that
    // circulate on these metrics are GTA-only, so most of these areas have no
    // published figure anywhere else.
    const areas = new Set(condo.value.rows.map((r) => `${r.city}|${r.area}`));
    if (comp.status === "fulfilled") {
      for (const r of comp.value.rows) areas.add(`${r.city}|${r.area}`);
    }
    if (rent.status === "fulfilled") {
      for (const r of rent.value.rows) areas.add(`${r.city}|${r.area}`);
    }
    if (areas.size > 0) {
      out.push({
        value: areas.size.toLocaleString("en-CA"),
        label: "neighbourhoods covered",
        scope: "province-wide, not just the GTA",
        href: "/data/for-journalists",
      });
    }
  }

  return out;
}

export default async function DataHubPage() {
  const figures = await keyFigures();

  const collection = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data`,
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(collection) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <div className="mx-auto max-w-[1100px] px-4 py-10">
        <header className="mb-8">
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            Market Data
          </p>
          <h1 className="mt-1 text-3xl font-bold text-foreground sm:text-4xl">
            Ontario Housing Market Statistics
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Free, always-current market data for Toronto, Ottawa and every Ontario market we cover — cut
            deeper than the board headlines and broken out by neighbourhood rather than region. Every
            figure is an aggregate from live MLS® data, rebuilt nightly. Free to cite and embed.
          </p>
        </header>

        {figures.length > 0 && (
          <section className="mb-10" aria-labelledby="key-figures">
            <h2
              id="key-figures"
              className="terminal-font text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
            >
              Where the market stands
            </h2>
            <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              {figures.map((f) => (
                <Link
                  key={f.href + f.label}
                  href={f.href}
                  className="group bg-card/60 p-4 transition-colors hover:bg-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-500"
                >
                  <span className="block text-2xl font-bold tabular-nums text-foreground">{f.value}</span>
                  <span className="mt-1 block text-sm leading-snug text-foreground/80">{f.label}</span>
                  <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
                    {f.scope}
                  </span>
                </Link>
              ))}
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              Free to quote with a credit and a link. Shares and medians only — we publish proportions
              rather than counts of homes sold, because our feed is a large subset of the market rather
              than all of it.
            </p>
          </section>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {TRACKERS.map((t) => {
            const live = t.status === "live";
            const card = (
              <div
                className={cn(
                  "group flex h-full flex-col justify-between rounded-lg border border-border bg-card/40 p-5 transition-colors",
                  live ? "hover:border-cyan-500/50" : "opacity-70"
                )}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="terminal-font text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
                      {t.eyebrow}
                    </p>
                    {!live && (
                      <span className="terminal-font rounded border border-border px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1.5 text-lg font-bold text-foreground">{t.title}</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t.tagline}</p>
                </div>
                {live && (
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-cyan-700 dark:text-cyan-400">
                    View tracker
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </div>
            );
            return live ? (
              <Link key={t.slug} href={`/data/${t.slug}`} className="block">
                {card}
              </Link>
            ) : (
              <div key={t.slug}>{card}</div>
            );
          })}
        </div>

        {LIVE_FINDINGS.length > 0 && (
          <section className="mt-10" aria-labelledby="findings">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="findings" className="text-lg font-bold text-foreground">
                Findings
              </h2>
              <Link
                href="/data/findings"
                className="text-sm font-medium text-cyan-700 hover:underline dark:text-cyan-400"
              >
                All findings →
              </Link>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              The trackers above hold the current numbers. These are the moments they said something
              worth arguing — dated, with the method and the limits shown.
            </p>
            <ul className="mt-4 space-y-3">
              {LIVE_FINDINGS.slice(0, 3).map((f) => (
                <li key={f.slug}>
                  <Link
                    href={`/data/findings/${f.slug}`}
                    className="group block rounded-lg border border-border bg-card/40 p-5 transition-colors hover:border-cyan-500/50"
                  >
                    <h3 className="text-base font-bold text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-400">
                      {f.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.standfirst}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-10">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
