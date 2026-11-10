/**
 * DashboardCityView — what a SIGNED-OUT visitor sees at /dashboard (2026-11).
 *
 * WHY. The locked teaser showed grey shapes, so a visitor could not see what the
 * dashboard does before the sign-in ask. This view shows the live Toronto market (real,
 * dated data — never an "example" or invented figure) and locks only what is personal or
 * VOW-gated: your own areas, saved homes, the morning email, and sold prices.
 *
 * COMPLIANCE. Only data that /property/on/toronto already shows signed-out:
 *  • market board aggregates (median sale price, days to sell, price-cut share, share
 *    sold over asking) — totals and medians, no single sold record;
 *  • active For Sale listings from the IDX feed via PropertyCard (brokerage on the card,
 *    ListingComplianceNotice below, ≤100 per query);
 *  • recently sold ADDRESSES via getRecentSoldPublicForCity, whose include_fields gate
 *    returns the address only. The price column is a lock, never a fetched value.
 * No sold price or date of a single home, no True DOM, no distress flag.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bell, Bookmark, Lock, MapPin } from "lucide-react";
import { searchListings, type ListingDocument } from "@/lib/typesense/client";
import { citiesForHubSlug, cityFilterClause } from "@/lib/listings/cityHubs";
import { getMarketBoard, type MarketRow } from "@/lib/data/marketBoard";
import { boardRowFor } from "@/lib/data/cityFacts";
import { getRecentSoldPublicForCity, type SoldPublicLink } from "@/lib/sold/soldByKey";
import { buildAddressPath } from "@/lib/listings/listingPath";
import { PropertyCard } from "@/components/PropertyCard";
import { toCardData } from "@/lib/listings/listingCardData";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { plausibleCuts } from "@/lib/listings/plausibleCuts";

const CITY_SLUG = "toronto";
const CITY = "Toronto";
const SIGN_UP_HREF = "/login?next=%2Fdashboard";
const OTHER_AREAS = ["Mississauga", "Brampton", "Vaughan", "Ottawa", "Hamilton"];
const SOLD_ROWS = 5;

const money = (n: number | null | undefined) =>
  n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`;
const pct = (n: number | null | undefined, digits = 0) => (n == null ? "—" : `${n.toFixed(digits)}%`);

async function loadCityView() {
  const [board, hub] = await Promise.all([
    getMarketBoard().catch(() => ({ rows: [] as MarketRow[], dataAsOf: null })),
    citiesForHubSlug(CITY_SLUG).catch(() => ({ cities: [] as string[], total: 0 })),
  ]);
  const row = boardRowFor(board.rows, CITY);
  const base =
    hub.cities.length > 0
      ? `${cityFilterClause(hub.cities)} && TransactionType:=\`For Sale\` && PropertyType:!=Commercial`
      : null;
  const empty = { listings: [] as ListingDocument[], totalFound: 0 };
  const [fresh, cuts, sold] = base
    ? await Promise.all([
        searchListings({ query: "*", rawFilterBy: base, perPage: 4, sortBy: "EntryTimestamp", sortOrder: "desc" }).catch(
          () => empty
        ),
        searchListings({
          query: "*",
          // Typical homes: no placeholder prices, and not the $20M estates whose cuts dwarf
          // everything else.
          rawFilterBy: `${base} && TotalPriceDrop:>0 && ListPrice:>=100000 && ListPrice:<2000000`,
          // Over-fetch: the top of a "largest drop" sort is mostly feed typos (an original
          // ask of $68,999,000 on a $649,990 condo). plausibleCuts() keeps real cuts only.
          perPage: 60,
          sortBy: "TotalPriceDrop",
          sortOrder: "desc",
        }).catch(() => empty),
        getRecentSoldPublicForCity(hub.cities, SOLD_ROWS + 3).catch(() => [] as SoldPublicLink[]),
      ])
    : [empty, empty, [] as SoldPublicLink[]];
  return {
    row,
    dataAsOf: board.dataAsOf,
    fresh: fresh.listings,
    activeTotal: hub.total,
    cuts: plausibleCuts(cuts.listings).slice(0, 4),
    sold,
  };
}

/**
 * Card data with the cut visible: previousPrice rebuilt from TotalPriceDrop (many docs
 * carry no OriginalListPrice, so the card's own check would hide the cut).
 */
