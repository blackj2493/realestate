/**
 * /analytics — Market Trends terminal. Real per-region sold/active aggregates
 * (median price, $/sqft, sold-to-list, months of inventory, temperature) from
 * the two cached market endpoints. This surface is VOW-derived (raw_vow_sold
 * trends), so it is gated by the same server-side session check as /dashboard
 * (CLAUDE.md §3A) — and both endpoints independently return a locked shape for
 * anonymous callers as defense in depth.
 *
 * The default/selected scope is still prefetched server-side (the gate has already
 * proven the caller is a consumer) and handed to AnalyticsClient as `initial` — but the
 * prefetch now lives inside a <Suspense> boundary (AnalyticsData). The shell + the
 * SubmarketLeaderboard paint immediately and a cold region STREAMS in when its RPCs
 * resolve, instead of the 11-RPC batch blocking TTFB and freezing the whole navigation
 * (which made a big market like Toronto take 20s+). Tiers 2/3 make that stream fast.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import { parseTypeKeys } from "@/lib/dashboard/propertyTypes";
import {
  getTrendCached,
  getStatsCached,
  getDomDistCached,
  getPriceCutsCached,
  getSoldDynamicsCached,
  getRentalYieldCached,
  getAvmReliabilityCached,
  getInventoryHistoryCached,
  getSeasonalityCached,
  getListingOutcomesCached,
  getPriceLedgerCached,
  getRegionMetricsCached,
  assembleAnalyticsInitial,
  ZERO_SCOPE,
} from "@/lib/market/aggregates";
import AnalyticsClient from "./AnalyticsClient";
import SubmarketLeaderboard from "@/components/dashboard/SubmarketLeaderboard";

export const dynamic = "force-dynamic";

// Mirror AnalyticsClient's DEFAULT_REGION so the server prefetch targets the same scope
// the client will render on first paint.
const DEFAULT_REGION = "Brampton";
const REGION_RE = /^[\p{L}\p{N}\s\-'.]{1,60}$/u;

export const metadata = {
  title: "Market Trends — PureProperty.ca",
  description:
    "Sold-price trends, sales volume, months of inventory and market temperature for any GTA city or neighbourhood.",
};

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/analytics");
  if (!(await hasAcceptedTerms(user.id))) redirect("/welcome?next=/analytics");

  // Resolve the initial scope from the URL (region + property-type chips), exactly as
  // AnalyticsClient does, so the server-seeded data matches the client's first render.
  const sp = await searchParams;
  const usp = new URLSearchParams();
  if (typeof sp.region === "string") usp.set("region", sp.region);
  if (typeof sp.types === "string") usp.set("types", sp.types);
  const region = (usp.get("region") || DEFAULT_REGION).trim();
  const typeKeys = parseTypeKeys(usp);

  return (
    <>
      {/* Zoom out: rank every GTA market, then drill into one below. */}
      <SubmarketLeaderboard />
      {/* Stream the data-heavy panels so the shell paints instantly and a slow region no
          longer blocks first byte. Fallback is a skeleton (not AnalyticsClient) so there
          is no client re-fetch — the seeded client mounts once when the stream resolves. */}
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsData region={region} typeKeys={typeKeys} />
      </Suspense>
    </>
  );
}

/**
 * Server component that runs the (already-gated) 11-RPC prefetch and seeds AnalyticsClient.
 * Isolated under <Suspense> so its await no longer gates the page shell. Best-effort: if an
 * RPC is unavailable, that panel falls back to a client fetch.
 */
async function AnalyticsData({ region, typeKeys }: { region: string; typeKeys: string[] }) {
  if (!REGION_RE.test(region)) return <AnalyticsClient initial={undefined} />;

  // Default (all-types) view → serve the nightly precompute (a single point lookup) when
  // present and fresh (migration 081). This moves the whole 11-RPC batch — including the
  // residual slow avm-reliability / listing-outcomes — off the request path entirely.
  if (typeKeys.length === 0) {
    const precomputed = await getRegionMetricsCached(region);
    if (precomputed) return <AnalyticsClient initial={precomputed} />;
  }

  // Live fallback: cached RPCs (a custom type view, or a precompute miss/stale). Shares
  // assembleAnalyticsInitial with the nightly job so the emitted shape is identical. The
  // tuple input to allSettled preserves each metric's type through destructuring.
  const [trendR, statsR, domR, cutsR, dynR, rentR, avmR, invR, seasR, outcR, ledgR] = await Promise.allSettled([
    getTrendCached(region, typeKeys, ZERO_SCOPE),
    getStatsCached(region, typeKeys, ZERO_SCOPE),
    getDomDistCached(region, typeKeys, ZERO_SCOPE),
    getPriceCutsCached(region, typeKeys, ZERO_SCOPE),
    getSoldDynamicsCached(region, typeKeys, ZERO_SCOPE),
    getRentalYieldCached(region, typeKeys),
    getAvmReliabilityCached(region, typeKeys),
    getInventoryHistoryCached(region),
    getSeasonalityCached(region, typeKeys),
    getListingOutcomesCached(region, typeKeys),
    getPriceLedgerCached(region),
  ]);
  const initial = assembleAnalyticsInitial(region, typeKeys, {
    trend: trendR.status === "fulfilled" ? trendR.value : null,
    stats: statsR.status === "fulfilled" ? statsR.value : null,
    dom: domR.status === "fulfilled" ? domR.value : null,
    cuts: cutsR.status === "fulfilled" ? cutsR.value : null,
    dynamics: dynR.status === "fulfilled" ? dynR.value : null,
    rental: rentR.status === "fulfilled" ? rentR.value : null,
    avm: avmR.status === "fulfilled" ? avmR.value : null,
    inventory: invR.status === "fulfilled" ? invR.value : null,
    seasonality: seasR.status === "fulfilled" ? seasR.value : null,
    outcomes: outcR.status === "fulfilled" ? outcR.value : null,
    ledger: ledgR.status === "fulfilled" ? ledgR.value : null,
  });

  return <AnalyticsClient initial={initial} />;
}

/** Lightweight above-the-fold skeleton shown while AnalyticsData streams. Theme-aware. */
function AnalyticsSkeleton() {
  const box = "animate-pulse rounded-lg bg-black/5 dark:bg-white/10";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" aria-hidden>
      <div className={`${box} h-8 w-56`} />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={`${box} h-20`} />
        ))}
      </div>
      <div className={`${box} mt-4 h-64 w-full`} />
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className={`${box} h-48`} />
        <div className={`${box} h-48`} />
      </div>
    </div>
  );
}
