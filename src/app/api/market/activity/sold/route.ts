/**
 * GET /api/market/activity/sold
 *
 * Recently-SOLD (VOW) count + capped list for one market area under the dashboard
 * Market Activity lens. Powers the "Sold" column of the dashboard activity panel —
 * the just-sold comps HouseSigma shows but Realtor.ca hides.
 *
 * Reads raw_vow_sold (read-only, RLS — CLAUDE.md §12) via the service-role client.
 * Window is keyed on `purchase_contract_date` — the deal-signed ("sold firm")
 * date, which is the true SOLD date. (close_date is the completion/possession
 * date and can be months later, so it misrepresents WHEN a home sold.) Tradeoff:
 * the VOW feed reports sold deals with a lag, so very recent windows (1-7d) under-
 * count and fill in over the following weeks. We bound `lte now` for safety.
 *
 * Compliance: count tiles are unrestricted, but the displayed LIST hard-caps at
 * 100 rows (TRREB §6.3(b)); every row carries the listing brokerage. Wrapped in
 * unstable_cache (24h) so repeated dashboard loads never re-scan the 217k-row
 * table — the data only refreshes daily and the Supabase IO budget is finite
 * (memory supabase-io-budget). All filtering is deterministic SQL (no AI, §4).
 *
 * Query params:
 *   region (required), windowDays, types (comma keys), minBeds, minBaths,
 *   minGarage, basement (1/0), minFrontage, limit.
 */

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { variantsForKeys } from "@/lib/dashboard/propertyTypes";

export const dynamic = "force-dynamic"; // caching handled per-key by unstable_cache

const MAX_WINDOW_DAYS = 180;
const MAX_LIST = 100; // TRREB per-query display cap
const PRICE_FLOOR = 50000; // excludes lease/rental rows leaking into the sold feed

const LIST_COLUMNS =
  "listing_key, unparsed_address, close_price, list_price, purchase_contract_date, " +
  "property_sub_type, bedrooms_above_grade, bathrooms_total_integer, building_area_total, " +
  "city, brokerage:raw_payload->>ListOfficeName";

interface SoldParams {
  region: string;
  windowDays: number;
  typeKeys: string[];
  minBeds: number;
  minBaths: number;
  minGarage: number;
  basementFinished: boolean;
  minFrontage: number;
  limit: number;
}

export interface SoldListing {
  id: string;
  address: string;
  closePrice: number;
  listPrice: number | null;
  soldDate: string | null;
  propertySubType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  brokerage: string | null;
  city: string | null;
}

/** A PostgREST query builder for raw_vow_sold (select already applied). */
type SoldBuilder = ReturnType<
  ReturnType<ReturnType<typeof getServiceRoleClient>["from"]>["select"]
>;

/** Apply the lens filters shared by the count query and the list query. */
function applyFilters(
  q: SoldBuilder,
  p: SoldParams,
  cutoffISO: string,
  nowISO: string
): SoldBuilder {
  const safe = p.region.replace(/[,()]/g, " ").trim();
  // Sold window keyed on purchase_contract_date (the "sold firm" date) in
  // [now-Nd, now]. The upper bound is defensive (contract dates aren't future).
  q = q
    .or(`city.ilike.${safe},city_region.ilike.${safe}`)
    .gte("close_price", PRICE_FLOOR)
    .gte("purchase_contract_date", cutoffISO)
    .lte("purchase_contract_date", nowISO);

  const variants = variantsForKeys(p.typeKeys);
  if (variants.length > 0) q = q.in("property_sub_type", variants);
  if (p.minBeds > 0) q = q.gte("bedrooms_above_grade", p.minBeds);
  if (p.minBaths > 0) q = q.gte("bathrooms_total_integer", p.minBaths);
  if (p.minGarage > 0) q = q.gte("parking_total", p.minGarage);
  if (p.basementFinished) q = q.eq("has_finished_basement", true);
  if (p.minFrontage > 0) q = q.gte("lot_width", p.minFrontage);
  return q;
}

async function computeSold(
  p: SoldParams
): Promise<{ count: number; listings: SoldListing[] }> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - p.windowDays);
  const cutoffISO = cutoff.toISOString();
  const nowISO = now.toISOString();

  const sb = getServiceRoleClient();

  // 1) Exact count — head:true returns no rows (cheap, no payload transfer).
  const { count, error: countErr } = await applyFilters(
    sb.from("raw_vow_sold").select("listing_key", { count: "exact", head: true }),
    p,
    cutoffISO,
    nowISO
  );
  if (countErr) throw new Error(countErr.message);

  // 2) Capped list — extracts ListOfficeName from JSONB server-side (no full blob).
  const { data, error: listErr } = await applyFilters(
    sb.from("raw_vow_sold").select(LIST_COLUMNS),
    p,
    cutoffISO,
    nowISO
  )
    .order("purchase_contract_date", { ascending: false })
    .limit(p.limit);
  if (listErr) throw new Error(listErr.message);

  const listings: SoldListing[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.listing_key ?? ""),
      address: (row.unparsed_address as string) ?? "",
      closePrice: Number(row.close_price) || 0,
      listPrice: row.list_price != null ? Number(row.list_price) : null,
      soldDate: (row.purchase_contract_date as string) ?? null,
      propertySubType: (row.property_sub_type as string) ?? null,
      beds: row.bedrooms_above_grade != null ? Number(row.bedrooms_above_grade) : null,
      baths:
        row.bathrooms_total_integer != null ? Number(row.bathrooms_total_integer) : null,
      sqft: row.building_area_total != null ? Number(row.building_area_total) : null,
      brokerage: (row.brokerage as string) ?? null,
      city: (row.city as string) ?? null,
    };
  });

  return { count: count ?? 0, listings };
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const region = (sp.get("region") || "").trim();
  if (!region) return NextResponse.json({ region: "", count: 0, listings: [] });

  const num = (k: string, d = 0) => {
    const n = Number(sp.get(k));
    return Number.isFinite(n) && n > 0 ? n : d;
  };

  const params: SoldParams = {
    region,
    windowDays: Math.min(num("windowDays", 1), MAX_WINDOW_DAYS),
    typeKeys: (sp.get("types") || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBeds: num("minBeds"),
    minBaths: num("minBaths"),
    minGarage: num("minGarage"),
    basementFinished: sp.get("basement") === "1",
    minFrontage: num("minFrontage"),
    limit: Math.min(num("limit", 5), MAX_LIST),
  };

  try {
    const key = JSON.stringify({ ...params, region: region.toLowerCase() });
    const result = await unstable_cache(() => computeSold(params), ["market-activity-sold", key], {
      revalidate: 86400,
    })();
    return NextResponse.json({ region, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/activity/sold]", region, msg);
    return NextResponse.json({ region, count: 0, listings: [], error: msg }, { status: 500 });
  }
}
