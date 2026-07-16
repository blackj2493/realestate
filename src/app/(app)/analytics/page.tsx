/**
 * /analytics — Market Trends terminal. Real per-region sold/active aggregates
 * (median price, $/sqft, sold-to-list, months of inventory, temperature) from
 * the two cached market endpoints. This surface is VOW-derived (raw_vow_sold
 * trends), so it is gated by the same server-side session check as /dashboard
 * (CLAUDE.md §3A) — and both endpoints independently return a locked shape for
 * anonymous callers as defense in depth.
 *
 * The default/selected scope is prefetched server-side (the gate has already proven
 * the caller is a consumer) and handed to AnalyticsClient as `initial`, so the
 * above-the-fold KPIs paint immediately instead of waiting on a client round-trip.
 */

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
  ZERO_SCOPE,
} from "@/lib/market/aggregates";
import AnalyticsClient, { type AnalyticsInitial } from "./AnalyticsClient";
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

  // Prefetch behind the (already-passed) consumer gate. Best-effort: if either RPC is
  // unavailable (e.g. migration 040 not yet applied), fall back to a client fetch.
  let initial: AnalyticsInitial | undefined;
  if (REGION_RE.test(region)) {
    const [trendR, statsR, domR, cutsR, dynR, rentR, avmR] = await Promise.allSettled([
      getTrendCached(region, typeKeys, ZERO_SCOPE),
      getStatsCached(region, typeKeys, ZERO_SCOPE),
      getDomDistCached(region, typeKeys, ZERO_SCOPE),
      getPriceCutsCached(region, typeKeys, ZERO_SCOPE),
      getSoldDynamicsCached(region, typeKeys, ZERO_SCOPE),
      getRentalYieldCached(region, typeKeys),
      getAvmReliabilityCached(region, typeKeys),
    ]);
    const trend = trendR.status === "fulfilled" ? trendR.value : null;
    const stats = statsR.status === "fulfilled" ? statsR.value : null;
    const dom = domR.status === "fulfilled" ? domR.value : null;
    const cuts = cutsR.status === "fulfilled" ? cutsR.value : null;
    const dynamics = dynR.status === "fulfilled" ? dynR.value : null;
    const rental = rentR.status === "fulfilled" ? rentR.value : null;
    const avm = avmR.status === "fulfilled" ? avmR.value : null;
    if (trend || stats || dom || cuts || dynamics || rental || avm) {
      initial = {
        region,
        typeKeys,
        trend: trend ? { region, points: trend.points, summary: trend.summary } : null,
        stats: stats ? { region, stats } : null,
        dom: dom ? { region, dom } : null,
        cuts: cuts ? { region, cuts } : null,
        dynamics: dynamics ? { region, dynamics } : null,
        rental: rental ? { region, rental } : null,
        avm: avm ? { region, avm } : null,
      };
    }
  }

  return (
    <>
      {/* Zoom out: rank every GTA market, then drill into one below. */}
      <SubmarketLeaderboard />
      <AnalyticsClient initial={initial} />
    </>
  );
}
