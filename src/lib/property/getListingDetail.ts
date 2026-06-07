/**
 * getListingDetail — shared server-side fetch for a single listing.
 *
 * Returns the raw listing payload plus best-effort PureProperty Estimate (AVM)
 * and Condo Fee Stability. Wrapped in React `cache()` so a Server Component and
 * its `generateMetadata` share ONE Supabase round-trip per request.
 *
 * Source: the `listings` table (active IDX feed) via the service-role client.
 * Sold/VOW data lives elsewhere and is never served here.
 */

import { cache } from "react";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { searchListings } from "@/lib/typesense/client";
import { capRateOrNull } from "@/lib/metrics/sanityBand";
import { calculateAVM } from "@/lib/avm/calculator";
import { mapListingToAVMInput } from "@/lib/avm/mapListingToAVMInput";
import { resolveLivingArea, type BucketCalibration } from "@/lib/avm/livingArea";
import { normalizePropertySubType } from "@/lib/avm/normalizeType";
import type { AVMResult } from "@/lib/avm/types";
import {
  isCondo,
  buildFeeStabilityResult,
  type FeeStabilityResult,
  type AreaStats,
  type CorpStats,
  type TrendBucket,
} from "@/lib/condo/feeStability";
import { computeDealScore, type DealScoreResult } from "@/lib/dealScore/computeDealScore";
import { generatePropertyHash } from "@/lib/typesense/TemporalDistressEngine";
import { ProptXClient } from "@/lib/proptx/client";
import type { RoomData } from "@/lib/room-utils";
import { fetchValueAddReport } from "@/lib/avm/valueAdd/engine";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";

/** One prior sold campaign for this physical property (from property_sale_history). */
export interface SaleEvent {
  listing_key: string;
  list_price: number | null;
  close_price: number | null;
  contract_date: string | null;
  close_date: string | null;
  sub_type: string | null;
}

/**
 * Prior-sale ledger. `events` carries the VOW-sensitive sold prices/dates and is
 * stripped for anonymous users at the API/page boundary (see route.ts); `saleCount`
 * stays so the UI can render blurred placeholder rows + a sign-in CTA.
 */
export interface SaleHistory {
  available: boolean;
  saleCount: number;
  events: SaleEvent[];
  lastClosePrice: number | null;
  lastCloseDate: string | null;
}

/**
 * List-price movement for the listing (IDX-class data, not gated). Sold prices/dates
 * never appear here — those live in SaleHistory.events.
 */
export interface PriceTimeline {
  currentPrice: number | null;
  /** First asking in the chain (list price); null when there's no recorded change. */
  originalPrice: number | null;
  /** Cumulative $ off the original asking (≥0). */
  totalPriceDrop: number;
  /** True DOM (stitched across relists); falls back to derived DOM. */
  trueDom: number | null;
}

/**
 * VOW gating (CLAUDE.md §4): strip sold prices/dates for anonymous users, keeping
 * only `saleCount` so the UI can render blurred placeholder rows + a sign-in CTA.
 * Apply at every server→client boundary (API route + server page).
 */
export function gateSaleHistory(sh: SaleHistory, isAuthed: boolean): SaleHistory {
  if (isAuthed) return sh;
  return {
    available: sh.available,
    saleCount: sh.saleCount,
    events: [],
    lastClosePrice: null,
    lastCloseDate: null,
  };
}

/**
 * VOW gating for DERIVED metrics (CLAUDE.md §4; VOW agreement §6.2(f) — derivative
 * analytics only "on their VOW(s)"). The AVM estimate, Value-Add report, Deal Score
 * (it embeds the AVM) and the stitched True DOM are all built from VOW sold data, so
 * for anonymous users we null them (the numbers never reach the client) and the UI
 * renders a blurred "Login Required" teaser. Folds in gateSaleHistory and strips the
 * VOW-stitched `true_dom` from the raw payload too (the property API ships full_payload),
 * so ONE call fully de-VOWs a ListingDetail. IDX list-price movement stays intact.
 */
export function gateVowDerived(detail: ListingDetail, isAuthed: boolean): ListingDetail {
  if (isAuthed) return detail;
  const gatedPayload = { ...(detail.full_payload as Record<string, unknown>) };
  delete gatedPayload.true_dom; // VOW-stitched; raw DaysOnMarket (IDX) stays
  return {
    ...detail,
    full_payload: gatedPayload,
    estimate: null,
    valueAdd: null,
    dealScore: { score: null, grade: null, verdict: "", components: [] },
    saleHistory: gateSaleHistory(detail.saleHistory, false),
    priceTimeline: { ...detail.priceTimeline, trueDom: null },
  };
}

