/**
 * Area insights for the keyed /address (sold/off-market) page — gives a visitor who landed
 * on an off-market home somewhere to go: local market context + nearby active listings to
 * keep their search moving.
 *
 * TWO TIERS, respecting the VOW line (see analytics/page.tsx — the full analytics bundle is
 * consumer-gated because it's laced with VOW-derived sold metrics):
 *  - PUBLIC (everyone): a radius-local "market snapshot" of ACTIVE/IDX asking stats (median
 *    asking, median rent, active inventory, days listed) from getNearbyForSale — the same
 *    anon-safe class of data AddressProfileView already shows. Plus nearby homes FOR SALE and
 *    FOR RENT (active IDX listings, each linking to its listing page).
 *  - CONSUMER (signed-in): a compact strip of VOW-derived market metrics (median SOLD price
 *    + YoY, sold DOM, sell-through, % under ask) from the nightly-precomputed region_metrics
 *    (getRegionMetricsCached — city level), plus a deep link to the full /analytics for the
 *    municipality. Anon sees a "sign up free" nudge in its place — never the gated numbers.
 *
 * Server component: all fetches run here (Typesense radius ×2 + one cached region_metrics
 * point lookup), gated strictly by `isConsumer`. Renders null-safe — any missing metric or
 * section self-hides (no "N/A"/0 placeholders; the dominant silent-null failure mode).
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { Home, KeyRound, LineChart, Lock } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import { getNearbyForSale, type NearbyListing } from "@/lib/address/nearbyForSale";
import { getRegionMetricsCached } from "@/lib/market/aggregates";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { cityHubSlug, deslugCity } from "@/lib/listings/listingPath";

/** Raw City → precomputed region_metrics municipality key (the 15 curated GTA markets). A
 *  miss just returns null from getRegionMetricsCached and the consumer strip self-hides. */
function municipalityKey(city: string): string {
  if (OTTAWA_AREAS.includes(city)) return "Ottawa"; // OREB area names don't slug to "ottawa"
  return deslugCity(cityHubSlug(city)) || city; // "Toronto C01" → "Toronto"
}

/** "YYYY-MM" shifted back one year (same month, prior year) — for the YoY sold comparison. */
function yearAgoMonth(m: string): string {
  const [y, mm] = m.split("-");
  return `${Number(y) - 1}-${mm}`;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-foreground">{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function MiniCard({ l, isLease }: { l: NearbyListing; isLease: boolean }) {
  return (
    <Link
      href={`/properties/${l.id}`}
      className="group block w-[210px] shrink-0 overflow-hidden rounded-lg border border-border bg-card/40 transition-colors hover:border-cyan-500/40"
    >
      <ListingThumbnail src={l.imageUrl ?? undefined} alt={l.address} className="h-32 w-full" sizes="210px" />
      <div className="p-3">
        <div className="font-mono text-base font-bold text-foreground">
          {formatPrice(l.price)}
          {isLease ? <span className="ml-0.5 text-xs font-normal text-muted-foreground">/mo</span> : null}
        </div>
        <div className="mt-0.5 line-clamp-1 text-sm text-foreground">{l.address}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {l.beds != null ? <span>{l.beds} bd</span> : null}
          {l.baths != null ? <span>{l.baths} ba</span> : null}
          {l.subType ? <span className="line-clamp-1">{l.subType}</span> : null}
        </div>
        {/* TRREB §4: listing brokerage attribution is mandatory (null → explicit fallback). */}
        <div className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">{l.brokerage ?? "Brokerage unavailable"}</div>
      </div>
    </Link>
  );
}

function NearbyRow({
  title,
  icon,
  listings,
  isLease,
  footer,
}: {
  title: string;
  icon: ReactNode;
  listings: NearbyListing[];
  isLease: boolean;
  footer?: ReactNode;
}) {
  if (!listings.length) return null;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        {icon} {title}
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {listings.map((l) => (
          <MiniCard key={l.id} l={l} isLease={isLease} />
        ))}
      </div>
      {footer}
    </section>
  );
}

type TileData = { label: string; value: string; sub?: string };