function withCut(doc: ListingDocument) {
  const card = toCardData(doc);
  const drop = doc.TotalPriceDrop ?? 0;
  // The same number the plausibility filter checked, so the card and the filter agree.
  return drop > 0 ? { ...card, previousPrice: card.price + drop } : card;
}

/** 12 bars of the monthly median sale price — an aggregate, as on the public city page. */
function PriceBars({ months }: { months: { month: string; medianPrice: number }[] }) {
  const last = months.slice(-12);
  if (last.length < 3) return null;
  const max = Math.max(...last.map((m) => m.medianPrice));
  const min = Math.min(...last.map((m) => m.medianPrice));
  const span = Math.max(1, max - min);
  return (
    <div className="mt-3 flex h-14 items-end gap-1" aria-label="Median sale price, last 12 months">
      {last.map((m, i) => (
        <div
          key={m.month}
          title={`${m.month}: ${money(m.medianPrice)}`}
          className={i === last.length - 1 ? "flex-1 bg-cyan-600 dark:bg-cyan-400" : "flex-1 bg-cyan-600/30 dark:bg-cyan-400/30"}
          style={{ height: `${25 + ((m.medianPrice - min) / span) * 75}%` }}
        />
      ))}
    </div>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="terminal-font mt-1 text-2xl font-bold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function LockedPanel({ icon, title, body, cta }: { icon: ReactNode; title: string; body: string; cta: string }) {
  return (
    <div className="rounded-lg border border-dashed border-cyan-600/40 bg-cyan-50/40 p-4 dark:bg-cyan-950/20">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <Lock className="ml-auto h-3.5 w-3.5 text-muted-foreground" aria-label="Needs a free account" />
      </div>
      <p className="mt-2 text-sm text-foreground/70">{body}</p>
      <Link
        href={SIGN_UP_HREF}
        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300"
      >
        {cta} <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

/** Recently sold addresses (public record); the price is a lock, never a fetched value. */
function RecentlySold({ items }: { items: SoldPublicLink[] }) {
  const rows = items
    .map((it) => ({ ...it, href: buildAddressPath(it) }))
    .filter((it): it is SoldPublicLink & { href: string } => it.href !== null)
    .slice(0, SOLD_ROWS);
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="dash-sold-heading">
      <h2 id="dash-sold-heading" className="text-sm font-semibold text-foreground">
        Recently sold in {CITY}
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {rows.map((it) => (
          <li key={it.id} className="flex items-center gap-2 py-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Link href={it.href} className="line-clamp-1 flex-1 text-sm text-foreground hover:text-cyan-700 dark:hover:text-cyan-300">
              {it.address}
            </Link>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground" aria-label="Sold price needs a free account">
              <Lock className="h-3 w-3" />
              <span aria-hidden className="h-3 w-12 rounded bg-black/10 dark:bg-white/15" />
            </span>
          </li>
        ))}
      </ul>
      <Link
        href={SIGN_UP_HREF}
        className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 border border-cyan-600 text-sm font-semibold text-cyan-700 transition-colors hover:bg-cyan-600/10 dark:text-cyan-300"
      >
        See what they sold for — free <ArrowRight className="h-4 w-4" />
      </Link>
      <p className="mt-2 text-xs text-muted-foreground">
        Board rules require a verified sign-in to show sold prices and dates.
      </p>
    </section>
  );
}

export default async function DashboardCityView() {
  const { row, dataAsOf, fresh, activeTotal, cuts, sold } = await loadCityView();
  const asOf = dataAsOf
    ? new Date(dataAsOf).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="terminal-font text-lg font-bold uppercase tracking-wider text-foreground">Dashboard</h1>
        <span className="text-sm font-medium text-foreground/80">{CITY} today</span>
        {asOf ? <span className="text-xs text-muted-foreground">Market figures updated {asOf}</span> : null}
      </div>

      {/* The one ask, at the top, next to the thing it unlocks. */}
      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-cyan-600/40 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-base font-semibold text-foreground">Live {CITY} market. Make it yours.</p>
          <p className="mt-1 text-sm text-foreground/70">
            Pick your areas, save homes, and get an email when a price drops. Free.
          </p>
        </div>
        <Link
          href={SIGN_UP_HREF}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 bg-cyan-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-cyan-700"
        >
          Make it mine — free <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      {/* Areas: Toronto is on; choosing your own areas is the personal part. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="terminal-font text-[11px] uppercase tracking-wider text-muted-foreground">Areas</span>
        <span className="inline-flex min-h-[32px] items-center gap-1 rounded border border-cyan-600 bg-cyan-600/10 px-3 text-sm font-medium text-cyan-800 dark:text-cyan-200">
          <MapPin className="h-3.5 w-3.5" /> {CITY}
        </span>
        {OTHER_AREAS.map((a) => (
          <Link
            key={a}
            href={SIGN_UP_HREF}
            className="inline-flex min-h-[32px] items-center gap-1 rounded border border-border px-3 text-sm text-muted-foreground hover:border-cyan-600/60 hover:text-foreground"
          >
            <Lock className="h-3 w-3" /> {a}
          </Link>
        ))}
      </div>

      {row ? (
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            label="Median sale price"
            value={money(row.monthly.at(-1)?.medianPrice ?? row.medianPrice)}
            note={row.yoyPct == null ? "last full month" : `${row.yoyPct >= 0 ? "+" : ""}${row.yoyPct.toFixed(1)}% vs a year ago`}
          />
          <Tile label="Homes for sale" value={(row.activeCount ?? activeTotal).toLocaleString("en-CA")} note="active now" />
          <Tile
            label="Cut their price"
            value={pct(row.cutShare == null ? null : row.cutShare * 100)}
            note={row.medianCutPct == null ? "of homes for sale" : `median cut ${row.medianCutPct.toFixed(1)}%`}
          />
          <Tile
            label="Typical days to sell"
            value={row.soldMedianDom == null ? "—" : String(Math.round(row.soldMedianDom))}
            note={row.pctOverAsking == null ? "last 12 months" : `${pct(row.pctOverAsking)} sold over asking (90 days)`}
          />
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">New in {CITY}</h2>
              <Link href="/property/on/toronto" className="text-xs text-cyan-700 hover:underline dark:text-cyan-300">
                See all
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {fresh.map((doc) => (
                <PropertyCard key={doc.id} property={toCardData(doc)} showSaveButton={false} variant="compact" />
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Biggest price cuts under $2M</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cuts.map((doc) => (
                <PropertyCard key={doc.id} property={withCut(doc)} showSaveButton={false} variant="compact" />
              ))}
            </div>
          </section>
        </div>

        <div className="flex flex-col gap-4">
          <RecentlySold items={sold} />
          {row && row.monthly.length >= 3 ? (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-foreground">Median sale price, 12 months</h2>
              <PriceBars months={row.monthly} />
              <Link
                href="/data/housing-market/toronto"
                className="mt-2 inline-block text-xs text-cyan-700 hover:underline dark:text-cyan-300"
              >
                Month by month
              </Link>
            </section>
          ) : null}
          <LockedPanel
            icon={<Bookmark className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />}
            title="Your saved homes"
            body="Save a home and see here when its price drops, it goes conditional, or it sells."
            cta="Start saving homes"
          />
          <LockedPanel
            icon={<Bell className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />}
            title="Your morning email"
            body="New listings and price cuts in your areas, one email each morning. Stop it any time."
            cta="Get the morning email"
          />
        </div>
      </div>

      <div className="mt-4">
        <ListingComplianceNotice />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Market figures are medians and shares from MLS® data{asOf ? `, updated ${asOf}` : ""}. Listings are live.
      </p>
    </div>
  );
}