export interface ListingDetail {
  listing_key: string;
  full_payload: Record<string, unknown>;
  media_urls: string[];
  city: string | null;
  property_sub_type: string | null;
  synced_at: string | null;
  estimate: AVMResult | null;
  valueAdd: ValueAddReport | null;
  feeStability: FeeStabilityResult;
  dealScore: DealScoreResult;
  saleHistory: SaleHistory;
  priceTimeline: PriceTimeline;
  /** Per-room dimensions (live ProptX /PropertyRooms; best-effort, [] on miss/failure). */
  rooms: RoomData[];
}

/** Days on market: prefer the feed's DaysOnMarket, else derive from entry timestamp. */
function deriveDomDays(payload: Record<string, unknown>): number | null {
  const dom = payload["DaysOnMarket"];
  if (typeof dom === "number" && dom >= 0) return dom;
  const ts = payload["OriginalEntryTimestamp"];
  if (typeof ts === "string" && ts) {
    const diff = Date.now() - new Date(ts).getTime();
    if (Number.isFinite(diff)) return Math.max(0, Math.ceil(diff / 86_400_000) - 1);
  }
  return null;
}

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  });
  return Promise.race([promise, timeout]);
}

/**
 * Per-room dimensions are NOT in the stored `listings.full_payload` — they're a
 * separate ProptX resource (/PropertyRooms). Fetch them live, best-effort: any
 * failure/timeout degrades to [] so the page still renders. Prefer the IDX token
 * (the detail page serves active listings); fall back to VOW.
 */
async function fetchListingRooms(listingKey: string): Promise<RoomData[]> {
  const idx = process.env.PROPTX_IDX_TOKEN;
  const vow = process.env.PROPTX_VOW_TOKEN;
  const token = idx || vow;
  if (!token) return [];
  try {
    const client = new ProptXClient(token, idx ? "IDX" : "VOW");
    const res = await withTimeout(client.getRooms(listingKey), 6000, "Rooms");
    const value = Array.isArray(res?.value) ? res.value : [];
    return value.map((r) => ({
      RoomKey: r.RoomKey,
      RoomType: r.RoomType,
      RoomLevel: r.RoomLevel,
      RoomLength: r.RoomLength,
      RoomWidth: r.RoomWidth,
      RoomDimensions: r.RoomDimensions,
      RoomFeatures: r.RoomFeatures,
    }));
  } catch (roomsErr) {
    console.error(`[getListingDetail] Rooms fetch failed for ${listingKey}:`, roomsErr);
    return [];
  }
}

/**
 * Fetch one listing by its TRREB ListingKey. Returns null when the listing is
 * not in the database (caller decides whether to 404 or trigger a quick-sync).
 */
