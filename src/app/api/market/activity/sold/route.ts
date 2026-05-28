/**
 * GET /api/market/activity/sold
 *
 * Recently-SOLD (VOW) count + capped list for one market area under the dashboard
 * Market Activity lens. Powers the "Sold" column — the just-sold comps HouseSigma
 * shows and Realtor.ca hides.
 *
 * DATA PATH: queries the bounded `sold_listings` Typesense collection (in-memory,
 * ~tens of ms), NOT Supabase. The collection holds a rolling 180-day window indexed
 * by the ETL worker (scripts/worker/soldIndexer.ts); the full ~217k historical record
 * stays in `raw_vow_sold` for AVM. This replaced a direct `raw_vow_sold` scan that
 * did a full sequential scan (~2-8s) plus a per-request JSONB detoast.
 *
 * COMPLIANCE: VOW sold has stricter display rules than IDX, so this collection is read
 * SERVER-SIDE ONLY using the admin key (never the public browser search key). The list
 * is hard-capped at 100 rows (TRREB §6.3(b)); the count tile is unrestricted. Every row
 * carries the listing brokerage (ListOfficeName). All filtering is deterministic (§4).
 *
 * The window is keyed on `PurchaseContractDate` (epoch ms) — the deal-signed ("sold
 * firm") date, the true SOLD date. The VOW feed reports sold deals with a lag, so very
 * recent windows (1-7d) undercount and fill in over the following weeks.
 *
 * Query params: region (required), windowDays, types (comma keys), minBeds, minBaths,
 *   minGarage, basement (1/0), minFrontage, limit.
 */

import { NextRequest, NextResponse } from "next/server";
import Typesense, { Client } from "typesense";
import { variantsForKeys } from "@/lib/dashboard/propertyTypes";
import { SOLD_LISTINGS_COLLECTION } from "@/lib/typesense/soldListingsSchema";

export const dynamic = "force-dynamic";

const MAX_WINDOW_DAYS = 180;
const MAX_LIST = 100; // TRREB per-query display cap
const PRICE_FLOOR = 50000; // excludes lease/rental rows leaking into the sold feed
const DAY_MS = 86_400_000;

const TYPESENSE_HOST = "9uyapwh6e5qmvl34p-1.a1.typesense.net";
const TYPESENSE_PORT = 443;

let soldClient: Client | null = null;

/** Server-only Typesense client (admin key) — must never run in the browser. */
function getSoldClient(): Client {
  if (!soldClient) {
    const key = process.env.TYPESENSE_ADMIN_API_KEY;
    if (!key) throw new Error("TYPESENSE_ADMIN_API_KEY is not set");
    soldClient = new Typesense.Client({
      nodes: [{ host: TYPESENSE_HOST, port: TYPESENSE_PORT, protocol: "https" }],
      apiKey: key,
      connectionTimeoutSeconds: 10,
    });
  }
  return soldClient;
}

/**
 * Area scoping for a sold query. Exactly one variant must be set; precedence at
 * the call site (GET handler) is polygon > nearby_school > region so a caller
 * accidentally passing multiple gets the most-specific filter.
 *
 *   - region:        traditional city/neighbourhood scoping (existing behaviour)
 *   - polygon:       [lat, lng, lat, lng, ...] from a draw / commute bubble
 *   - nearbySchool:  exact NearbySchools id (school catchment bubble)
 */
type SoldArea =
  | { kind: "region"; region: string }
  | { kind: "polygon"; polygon: [number, number][] }
  | { kind: "school"; schoolKey: string };

interface SoldParams {
  area: SoldArea;
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
  /** Best-fit thumbnail URL (selectPrimaryImage), null when no usable VOW media. */
  primaryImageUrl: string | null;
}