export default async function AreaInsights({
  lat,
  lng,
  city,
  cityName,
  cityRegion,
  cityHref,
  isConsumer,
}: {
  lat: number;
  lng: number;
  city: string;
  cityName: string;
  cityRegion: string | null;
  cityHref: string;
  isConsumer: boolean;
}) {
  const munKey = municipalityKey(city);
  const [sale, lease, metrics] = await Promise.all([
    getNearbyForSale(lat, lng, { limit: 9 }),
    getNearbyForSale(lat, lng, { limit: 9, transactionType: "lease" }),
    isConsumer ? getRegionMetricsCached(munKey) : Promise.resolve(null),
  ]);

  const areaLabel = cityRegion || cityName;

  // ── PUBLIC snapshot (active/IDX asking — anon-safe) ───────────────────
  const publicTiles: TileData[] = [];
  if (sale?.stats.medianAsking) publicTiles.push({ label: "Median asking (for sale)", value: formatPrice(sale.stats.medianAsking) });
  if (lease?.stats.medianAsking) publicTiles.push({ label: "Median rent", value: `${formatPrice(lease.stats.medianAsking)}/mo` });
  if (sale && sale.totalFound > 0) publicTiles.push({ label: "For sale nearby", value: String(sale.totalFound), sub: `within ${sale.radiusKm} km` });
  if (sale?.stats.medianDaysListed != null)
    publicTiles.push({ label: "Median days listed", value: String(Math.round(sale.stats.medianDaysListed)), sub: "active inventory" });

  // ── CONSUMER (VOW-derived sold metrics) from region_metrics ───────────
  const soldTiles: TileData[] = [];
  if (metrics) {
    const pts = metrics.trend?.points ?? [];
    const latest = pts.length ? pts[pts.length - 1] : null;
    if (latest?.medianPrice) {
      const prior = pts.find((p) => p.month === yearAgoMonth(latest.month));
      const yoy = prior && prior.medianPrice > 0 ? (latest.medianPrice - prior.medianPrice) / prior.medianPrice : null;
      soldTiles.push({
        label: "Median sold",
        value: formatPrice(latest.medianPrice),
        sub: yoy != null ? `${yoy >= 0 ? "▲" : "▼"} ${Math.abs(yoy * 100).toFixed(1)}% YoY` : undefined,
      });
    }
    const dyn = metrics.dynamics?.dynamics;
    if (dyn?.medianDom != null) soldTiles.push({ label: "Median sold DOM", value: `${Math.round(dyn.medianDom)} days` });
    const out = metrics.outcomes?.outcomes;
    if (out?.failureRate != null) soldTiles.push({ label: "Sell-through", value: `${Math.round((1 - out.failureRate) * 100)}%`, sub: `last ${out.windowMonths} mo` });
    if (dyn?.underAskShare != null) soldTiles.push({ label: "Sold under ask", value: `${Math.round(dyn.underAskShare * 100)}%` });
  }

  const hasAnything =
    publicTiles.length > 0 || soldTiles.length > 0 || (sale?.listings.length ?? 0) > 0 || (lease?.listings.length ?? 0) > 0;
  if (!hasAnything) return null;

  return (
    <div className="mb-6 space-y-5">
      {publicTiles.length > 0 && (
        <section>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-foreground">
            <LineChart className="h-4 w-4 text-cyan-700 dark:text-cyan-400" /> {areaLabel} market snapshot
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {publicTiles.map((t) => (
              <Tile key={t.label} {...t} />
            ))}
          </div>
        </section>
      )}

      {/* Market trends — consumer sees VOW-derived sold numbers; anon a sign-up nudge. */}
      {isConsumer ? (
        (soldTiles.length > 0 || metrics) && (
          <section>
            {/* Sold metrics come from the municipality-level region_metrics precompute, so
                label them with the municipality (munKey), NOT the district in cityName —
                e.g. a C01 address shows Toronto-wide sold numbers, not "Toronto C01". */}
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wider text-foreground">Sold market — {munKey}</h3>
            {soldTiles.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {soldTiles.map((t) => (
                  <Tile key={t.label} {...t} />
                ))}
              </div>
            )}
            <Link
              href={`/analytics?region=${encodeURIComponent(munKey)}`}
              className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-cyan-300"
            >
              See full {munKey} market analytics →
            </Link>
          </section>
        )
      ) : (
        <Link
          href="/login"
          className="flex items-center justify-center gap-2 rounded-lg border border-cyan-600/40 bg-cyan-500/5 px-4 py-2.5 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-500/10 dark:text-cyan-300"
        >
          <Lock className="h-3.5 w-3.5" /> Sold prices, price trends &amp; sell-through — sign up free
        </Link>
      )}

      {/* Nearby actives — somewhere to continue the search (IDX, anon-legal). */}
      <NearbyRow
        title={`Homes for sale near ${areaLabel}`}
        icon={<Home className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
        listings={sale?.listings ?? []}
        isLease={false}
        footer={
          <Link href={cityHref} className="mt-2 inline-block text-sm text-cyan-700 hover:underline dark:text-cyan-300">
            {/* cityHref is the municipality hub (cityHubSlug strips the district), so label
                it with munKey to match its actual scope. */}
            More homes for sale in {munKey} →
          </Link>
        }
      />
      <NearbyRow
        title={`Homes for rent near ${areaLabel}`}
        icon={<KeyRound className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />}
        listings={lease?.listings ?? []}
        isLease
      />
    </div>
  );
}