export const getListingDetail = cache(
  async (listingKey: string): Promise<ListingDetail | null> => {
    const supabase = getServiceRoleClient();

    const { data: listing, error } = await withTimeout(
      supabase
        .from("listings")
        .select("*")
        .eq("listing_key", listingKey)
        .maybeSingle(),
      10000,
      "Supabase query"
    );

    if (error) {
      throw new Error(`Database query failed: ${error.message}`);
    }
    if (!listing) {
      return null;
    }

    // Prefer per-room dimensions already persisted into full_payload by the ETL
    // (ingester enriches active listings via /PropertyRooms) — no external call.
    // Rows synced before room-ingestion, and sold listings, fall back to the live
    // /PropertyRooms fetch (kicked off in parallel, awaited just before return).
    const storedRooms: RoomData[] = Array.isArray((listing.full_payload as Record<string, unknown>)?.["rooms"])
      ? ((listing.full_payload as Record<string, unknown>)["rooms"] as RoomData[])
      : [];
    const roomsPromise: Promise<RoomData[]> =
      storedRooms.length > 0 ? Promise.resolve(storedRooms) : fetchListingRooms(listingKey);

    // Real cap rate (Typesense doc; full_payload lacks the derived metric). Fire it
    // off here so it overlaps the AVM / fee / room fetches instead of serializing
    // onto TTFB. Best-effort: resolves null on miss/timeout, never rejects.
    const capRatePromise: Promise<number | null> = withTimeout(
      searchListings({ query: "*", rawFilterBy: `id:=\`${listingKey}\``, perPage: 1 }),
      4000,
      "CapRate"
    )
      .then((r) => capRateOrNull(r.listings[0]?.cap_rate_est))
      .catch((capErr) => {
        console.error(`[getListingDetail] cap_rate lookup failed for ${listingKey}:`, capErr);
        return null;
      });

    // Resolve rooms before the AVM: room dimensions are the AVM's best square-
    // footage signal (BuildingAreaTotal is ~never filled for houses). Best-effort,
    // so failure → [] and the AVM falls back to the calibrated bucket / midpoint.
    const rooms: RoomData[] = await roomsPromise;

    // Best-effort PureProperty Estimate (AVM). Never blocks the listing.
    let estimate: AVMResult | null = null;
    let valueAdd: ValueAddReport | null = null;
    try {
      const payload = listing.full_payload as Record<string, unknown> | null;

      // Only when room dimensions don't yield a measured size do we fall back to
      // the calibrated bucket → one indexed PK point-lookup, skipped on the common
      // (measured) path so we don't add a query per page.
      let bucketCalibration: BucketCalibration | null = null;
      if (resolveLivingArea(payload, { rooms }).source === "range_midpoint") {
        const cityRegion = String(payload?.["CityRegion"] ?? "").trim();
        const subType = normalizePropertySubType(
          typeof payload?.["PropertySubType"] === "string" ? (payload["PropertySubType"] as string) : ""
        );
        const bucket = String(payload?.["LivingAreaRange"] ?? "").trim();
        if (cityRegion && subType && bucket) {
          try {
            const { data: cal } = await supabase
              .from("avm_sqft_calibration")
              .select("median_gla, sample_count")
              .eq("city_region", cityRegion)
              .eq("property_sub_type", subType)
              .eq("living_area_range", bucket)
              .maybeSingle();
            if (cal && Number(cal.median_gla) > 0) {
              bucketCalibration = {
                medianGla: Number(cal.median_gla),
                sampleCount: Number(cal.sample_count) || 0,
              };
            }
          } catch (calError) {
            console.error(`[getListingDetail] sqft calibration lookup failed for ${listingKey}:`, calError);
          }
        }
      }

      const avmInput = mapListingToAVMInput(payload, { rooms, bucketCalibration });
      if (avmInput) {
        estimate = await withTimeout(calculateAVM(supabase, avmInput), 8000, "AVM");
        if (estimate && estimate.estimatedValue > 0) {
          try {
            valueAdd = await withTimeout(
              fetchValueAddReport(supabase, avmInput, {
                subjectEstimate: estimate.estimatedValue,
                predSD: estimate.predictiveSD,
              }),
              8000,
              "Value-Add"
            );
          } catch (vaErr) {
            console.error(`[getListingDetail] Value-Add failed for ${listingKey}:`, vaErr);
          }
        }
      }
    } catch (avmError) {
      console.error(`[getListingDetail] AVM failed for ${listingKey}:`, avmError);
    }

    // Best-effort Condo Fee Stability. Two indexed point-lookups on the
    // precomputed condo_fee_stats table — never scans raw_vow_sold at request time.
    let feeStability: FeeStabilityResult = { available: false, trend: null };
    try {
      const payload = listing.full_payload as Record<string, unknown> | null;
      if (isCondo(payload)) {
        const cityRegion = String(payload?.["CityRegion"] ?? "").trim();
        const subType = String(payload?.["PropertySubType"] ?? "").trim();
        const corpRaw = payload?.["CondoCorpNumber"];
        const corpKey =
          corpRaw === null || corpRaw === undefined ? "" : String(corpRaw).trim();

        const [areaRes, corpRes] = await Promise.all([
          cityRegion && subType
            ? supabase
                .from("condo_fee_stats")
                .select("median_fee_psf, p25_fee_psf, p75_fee_psf, sample_count, inclusions_mixed")
                .eq("cohort_type", "area")
                .eq("cohort_key", cityRegion)
                .eq("property_sub_type", subType)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          corpKey && corpKey !== "0"
            ? supabase
                .from("condo_fee_stats")
                .select("trend_buckets, pct_change_24mo, sample_count, inclusions_mixed")
                .eq("cohort_type", "corp")
                .eq("cohort_key", corpKey)
                .eq("property_sub_type", "ALL")
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        const areaRow = areaRes.data as Record<string, unknown> | null;
        const area: AreaStats | null = areaRow
          ? {
              medianPsf: Number(areaRow.median_fee_psf),
              p25Psf: Number(areaRow.p25_fee_psf),
              p75Psf: Number(areaRow.p75_fee_psf),
              sampleCount: Number(areaRow.sample_count),
              inclusionsMixed: areaRow.inclusions_mixed === true,
            }
          : null;

        const corpRow = corpRes.data as Record<string, unknown> | null;
        const corp: CorpStats | null = corpRow
          ? {
              buckets: (corpRow.trend_buckets as TrendBucket[]) ?? [],
              pctChange24mo: Number(corpRow.pct_change_24mo),
              sampleCount: Number(corpRow.sample_count),
              inclusionsMixed: corpRow.inclusions_mixed === true,
            }
          : null;

        feeStability = buildFeeStabilityResult({ payload, cityRegion, area, corp });
      }
    } catch (feeError) {
      console.error(`[getListingDetail] Fee stability failed for ${listingKey}:`, feeError);
    }

    // Deal Score — deterministic 0–100 score over already-derived metrics (§4: no LLM).
    const payload = (listing.full_payload as Record<string, unknown>) ?? {};
    const listPrice =
      typeof payload["ListPrice"] === "number" ? (payload["ListPrice"] as number) : null;
    const originalListPrice =
      typeof payload["OriginalListPrice"] === "number"
        ? (payload["OriginalListPrice"] as number)
        : null;
    const realCapRate = await capRatePromise;

    const dealScore = computeDealScore({
      listPrice,
      originalListPrice,
      avmEstimate: estimate
        ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
        : null,
      domDays: deriveDomDays(payload),
      capRatePct: realCapRate,
    });

    // Best-effort prior-sale ledger — ONE indexed PK point-lookup on the precomputed
    // property_sale_history table (never scans raw_vow_sold at request time, §12/Disk IO).
    let saleHistory: SaleHistory = {
      available: false,
      saleCount: 0,
      events: [],
      lastClosePrice: null,
      lastCloseDate: null,
    };
    try {
      const propertyHash =
        (typeof listing.property_hash === "string" && listing.property_hash) ||
        generatePropertyHash(payload);
      if (propertyHash) {
        const { data: shRow } = await withTimeout(
          supabase
            .from("property_sale_history")
            .select("sale_events, sale_count, last_close_price, last_close_date")
            .eq("property_hash", propertyHash)
            .maybeSingle(),
          8000,
          "Sale history"
        );
        if (shRow) {
          const events = (shRow.sale_events as SaleEvent[]) ?? [];
          saleHistory = {
            available: events.length > 0,
            saleCount: Number(shRow.sale_count) || events.length,
            events,
            lastClosePrice:
              shRow.last_close_price != null ? Number(shRow.last_close_price) : null,
            lastCloseDate: (shRow.last_close_date as string) ?? null,
          };
        }
      }
    } catch (saleErr) {
      console.error(`[getListingDetail] Sale history failed for ${listingKey}:`, saleErr);
    }

    // Price timeline — list-price movement only (IDX-class). total_price_drop / true_dom
    // are the deterministic fields the Temporal Distress Engine persisted to full_payload.
    const totalPriceDrop =
      typeof payload["total_price_drop"] === "number" && payload["total_price_drop"] > 0
        ? (payload["total_price_drop"] as number)
        : 0;
    const trueDom =
      typeof payload["true_dom"] === "number"
        ? (payload["true_dom"] as number)
        : deriveDomDays(payload);
    const originalPrice =
      originalListPrice && listPrice && originalListPrice > listPrice
        ? originalListPrice
        : totalPriceDrop > 0 && listPrice
          ? listPrice + totalPriceDrop
          : null;
    const priceTimeline: PriceTimeline = {
      currentPrice: listPrice,
      originalPrice,
      totalPriceDrop,
      trueDom,
    };

    return {
      listing_key: listing.listing_key,
      full_payload: payload,
      media_urls: listing.media_urls || [],
      city: listing.city ?? null,
      property_sub_type: listing.property_sub_type ?? null,
      synced_at: listing.synced_at ?? null,
      estimate,
      valueAdd,
      feeStability,
      dealScore,
      saleHistory,
      priceTimeline,
      rooms,
    };
  }
);