/** Build the Typesense area clause (one per kind) — see SoldArea docstring. */
function buildAreaClause(area: SoldArea): string {
  if (area.kind === "polygon") {
    const coords = area.polygon.map(([lat, lng]) => `${lat}, ${lng}`).join(", ");
    return `location:(${coords})`;
  }
  if (area.kind === "school") {
    const safe = area.schoolKey.replace(/`/g, "");
    return `NearbySchools:=\`${safe}\``;
  }
  const safe = area.region.replace(/`/g, "");
  return `(City:=\`${safe}\` || CityRegion:=\`${safe}\`)`;
}

/** Build the Typesense filter_by string for the sold lens (mirrors buildActivityFilter). */
function buildSoldFilter(p: SoldParams): string {
  const cutoffMs = Math.floor(Date.now() - p.windowDays * DAY_MS);
  const clauses: string[] = [
    buildAreaClause(p.area),
    `PurchaseContractDate:>=${cutoffMs}`,
    `PurchaseContractDate:<=${Date.now()}`, // defensive: no future contract dates
    `ClosePrice:>=${PRICE_FLOOR}`,
  ];

  const variants = variantsForKeys(p.typeKeys);
  if (variants.length > 0) {
    const ors = variants.map((v) => `PropertySubType:=\`${v.replace(/`/g, "")}\``);
    clauses.push(`(${ors.join(" || ")})`);
  }
  if (p.minBeds > 0) clauses.push(`BedroomsTotal:>=${p.minBeds}`);
  if (p.minBaths > 0) clauses.push(`BathroomsTotalInteger:>=${p.minBaths}`);
  if (p.minGarage > 0) clauses.push(`ParkingTotal:>=${p.minGarage}`);
  // BasementTier 1-5 = finished/partially-finished space (deterministic tier).
  if (p.basementFinished) clauses.push(`BasementTier:<=5`);
  if (p.minFrontage > 0) clauses.push(`LotWidth:>=${p.minFrontage}`);

  return clauses.join(" && ");
}

/**
 * Parse a flat `lat,lng,lat,lng,...` polygon param. Returns null on any shape
 * issue (odd count, < 3 vertices, non-finite values) so the caller can fail
 * the request cleanly rather than ship a degenerate filter to Typesense.
 */
function parsePolygonParam(raw: string): [number, number][] | null {
  const nums = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  if (nums.length % 2 !== 0) return null;
  if (nums.length < 6) return null; // ≥ 3 vertices required by Typesense
  const out: [number, number][] = [];
  for (let i = 0; i < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

const posOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function computeSold(
  p: SoldParams
): Promise<{ count: number; listings: SoldListing[] }> {
  // A single Typesense search returns BOTH the total match count (`found`,
  // unrestricted — for the tile) and the capped hit list (per_page ≤ 100).
  const res = await getSoldClient()
    .collections(SOLD_LISTINGS_COLLECTION)
    .documents()
    .search({
      q: "*",
      query_by: "UnparsedAddress", // required syntactically; ignored for q:"*"
      filter_by: buildSoldFilter(p),
      sort_by: "PurchaseContractDate:desc",
      per_page: p.limit,
      page: 1,
    });

  const listings: SoldListing[] = (res.hits ?? []).map((h) => {
    const d = h.document as Record<string, unknown>;
    const ms = Number(d.PurchaseContractDate);
    return {
      id: String(d.id ?? ""),
      address: (d.UnparsedAddress as string) || "",
      closePrice: Number(d.ClosePrice) || 0,
      listPrice: posOrNull(d.ListPrice),
      soldDate: Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null,
      propertySubType: (d.PropertySubType as string) || null,
      beds: posOrNull(d.BedroomsTotal),
      baths: posOrNull(d.BathroomsTotalInteger),
      sqft: posOrNull(d.BuildingAreaTotal),
      brokerage: (d.ListOfficeName as string) || null,
      city: (d.City as string) || null,
      primaryImageUrl: (d.primaryImageUrl as string) || null,
    };
  });

  return { count: res.found ?? 0, listings };
}

/** Precedence: polygon > nearby_school > region. Returns null if none supplied. */
function pickArea(sp: URLSearchParams): SoldArea | null {
  const polygonRaw = sp.get("polygon");
  if (polygonRaw && polygonRaw.trim()) {
    const polygon = parsePolygonParam(polygonRaw);
    if (polygon) return { kind: "polygon", polygon };
  }
  const schoolKey = (sp.get("nearby_school") || "").trim();
  if (schoolKey) return { kind: "school", schoolKey };

  const region = (sp.get("region") || "").trim();
  if (region) return { kind: "region", region };
  return null;
}

function areaLabel(area: SoldArea): string {
  if (area.kind === "region") return area.region;
  if (area.kind === "school") return `school:${area.schoolKey}`;
  return `polygon:${area.polygon.length}pts`;
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const area = pickArea(sp);
  // Backwards-compatible empty response: callers passing no area get the same
  // shape (with `region: ""`) they used to get pre-Phase-2B.
  if (!area)
    return NextResponse.json({ region: "", count: 0, listings: [] });

  const num = (k: string, d = 0) => {
    const n = Number(sp.get(k));
    return Number.isFinite(n) && n > 0 ? n : d;
  };

  const params: SoldParams = {
    area,
    windowDays: Math.min(num("windowDays", 1), MAX_WINDOW_DAYS),
    typeKeys: (sp.get("types") || "").split(",").map((s) => s.trim()).filter(Boolean),
    minBeds: num("minBeds"),
    minBaths: num("minBaths"),
    minGarage: num("minGarage"),
    basementFinished: sp.get("basement") === "1",
    minFrontage: num("minFrontage"),
    limit: Math.min(num("limit", 5), MAX_LIST),
  };

  // Echo the original `region` value (or "" for non-region areas) so the
  // existing client response shape is preserved.
  const regionEcho = area.kind === "region" ? area.region : "";

  try {
    const result = await computeSold(params);
    return NextResponse.json({ region: regionEcho, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[market/activity/sold]", areaLabel(area), msg);
    return NextResponse.json(
      { region: regionEcho, count: 0, listings: [], error: msg },
      { status: 500 }
    );
  }
}
