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

import { cache as reactCache } from "react";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { getSoldPhotoUrls } from "@/lib/property/soldPhotos";
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
  corpCohortKey,
  type FeeStabilityResult,
  type AreaStats,
  type CorpStats,
  type TrendBucket,
} from "@/lib/condo/feeStability";
import { computeDealScore, EMPTY_DEAL_SCORE, type DealScoreResult } from "@/lib/dealScore/computeDealScore";
import { generatePropertyHash } from "@/lib/typesense/TemporalDistressEngine";
import { ProptXClient } from "@/lib/proptx/client";
import type { RoomData } from "@/lib/room-utils";
import { fetchValueAddReport } from "@/lib/avm/valueAdd/engine";
import type { ValueAddReport } from "@/lib/avm/valueAdd/types";
import { refreshCampaignHistoryForListing } from "@/lib/campaignHistory/store";
import {
  toCampaignHistoryView,
  gateCampaignHistory,
  latestCloseFromCampaigns,
  type CampaignHistoryView,
} from "@/lib/campaignHistory/view";
import { normalizeCampaign, type RawVowCampaign } from "@/lib/campaignHistory/normalize";
import { getCloseListRatio } from "@/lib/property/getCloseListRatio";
import { computeExpectedSale, type ExpectedSale } from "@/lib/avm/expectedSale";
import {
  resolveListingStatus,
  fillClosePriceFromSaleHistory,
  pickSoldAccuracy,
  gateListingStatus,
  type DelistedRowLite,
  type ListingStatus,
  type SoldAccuracy,
} from "@/lib/property/listingStatus";
import type { DiligenceFlag } from "@/lib/property/diligence";

