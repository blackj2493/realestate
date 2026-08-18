"use client";

import Link from "next/link";
import { Readout, ReadoutCell } from "@/components/daylight/primitives";
import { RankingTable, type RankingColumn } from "@/components/data/RankingTable";
import { fmtPercent } from "@/lib/format";
import { cityHubSlug } from "@/lib/listings/listingPath";
import type { MarketRow } from "@/lib/data/marketBoard";

/**
 * Where a market name sends you: the map terminal, seeded with that city.
 *
 * `city` is chipUrl's existing place param — a plain place link with no structured
 * filters, documented there as a stable contract. Verified live 2026-08-17:
 * `?city=Toronto` returns 9,336 active listings and `?city=Richmond+Hill` returns 984,
 * so the TRREB district-code split ("Toronto C06") is already handled on this path.
 *
 * The map rather than the /property/{prov}/{city} hub, deliberately. The hub is a static
 * list; the map carries the same True DOM this table is about, per listing, with the
 * reported figure struck through beside it. A reader who has just learned that Richmond
 * Hill listings sit 73 days lands on the individual homes doing the sitting. The hub is
 * still linked below the table, where it does the crawl job the map cannot.
 */
const mapHref = (region: string) => `/properties?city=${encodeURIComponent(region)}`;

const DASH = "—";
const days = (n: number | null) => (n == null ? DASH : `${n}d`);

/**
 * Days the board clock hides: the gap between the real (relist-stitched) listing age
 * and the reported one. Never negative — the stitched span always starts at or before
 * the current campaign.
 */
function hiddenDays(r: MarketRow): number | null {
  if (r.trueDom == null || r.medianNaiveDom == null) return null;
  return Math.max(0, r.trueDom - r.medianNaiveDom);
}

/** Share of active listings that have sat 90+ days, from the DoM distribution buckets. */
function stale90(b: MarketRow["domBuckets"]): number | null {
  if (!b) return null;
  const total = b.d0_14 + b.d15_30 + b.d31_60 + b.d61_90 + b.d90plus;
  return total > 0 ? b.d90plus / total : null;
}

const columns: RankingColumn<MarketRow>[] = [
  {
    key: "region",
    label: "Market",
    align: "left",
    sortValue: (r) => r.region,
    render: (r) => (
      <Link
        href={mapHref(r.region)}
        className="font-semibold text-[color:var(--dt-sig)] underline decoration-[color:var(--dt-sig)]/40 underline-offset-2 hover:decoration-[color:var(--dt-sig)] dark:text-cyan-400 dark:decoration-cyan-400/40 dark:hover:decoration-cyan-400"
      >
        {r.region}
      </Link>
    ),
  },
  {
    key: "soldMedianDom",
    label: "Median Days to Sell",
    align: "right",
    group: "Homes that sold",
    hint: "Median days a recently-sold home spent listed (relist-adjusted)",
    sortValue: (r) => r.soldMedianDom,
    render: (r) => (
      <span className="font-semibold text-[color:var(--dt-sig)] dark:text-cyan-400">{days(r.soldMedianDom)}</span>
    ),
  },
  {
    key: "range",
    label: "Typical Sale Window",
    align: "right",
    group: "Homes that sold",
    // "Typical Sale Window" is the plain label; the precision lives in the tooltip and
    // in the sentence above the table, both of which state that this is the MIDDLE HALF.
    // That matters: read casually, a "window" can be taken for the full range, which is
    // far wider — so the two supporting explanations are load-bearing here rather than
    // decorative. Do not remove them while keeping this label.
    hint: "Interquartile range. A quarter of sales were faster than the first figure and a quarter slower than the second, so exactly half landed between them — it shows how consistent a market is, not just how fast",
    sortValue: (r) => r.soldP75Dom,
    render: (r) =>
      r.soldP25Dom == null || r.soldP75Dom == null ? DASH : `${r.soldP25Dom}–${r.soldP75Dom}d`,
  },
  {
    key: "reportedAge",
    label: "Reported Listing Age",
    align: "right",
    group: "Homes still listed",
    hint: "Median age of active listings using the board clock, which restarts at zero each time a home is relisted",
    sortValue: (r) => r.medianNaiveDom,
    render: (r) => days(r.medianNaiveDom),
  },
  {
    key: "activeAge",
    label: "True Days on Market",
    align: "right",
    group: "Homes still listed",
    hint: "The same listings, with relist chains stitched back together so the clock keeps running",
    sortValue: (r) => r.trueDom,
    render: (r) => (
      <span className="font-semibold text-[color:var(--dt-sig)] dark:text-cyan-400">{days(r.trueDom)}</span>
    ),
  },
  {
    key: "hidden",
    label: "Hidden Days",
    align: "right",
    group: "Homes still listed",
    hint: "How much longer homes have really been for sale than the reported figure shows",
    sortValue: (r) => hiddenDays(r),
    render: (r) => {
      const h = hiddenDays(r);
      return h == null ? DASH : (
        <span className="text-[color:var(--dt-warn)] dark:text-amber-400">+{h}d</span>
      );
    },
  },
  {
    key: "stale90",
    label: "Sitting 90+ Days",
    align: "right",
    group: "Homes still listed",
    hint: "Share of active listings on market 90+ days",
    sortValue: (r) => stale90(r.domBuckets),
    render: (r) => {
      const s = stale90(r.domBuckets);
      return s == null ? DASH : (
        <span className="text-[color:var(--dt-warn)] dark:text-amber-400">{fmtPercent(s * 100)}</span>
      );
    },
  },
];

