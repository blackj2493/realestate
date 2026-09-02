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
import { compMonthlyRentFrom } from "@/lib/metrics/compRent";
import { pickPreferredBasis } from "@/lib/metrics/rentTier";
import { calculateAVM } from "@/lib/avm/calculator";
import { mapListingToAVMInput } from "@/lib/avm/mapListingToAVMInput";
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
import { detectCompetitive } from "@/lib/avm/salePrice";
import {
  resolveListingStatus,
  fillClosePriceFromSaleHistory,
  pickSoldAccuracy,
  gateListingStatus,
  type DelistedRowLite,
  type FeedAbsence,
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
    compMonthlyRent: null,
    suiteMonthlyRent: null,
    // Gated with the rest of the rent figures, not because the suite cohorts are VOW
    // (they are built from active for-lease listings, same IDX source as the whole-home
    // ladder) but because leaving it would let an anon reader back out the gated cap
    // rate from the income side. The sandbox hides the "Add a suite" option entirely
    // when this is null — a build cost with no income beside it is worse than nothing.
    areaSuiteMonthlyRent: null,
    rentMatchTier: null,
    // Nulled WITH the rent, not because a cohort size is VOW data, but because a
    // provenance line describing a number the reader cannot see is noise at best and
    // a hint at the gated figure's confidence at worst.
    rentBasis: null,
    rentSampleCount: null,
    suiteRentBasis: null,
    suiteRentSampleCount: null,
    wholeHomeMonthlyRent: null,
    wholeHomeRentTier: null,
    wholeHomeRentBasis: null,
    wholeHomeRentSampleCount: null,
    // geoFlags (+ geoChecked/geoCheckedAt) are PUBLIC-records facts (flood/rail/
    // traffic), NOT TRREB VOW data — intentionally NOT nulled: {...detail} passes
    // them through for anon users too (Phase 2 plan §2/§4.1). Do not "fix" this by
    // gating them.
    geoFlags: detail.geoFlags,
    geoChecked: detail.geoChecked,
    geoCheckedAt: detail.geoCheckedAt,
  };
}


/**
 * Rent for an in-home suite in this area, for a home that does NOT have one.
 *
 * `suite_rent_est` on the document is only set where a suite is OBSERVED — that is
 * deliberate, because it feeds a published cap rate and a scored suite is not a real
 * one (migration 125). But the "Add a suite" scenario needs the same cohort for a home
 * that has no suite yet, or it shows a $90k-$225k conversion cost against $0 of income
 * and is worse than useless.
 *
 * So this reads the suite rungs directly. Neighbourhood first, then city, matching
 * fetchSuiteRent's order — location sets a suite's rent, and there is no sub-type or
 * bath count to relax. A one-bed is the assumption: it is the commonest basement unit
 * and the reader can change the number.
 *
 * Returns null when no cohort answered, which the sandbox must render as "we don't
 * know", never as zero.
 */
async function fetchAreaSuiteRent(cityRegion: string | null, city: string | null): Promise<number | null> {
  const region = (cityRegion ?? "").trim();
  const municipality = (city ?? "").trim();
  if (!region && !municipality) return null;
  try {
    const supabase = getServiceRoleClient();
    const probe = async (tier: "suite_nbhd" | "suite_city", col: "city_region" | "city", value: string) => {
      // NOT maybeSingle(): since 133 one cohort key holds a row per basis (signed
      // leases over 12mo and 24mo, plus current asks), and maybeSingle() ERRORS on
      // more than one row. pickPreferredBasis is the SAME ranking the worker's ladder
      // walks — imported rather than restated, so this page cannot drift from the
      // number rendered beside it.
      const { data } = await supabase
        .from("rental_market_index")
        .select("avg_rent, basis")
        .eq("match_tier", tier)
        .eq(col, value)
        .eq("bedrooms_total", 1);
      const rent = pickPreferredBasis((data ?? []) as Array<{ avg_rent: number; basis: string }>)?.avg_rent;
      return typeof rent === "number" && rent > 0 ? rent : null;
    };
    if (region) {
      const hit = await probe("suite_nbhd", "city_region", region);
      if (hit != null) return hit;
    }
    if (municipality) return await probe("suite_city", "city", municipality);
    return null;
  } catch (err) {
    console.error("[getListingDetail] area suite rent lookup failed:", err);
    return null;
  }
}