// react.cache is a Server-Components API: present under the Next runtime, undefined
// when a plain-node script (tsx) imports this module (e.g. scripts/demos/make-fixture.ts).
// Fall back to identity there — scripts don't need request-level memoization.
const cache: typeof reactCache =
  typeof reactCache === "function" ? reactCache : (((fn: unknown) => fn) as typeof reactCache);

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
 *
 * PHOTOS ON SOLD/OFF-MARKET RECORDS are gated here too. They are VOW Listing Information —
 * /address has always treated them that way ("The URL itself is a VOW field and is
 * discarded server-side", soldByKey.ts) — but this page shipped them to anonymous users,
 * so the two public surfaces disagreed about the same photo of the same home. The count
 * survives as `photoTeaser` so the UI can show a blurred, locked gallery rather than an
 * empty box: an honest "there are 17 photos here" without carrying one.
 *
 * ACTIVE listings are untouched. Their photos are IDX, are meant to be public, and are the
 * main reason anyone finds the site.
 */
export function gateVowDerived(detail: ListingDetail, isAuthed: boolean): ListingDetail {
  if (isAuthed) return detail;
  const vowMedia = detail.status.kind !== "active";
  const gatedPayload = { ...(detail.full_payload as Record<string, unknown>) };
  delete gatedPayload.true_dom; // VOW-stitched; raw DaysOnMarket (IDX) stays
  // Sold listings live in `listings` with their raw Closed payload (Query B), and the
  // property API ships full_payload — scrub the sold price/date fields so an anonymous
  // /api/property/[id] response can never carry them (status.closePrice is gated above,
  // but the raw payload would leak the same numbers).
  delete gatedPayload.ClosePrice;
  delete gatedPayload.CloseDate;
  delete gatedPayload.ClosePriceHold;
  delete gatedPayload.CloseDateHold;
  delete gatedPayload.PurchaseContractDate;
  delete gatedPayload.SoldEntryTimestamp;
  delete gatedPayload.SoldConditionalEntryTimestamp;
  return {
    ...detail,
    full_payload: gatedPayload,
    // Withhold the URLs, keep the fact. The count is recomputed HERE from the ungated
    // input rather than trusting `detail.photoTeaser`: this function is the one step that
    // always runs per-request, while the detail itself arrives from unstable_cache and may
    // predate the field (for an hour after any deploy that changes the shape). Deriving it
    // here means a stale cache entry degrades to a correct teaser, not a blank box.
    media_urls: vowMedia ? [] : detail.media_urls,
    photoTeaser: vowMedia ? { count: detail.media_urls.length } : null,
    estimate: null,
    valueAdd: null,
    dealScore: EMPTY_DEAL_SCORE,
    expectedSale: null,
    saleHistory: gateSaleHistory(detail.saleHistory, false),
    priceTimeline: { ...detail.priceTimeline, trueDom: null, totalPriceDrop: 0, originalPrice: null },
    campaignHistory: gateCampaignHistory(detail.campaignHistory, false),
    status: gateListingStatus(detail.status, false),
    soldAccuracy: null,
    capRatePct: null,
    // geoFlags (+ geoChecked/geoCheckedAt) are PUBLIC-records facts (flood/rail/
    // traffic), NOT TRREB VOW data — intentionally NOT nulled: {...detail} passes
    // them through for anon users too (Phase 2 plan §2/§4.1). Do not "fix" this by
    // gating them.
    geoFlags: detail.geoFlags,
    geoChecked: detail.geoChecked,
    geoCheckedAt: detail.geoCheckedAt,
  };
}

export interface ListingDetail {
  listing_key: string;
  full_payload: Record<string, unknown>;
  /**
   * Photo URLs. For SOLD/LEASED/off-market listings these are VOW Listing Information, and
   * gateVowDerived empties this for anonymous users — see `photoTeaser`, which survives
   * gating so the page can still say how many photos exist.
   */
  media_urls: string[];
  /**
   * Photo EXISTENCE + COUNT — safe for anonymous users, and the whole point of the locked
   * gallery teaser. Mirrors the rule /address already follows (soldByKey.ts `hasPhoto`):
   * the count is not VOW Listing Information, the URLs are. Null for active listings,
   * whose photos are IDX and shown to everyone.
   */
  photoTeaser: { count: number } | null;
  city: string | null;
  property_sub_type: string | null;
  synced_at: string | null;
  estimate: AVMResult | null;
  valueAdd: ValueAddReport | null;
  feeStability: FeeStabilityResult;
  dealScore: DealScoreResult;
  /** List-aware "what this listing will close at" (VOW-derived, gated for anon). */
  expectedSale: ExpectedSale | null;
  saleHistory: SaleHistory;
  priceTimeline: PriceTimeline;
  /** Full per-property campaign history (gated for anon). Powers True DOM + the timeline. */
  campaignHistory: CampaignHistoryView;
  /** Active / Sold / De-listed state. Kind is public; VOW numbers gated for anon. */
  status: ListingStatus;
  /** How close our closest model came to the actual sale (sold only; VOW-gated). */
  soldAccuracy: SoldAccuracy | null;
  /** Extrapolated cap rate % (Typesense cap_rate_est, sanity-banded). null when absent. */
  capRatePct: number | null;
  /**
   * Geo-joined public-records diligence flags (flood/rail/traffic), precomputed by
   * enrichGeoFlags.ts. Merged into Things to Know as `external`. PUBLIC data → not
   * VOW-gated; best-effort, [] on miss/error.
   */
  geoFlags: DiligenceFlag[];
  /**
   * True when the geo enrichment actually ran this listing against a trustworthy
   * block-level coord. Disambiguates empty geoFlags: [] + checked=true is "checked
   * & clear" (the card may say so); [] + checked=false is "couldn't check" (say
   * nothing). Public data → not VOW-gated.
   */
  geoChecked: boolean;
  /** When the geo check last ran (listing_geo_flags.computed_at). */
  geoCheckedAt: string | null;
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
    // floor matches trueDom's day math; ceil−1 under-reported exact-boundary days (audit LOW-11).
    if (Number.isFinite(diff)) return Math.max(0, Math.floor(diff / 86_400_000));
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
 * Defensively coerce the listing_geo_flags.flags JSONB into DiligenceFlag[]. The
 * column is written by enrichGeoFlags.ts, but the read path validates shape so a
 * malformed/legacy row degrades to [] instead of rendering garbage.
 */
function asDiligenceFlags(raw: unknown): DiligenceFlag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is DiligenceFlag =>
      !!f &&
      typeof f === "object" &&
      typeof (f as DiligenceFlag).id === "string" &&
      ((f as DiligenceFlag).kind === "warn" || (f as DiligenceFlag).kind === "info") &&
      typeof (f as DiligenceFlag).severity === "number" &&
      typeof (f as DiligenceFlag).title === "string" &&
      typeof (f as DiligenceFlag).source === "string"
  );
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
      // Carried through so the detail page's AVM reads the feed's declared unit
      // instead of guessing it — guessing wrong scales living area by 10.76.
      RoomLengthWidthUnits: r.RoomLengthWidthUnits ?? null,
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
        // Keyed through the shared helper so reads match what refresh-condo-fee-stats
        // writes: `REGISTRY-NUMBER` (e.g. 'MTCC-539'), since a CondoCorpNumber is only
        // unique within its registry.
        const corpKey = corpCohortKey(payload?.["AssociationName"], payload?.["CondoCorpNumber"]);

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
          corpKey
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
              // The pct_change_24mo column stores an ANNUALIZED %/yr rate since the
              // 2026-07 trend rework (column name kept to avoid a migration).
              annualPct: Number(corpRow.pct_change_24mo),
              sampleCount: Number(corpRow.sample_count),
              inclusionsMixed: corpRow.inclusions_mixed === true,
            }
          : null;

        feeStability = buildFeeStabilityResult({ payload, cityRegion, area, corp });
      }
    } catch (feeError) {
      console.error(`[getListingDetail] Fee stability failed for ${listingKey}:`, feeError);
    }

    // Core listing scalars used by the Deal Score, Expected Sale, and timeline below.
    const payload = (listing.full_payload as Record<string, unknown>) ?? {};
    const listPrice =
      typeof payload["ListPrice"] === "number" ? (payload["ListPrice"] as number) : null;
    const originalListPrice =
      typeof payload["OriginalListPrice"] === "number"
        ? (payload["OriginalListPrice"] as number)
        : null;
    const realCapRate = await capRatePromise;

    const ratioSub =
      listing.property_sub_type ??
      (typeof payload["PropertySubType"] === "string" ? (payload["PropertySubType"] as string) : null);

    // Expected Sale Price — list-aware (list × cohort close/list ratio). VOW-derived
    // (raw_vow_sold); getCloseListRatio is unstable_cache'd 24h per cohort so this never
    // scans the table per page load (Disk IO budget). Best-effort, never blocks. Computed
    // BEFORE the Deal Score so its likely-close + ratio can seed the suggested-offer band.
    let expectedSale: ExpectedSale | null = null;
    try {
      if (listPrice && listPrice > 0) {
        const ratioCity =
          listing.city ?? (typeof payload["City"] === "string" ? (payload["City"] as string) : null);
        const ratio = await getCloseListRatio(ratioCity, ratioSub);
        expectedSale = computeExpectedSale(listPrice, ratio);
      }
    } catch (esErr) {
      console.error(`[getListingDetail] Expected Sale failed for ${listingKey}:`, esErr);
    }

    // Deal Score is computed AFTER True DOM is resolved (below) so its Negotiability
    // pillar uses the same campaign-stitched True DOM the page displays — NOT the raw
    // feed DaysOnMarket, which resets to ~0 on a terminate-and-relist (e.g. N13410488:
    // feed ~13d from OriginalEntryTimestamp vs True DOM 24d).

    // Status resolution — sold comes straight from the payload (Query B upserts the
    // Closed payload into `listings`); Terminated/Expired/Suspended live ONLY in
    // raw_vow_delisted (the listings row stays frozen-Active), so non-sold rows get
    // one indexed PK lookup there. Best-effort: a miss/timeout degrades to "active".
    let status: ListingStatus = resolveListingStatus(payload, null);
    if (status.kind === "active") {
      try {
        const { data: dRow } = await withTimeout(
          supabase
            .from("raw_vow_delisted")
            .select("mls_status, delisted_date, days_on_market, list_price")
            .eq("listing_key", listingKey)
            .maybeSingle(),
          4000,
          "Delisted lookup"
        );
        if (dRow) status = resolveListingStatus(payload, dRow as DelistedRowLite);
      } catch (dlErr) {
        console.error(`[getListingDetail] delisted lookup failed for ${listingKey}:`, dlErr);
      }
    }

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

    // Non-disclosure fallback (own sale event only) + the accuracy receipt.
    status = fillClosePriceFromSaleHistory(status, listing.listing_key, saleHistory.events);
    let soldAccuracy = pickSoldAccuracy({
      closePrice: status.kind === "sold" ? status.closePrice : null,
      avmValue: estimate?.estimatedValue ?? null,
      expectedSalePrice: expectedSale?.expectedPrice ?? null,
    });

    // Campaign history (corrected True DOM + event timeline). Read the ledger; if
    // missing/stale, refresh on-demand from the VOW feed (best-effort, timeout-bounded
    // — never blocks the page). Subject is merged in so a feed lag can't zero True DOM.
    let campaignHistory: CampaignHistoryView = toCampaignHistoryView(null);
    try {
      const propertyHash =
        (typeof listing.property_hash === "string" && listing.property_hash) ||
        generatePropertyHash(payload);
      if (propertyHash) {
        const row = await withTimeout(
          refreshCampaignHistoryForListing(supabase, {
            propertyHash,
            addr: {
              StreetNumber: payload["StreetNumber"],
              StreetName: payload["StreetName"],
              City: payload["City"],
              UnitNumber: payload["UnitNumber"],
              PropertySubType: payload["PropertySubType"],
            },
            subjectEvent: normalizeCampaign(payload as RawVowCampaign),
            vowToken: process.env.PROPTX_VOW_TOKEN,
            nowMs: Date.now(),
          }),
          8000,
          "Campaign history"
        );
        campaignHistory = toCampaignHistoryView(row);
      }
    } catch (chErr) {
      console.error(`[getListingDetail] Campaign history failed for ${listingKey}:`, chErr);
    }

    // Relist reconciliation: the viewed key may be a TERMINATED/EXPIRED original whose
    // property was relisted under a NEW key that then SOLD. That close lives only in the
    // address-stitched campaign history (fetched by address, not key) — never in this
    // key's own payload or raw_vow_delisted — so status resolved to "delisted" while the
    // property actually sold (e.g. 7 Stemford Rd: W13090288 terminated May 31, relist
    // W13224994 sold Jun 12 $885k). Promote to SOLD when the NEWEST stitched campaign is a
    // close on a DIFFERENT key dated at/after this key's delist. The soldAccuracy receipt
    // is recomputed so the sold hero carries its estimate-vs-close delta.
    //
    // Scoped to THIS campaign's transaction type: a close of the other type is a different
    // deal on the same bricks and must not settle this page (a terminated SALE at a
    // property later LEASED did not sell — see latestCloseFromCampaigns).
    if (status.kind === "delisted" && campaignHistory.events.length > 0) {
      const close = latestCloseFromCampaigns(
        campaignHistory.events,
        /lease/i.test(String(payload["TransactionType"] ?? "")) ? "Lease" : "Sale"
      );
      if (
        close &&
        close.listingKey !== listing.listing_key &&
        (status.delistedDate == null || close.closeDateISO >= status.delistedDate)
      ) {
        status = {
          kind: "sold",
          label: close.kind === "leased" ? "LEASED" : "SOLD",
          closePrice: close.closePrice,
          soldDate: close.closeDateISO,
        };
        soldAccuracy = pickSoldAccuracy({
          closePrice: close.closePrice,
          avmValue: estimate?.estimatedValue ?? null,
          expectedSalePrice: expectedSale?.expectedPrice ?? null,
        });
      }
    }

    // Price timeline — list-price movement only (IDX-class). total_price_drop / true_dom
    // are the deterministic fields the Temporal Distress Engine persisted to full_payload.
    const ledgerDrop = campaignHistory.totalPriceDrop;
    const payloadDrop =
      typeof payload["total_price_drop"] === "number" && payload["total_price_drop"] > 0
        ? (payload["total_price_drop"] as number)
        : 0;
    const totalPriceDrop = ledgerDrop > 0 ? ledgerDrop : payloadDrop;
    const trueDom =
      campaignHistory.trueDom ??
      (typeof payload["true_dom"] === "number"
        ? (payload["true_dom"] as number)
        : deriveDomDays(payload));

    // Deal Score — deterministic 0–100 score over already-derived metrics (§4: no LLM).
    // domDays uses the resolved True DOM (campaign-stitched) so the Negotiability pillar
    // matches the True DOM shown elsewhere on the page; falls back to the feed DOM.
    const dealScore = computeDealScore({
      listPrice,
      originalListPrice,
      avmEstimate: estimate
        ? { estimatedValue: estimate.estimatedValue, confidence: estimate.confidence }
        : null,
      domDays: trueDom ?? deriveDomDays(payload),
      capRatePct: realCapRate,
      subType: ratioSub,
      expectedSalePrice: expectedSale?.expectedPrice ?? null,
      closeListRatio: expectedSale?.ratio ?? null,
    });
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

    // Best-effort geo "Things to Know" flags — ONE indexed PK point-lookup on the
    // precomputed listing_geo_flags table. The PostGIS spatial joins run offline in
    // enrichGeoFlags.ts; we never run a spatial query at request time (§5 Disk-IO).
    // PUBLIC-records data (flood/rail/traffic) → NOT VOW-gated (see gateVowDerived).
    let geoFlags: DiligenceFlag[] = [];
    let geoChecked = false;
    let geoCheckedAt: string | null = null;
    try {
      const { data: gRow } = await withTimeout(
        supabase
          .from("listing_geo_flags")
          .select("flags, checked, computed_at")
          .eq("listing_key", listingKey)
          .maybeSingle(),
        4000,
        "Geo flags"
      );
      if (gRow) {
        geoFlags = asDiligenceFlags(gRow.flags);
        geoChecked = gRow.checked === true;
        geoCheckedAt = typeof gRow.computed_at === "string" ? gRow.computed_at : null;
      }
    } catch (geoErr) {
      console.error(`[getListingDetail] Geo flags failed for ${listingKey}:`, geoErr);
    }

    // `listings.media_urls` is only ever filled while a listing is ACTIVE, so a property
    // that entered our data already-sold has an empty column while its photos sit in
    // raw_vow_sold.photos. Recover them — one indexed PK lookup, and only on the empty
    // path, so the 71% of sold rows that already have media pay nothing. See soldPhotos.ts.
    let mediaUrls: string[] = listing.media_urls || [];
    if (mediaUrls.length === 0 && status.kind === "sold") {
      mediaUrls = await getSoldPhotoUrls(listingKey);
    }

    return {
      listing_key: listing.listing_key,
      full_payload: payload,
      media_urls: mediaUrls,
      // Count only — survives gateVowDerived so anon can be told what's behind the gate.
      photoTeaser: status.kind === "active" ? null : { count: mediaUrls.length },
      city: listing.city ?? null,
      property_sub_type: listing.property_sub_type ?? null,
      synced_at: listing.synced_at ?? null,
      estimate,
      valueAdd,
      feeStability,
      dealScore,
      expectedSale,
      saleHistory,
      priceTimeline,
      campaignHistory,
      status,
      soldAccuracy,
      capRatePct: realCapRate,
      geoFlags,
      geoChecked,
      geoCheckedAt,
      rooms,
    };
  }
);