const GRID =
  "minmax(104px,1.3fr) minmax(112px,1.1fr) minmax(120px,1.1fr) minmax(104px,1fr) minmax(100px,1fr) minmax(92px,0.9fr) minmax(100px,1fr)";

export function DaysOnMarketBoard({ rows, embed = false }: { rows: MarketRow[]; embed?: boolean }) {
  const sellable = rows.filter((r) => r.soldMedianDom != null);
  const bySpeed = [...sellable].sort((a, b) => (a.soldMedianDom ?? 0) - (b.soldMedianDom ?? 0));
  const slowest = bySpeed[bySpeed.length - 1];
  const toronto = rows.find((r) => r.region === "Toronto");
  const torontoHidden = toronto ? hiddenDays(toronto) : null;

  // Dedupe by slug: TRREB splits some markets into district codes that collapse to one
  // hub, so a raw map would emit the same href twice.
  const hubLinks = Array.from(
    new Map(
      sellable
        .map((r) => ({ region: r.region, slug: cityHubSlug(r.region) }))
        .filter((h) => h.slug.length > 0)
        .map((h) => [h.slug, h])
    ).values()
  );

  return (
    <div className="space-y-5">
      {!embed && (
        <Readout cols={3}>
          <ReadoutCell
            label="Toronto, as reported"
            value={toronto?.medianNaiveDom != null ? `${toronto.medianNaiveDom} days` : DASH}
            sub="board clock, restarts on relist"
          />
          <ReadoutCell
            label="Toronto, in reality"
            value={toronto?.trueDom != null ? `${toronto.trueDom} days` : DASH}
            tone="sig"
            sub={
              torontoHidden != null ? `${torontoHidden} days longer than reported` : "relist chains stitched"
            }
          />
          <ReadoutCell
            label="Slowest to sell"
            value={slowest ? slowest.region : DASH}
            sub={slowest?.soldMedianDom != null ? `median ${slowest.soldMedianDom} days, homes that sold` : undefined}
          />
        </Readout>
      )}
      {/* The single sentence that stops this table being misread. Two columns describe
          homes that sold and four describe homes that have not; side by side those look
          contradictory — 24 days next to 73 days — until you know they are different
          houses. The gap between them IS the finding, so it is worth stating in the open
          rather than leaving to a tooltip nobody hovers before concluding. */}
      {!embed && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Two different sets of homes here.{" "}
          <strong className="text-foreground">Days to sell</strong> is measured on homes that{" "}
          <em>sold</em>. <strong className="text-foreground">Listing age</strong> and{" "}
          <strong className="text-foreground">true days on market</strong> are measured on homes{" "}
          <em>still for sale</em>. When the second is far larger than the first, the homes that sell are
          going quickly while everything else piles up — which is what a slow market actually looks like.{" "}
          <strong className="text-foreground">Typical sale window</strong> is the middle half of sales — a
          quarter went faster than the low figure and a quarter slower than the high one, so it shows how
          consistent a market is rather than just how fast.
        </p>
      )}
      <RankingTable
        columns={columns}
        rows={sellable}
        getRowKey={(r) => r.region}
        gridTemplate={GRID}
        initialSortKey="soldMedianDom"
        initialSortDir="asc"
        minWidth={640}
        isFeatured={(r) => r.region === "Toronto"}
      />
      {/* The crawl path. The market names above go to the map, which is the better
          destination for a person and a dead end for a crawler — the terminal is a
          client-only WebGL surface, which is the reason the /property/{prov}/{city} hubs
          were built in the first place.
          This page is an outreach target: the whole point of earning links into it is
          authority flowing onward to indexable pages. Un-linked, that stops here. So the
          hubs get a plain crawlable row, and readers get the map. */}
      {!embed && hubLinks.length > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="terminal-font uppercase tracking-wider">Homes for sale:</span>{" "}
          {hubLinks.map((h, i) => (
            <span key={h.slug}>
              {i > 0 && <span aria-hidden="true"> · </span>}
              <Link
                href={`/property/on/${h.slug}`}
                className="underline decoration-border underline-offset-2 hover:text-cyan-700 hover:decoration-current dark:hover:text-cyan-400"
              >
                {h.region}
              </Link>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