/**
 * Bump when a field is ADDED TO or REMOVED FROM ListingDetail.
 *
 * getListingDetailCached folds this into the cache key, so a shape change makes every
 * pre-deploy entry unreadable rather than serving an object missing the new field for
 * up to an hour. Without it, `compMonthlyRent` shipped correct end to end and the page
 * still rendered the old value — the cached object simply had no such key.
 *
 * Changing a field's VALUE needs no bump; only its presence matters here.
 *
 * v6 bumps for a VALUE change, which is the documented exception, and deliberately.
 * `status` gained an "unavailable" kind, so every entry cached before this deploy still
 * resolves a feed-absent listing to `{ kind: "active" }`. Without the bump the fix would
 * be correct end to end and the page would keep printing "available" for another hour on
 * exactly the listings it was written to catch.
 */
export const DETAIL_SHAPE_VERSION = "v9-whole-home-rent";

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
  /** Comp-derived monthly rent (rent ladder, via gross_yield_est). Seeds the sandbox's
   *  Monthly Rent; null falls back to the price rule. See src/lib/metrics/compRent.ts. */
  compMonthlyRent: number | null;
  /** Measured monthly rent for an observed in-home suite (125), else null. Drives the
   *  Split default and Split's income — never set from an area figure. */
  suiteMonthlyRent: number | null;
  /** What a suite rents for in this AREA, whether or not this home has one. Feeds the
   *  opt-in "Add a suite" scenario only, alongside its build cost. */
  areaSuiteMonthlyRent: number | null;
  /** Which rung produced that rent — drives how confidently the UI labels it. */
  rentMatchTier: string | null;
  /** Whether that rent stands on signed leases or on current asks (RentBasis). */
  rentBasis: string | null;
  /** How many comps the cohort median was taken over. Null = unknown, never "few". */
  rentSampleCount: number | null;
  /** The same two for the suite line, which is its own editable field in the sandbox. */
  suiteRentBasis: string | null;
  suiteRentSampleCount: number | null;
  /**
   * What ONE tenant pays for the ENTIRE house, with its own rung and depth.
   *
   * Distinct from `compMonthlyRent` wherever a suite is observed, because that one is
   * the main unit alone. The sandbox's "Whole home" strategy had nothing else to reach
   * for and re-used the main-unit figure, pricing a 7-bed house at its 4-bed comp.
   */
  wholeHomeMonthlyRent: number | null;
  wholeHomeRentTier: string | null;
  wholeHomeRentBasis: string | null;
  wholeHomeRentSampleCount: number | null;
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
    // Widened to carry the rent signals too. The Underwriting Sandbox used to seed its
    // Monthly Rent from list price x 0.004 — arithmetic on the ask, not a rent, and the
    // reason Gross Yield printed exactly 4.80% on every listing. gross_yield_est is
    // rent-only by construction and already sits on this same document, so the comp rent
    // costs no extra round trip and cannot disagree with the cap rate beside it.
    const capRatePromise: Promise<{
      capRatePct: number | null;
      compMonthlyRent: number | null;
      rentMatchTier: string | null;
      rentBasis: string | null;
      rentSampleCount: number | null;
      suiteMonthlyRent: number | null;
      suiteRentBasis: string | null;
      suiteRentSampleCount: number | null;
      wholeHomeMonthlyRent: number | null;
      wholeHomeRentTier: string | null;
      wholeHomeRentBasis: string | null;
      wholeHomeRentSampleCount: number | null;
    }> = withTimeout(
      searchListings({ query: "*", rawFilterBy: `id:=\`${listingKey}\``, perPage: 1 }),
      4000,
      "CapRate"
    )
      .then((r) => {
        const doc = r.listings[0];
        // gross_yield_est is TOTAL revenue over price, and since 125 that total
        // includes the measured suite rent. The sandbox shows the suite on its own
        // line, so the rent field has to be the MAIN UNIT — subtract the suite back
        // out or the two lines charge for the basement twice, which is the exact
        // fault 125 set out to remove.
        const totalMonthly = compMonthlyRentFrom(doc?.gross_yield_est, doc?.ListPrice);
        const suite = doc?.suite_rent_est && doc.suite_rent_est > 0 ? doc.suite_rent_est : null;
        return {
          capRatePct: capRateOrNull(doc?.cap_rate_est),
          compMonthlyRent:
            totalMonthly != null && suite != null
              ? Math.max(0, Math.round(totalMonthly - suite))
              : totalMonthly,
          rentMatchTier: doc?.rent_match_tier ?? null,
          // '' and 0 are the transformer's no-data sentinels for these, exactly as they
          // are for rent_match_tier — normalise both to null here so the UI has ONE
          // absent value to branch on and cannot render "Based on 0 comparable rents."
          rentBasis: doc?.rent_basis || null,
          rentSampleCount: doc?.rent_sample_count && doc.rent_sample_count > 0 ? doc.rent_sample_count : null,
          suiteRentBasis: doc?.suite_rent_basis || null,
          suiteRentSampleCount:
            doc?.suite_rent_sample_count && doc.suite_rent_sample_count > 0 ? doc.suite_rent_sample_count : null,
          // Read RAW, with no suite subtracted: this figure is one lease of the whole
          // house, so the basement is already inside it by definition. Subtracting the
          // suite here — as the main-unit line above must — would be the double count
          // running backwards.
          wholeHomeMonthlyRent:
            doc?.whole_home_monthly_rent && doc.whole_home_monthly_rent > 0
              ? Math.round(doc.whole_home_monthly_rent)
              : null,
          wholeHomeRentTier: doc?.whole_home_rent_tier || null,
          wholeHomeRentBasis: doc?.whole_home_rent_basis || null,
          wholeHomeRentSampleCount:
            doc?.whole_home_rent_sample_count && doc.whole_home_rent_sample_count > 0
              ? doc.whole_home_rent_sample_count
              : null,
          // Measured in-home suite rent (125). Present only where the feed OBSERVES a
          // suite; 0/absent everywhere else, and the two must stay indistinguishable.
          suiteMonthlyRent: suite,
        };
      })
      .catch((capErr) => {
        console.error(`[getListingDetail] cap_rate lookup failed for ${listingKey}:`, capErr);
        return {
          capRatePct: null, compMonthlyRent: null, rentMatchTier: null,
          rentBasis: null, rentSampleCount: null,
          suiteMonthlyRent: null, suiteRentBasis: null, suiteRentSampleCount: null,
          wholeHomeMonthlyRent: null, wholeHomeRentTier: null,
          wholeHomeRentBasis: null, wholeHomeRentSampleCount: null,
        };
      });

    // Rooms are for the room table and $/sqft, NOT for the AVM: the model reads
    // resolveModelSqft (the comps' banded scale), because a room-sum measurement is
    // on a different scale than the coefficients were fitted on. See resolveModelSqft.
    const rooms: RoomData[] = await roomsPromise;

    // Best-effort PureProperty Estimate (AVM). Never blocks the listing.
    let estimate: AVMResult | null = null;
    let valueAdd: ValueAddReport | null = null;
    try {
      const payload = listing.full_payload as Record<string, unknown> | null;

      const avmInput = mapListingToAVMInput(payload);
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
    const {
      capRatePct: realCapRate, compMonthlyRent, rentMatchTier, rentBasis, rentSampleCount,
      suiteMonthlyRent: observedSuiteRent, suiteRentBasis, suiteRentSampleCount,
      wholeHomeMonthlyRent, wholeHomeRentTier, wholeHomeRentBasis, wholeHomeRentSampleCount,
    } = await capRatePromise;

    // A home with no suite still needs the area's suite rent, or "Add a suite" prices
    // the renovation and leaves the income side blank.
    //
    // KEPT SEPARATE FROM THE OBSERVED ONE, deliberately. suiteMonthlyRent is what a
    // suite on THIS property earns, and it is what decides whether the sandbox opens
    // on Split and what Split counts as income. Folding the area figure into it would
    // open every basement-owning home on Split and add rent for a unit that does not
    // exist — the fabrication migration 125 was written to remove. This one feeds a
    // scenario the reader has to opt into, and it arrives with a build cost attached.
    const suiteMonthlyRent = observedSuiteRent;
    const areaSuiteMonthlyRent =
      observedSuiteRent ??
      (await fetchAreaSuiteRent(
        (payload.CityRegion as string) ?? null,
        (payload.City as string) ?? null
      ));

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
    //
    // The absence verdict is the LAST resort and costs nothing extra — is_orphaned and
    // last_seen_at already arrive on the `select("*")` above. Without it a listing the
    // feed silently stopped serving has no terminal record ANYWHERE, so every branch
    // misses and the page renders "available" forever (E13415990, 79 days). See
    // ghostReconcile.markVaultOrphans for how the flag is verified and cleared.
    //
    // `last_seen_at` is only a last-seen date when something actually STAMPED it. The
    // column DEFAULTS to now() at insert, and its only writer is ghostReconcile's weekly
    // heartbeat — which first ran 2026-08-18 and stamps only rows present in that run's
    // Active snapshot. A listing that died before then was never stamped, so the column
    // still holds its CREATION date. Printing that under "the board stopped providing it
    // on X" states something false: for a listing created in May and served until August,
    // the page would name May. 2,294 of the 7,908 unavailable pages sit in exactly that
    // position (measured 2026-08-27).
    //
    // So require positive evidence of a stamp — a value that MOVED since insert — and
    // otherwise say nothing. The copy reads correctly without a date, and no date beats a
    // wrong one.
    const createdMs = Date.parse(String(listing.created_at ?? ""));
    const seenMs = Date.parse(String(listing.last_seen_at ?? ""));
    const heartbeatStamped =
      Number.isFinite(createdMs) && Number.isFinite(seenMs) && seenMs - createdMs > 60_000;
    const absence: FeedAbsence = {
      orphaned: listing.is_orphaned === true,
      lastSeen: heartbeatStamped ? String(listing.last_seen_at) : null,
    };
    let status: ListingStatus = resolveListingStatus(payload, null, absence);
    if (status.kind === "active" || status.kind === "unavailable") {
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
        if (dRow) status = resolveListingStatus(payload, dRow as DelistedRowLite, absence);
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
      // "Priced to compete" — the SAME detector the Estimated Sale card runs (via
      // resolveSalePrice in the page/API routes), so the Suggested Move can never
      // recommend an under-ask offer on a listing the card calls a bidding-war setup.
      competitive:
        status.kind === "active" && typeof listPrice === "number" && listPrice > 0
          ? detectCompetitive(listPrice, estimate)
          : null,
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
      compMonthlyRent,
      suiteMonthlyRent,
      areaSuiteMonthlyRent,
      rentMatchTier,
      rentBasis,
      rentSampleCount,
      suiteRentBasis,
      suiteRentSampleCount,
      wholeHomeMonthlyRent,
      wholeHomeRentTier,
      wholeHomeRentBasis,
      wholeHomeRentSampleCount,
      geoFlags,
      geoChecked,
      geoCheckedAt,
      rooms,
    };
  }
);
