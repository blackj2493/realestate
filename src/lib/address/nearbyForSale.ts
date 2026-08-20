/**
 * Nearby active listings for the address-profile page (ADDRESS_PROFILES_PLAN P1).
 *
 * IDX actives are the one fully anon-displayable content class (photos, prices,
 * brokerage — public by design), so this is the profile page's hero section. Native
 * Typesense geo-radius on the public `properties` collection — first use of the radius
 * syntax in the repo, smoke-tested live 2026-07-18 (Typesense returns
 * `geo_distance_meters` per hit when sorting by distance).
 *
 * Home Pulse (2026-07-23) additions — still 100% asking-side/IDX:
 *  - per-listing coords + entry date + DOM + total price drop (radar pins, feed events)
 *  - per-type asking band (p25-p75) + the nearest live listing of each type
 *    (the "if it listed today" range + next-door anchor)
 *  - a merged NEW/CUT event list for the activity feed & ticker
 *
 * Search-only key; runs in server components. Per-query cap far below the 100-listing
 * display limit (CLAUDE.md §4).
 */
import { getTypesenseClient } from "@/lib/typesense/client";
import { bedSplit, bedKey, bedKeyOrder, BED_ABOVE_CAP, type BedCountsRaw } from "@/lib/listings/bedSplit";

export interface NearbyListing {
  id: string;
  address: string;
  cityRegion: string | null;
  price: number;
  /** BedroomsTotal — the SUM of above- and below-grade. Display only; never bucket on it. */
  beds: number | null;
  /** Whole bedrooms above grade — the grid's bedroom axis. */
  bedsAbove: number | null;
  /** Capped plus-room flag ("+1"). A den in a condo, a basement bedroom in a house. */
  bedsDen: 0 | 1;
  /** False when the doc omitted BedroomsBelowGrade entirely — absent is not zero. */
  bedsDenKnown: boolean;
  baths: number | null;
  subType: string | null;
  imageUrl: string | null;
  /** Mandatory display (CLAUDE.md §4) — null renders the "Brokerage unavailable" fallback. */
  brokerage: string | null;
  distanceM: number | null;
  /** Coords for the street-radar pins (public IDX docs carry their geopoint). */
  lat: number | null;
  lng: number | null;
  /** Campaign entry as epoch ms; null when the doc lacks it. */
  entryMs: number | null;
  /** Days listed (this campaign — not stitched True DOM, which is gated). */
  dom: number | null;
  /** Total price cut this campaign ($); 0 = never cut. */
  dropAmount: number;
}

/** Anonymous-safe market context computed from IDX ACTIVES only (asking prices +
 *  listing age of live inventory) — never sold/VOW data. */
export interface NearbyAskingStats {
  medianAsking: number | null;
  medianPsf: number | null;
  medianDaysListed: number | null;
}

/** Equal-width asking-price buckets over [min, max] (5th–95th percentile when n≥20,
 *  so one mansion doesn't flatten the histogram). */
export interface AskingHistogram {
  min: number;
  max: number;
  buckets: number[];
}

/** Per-property-type slice of the live inventory (count + asking band + nearest comp). */
export interface TypeSlice {
  label: string;
  count: number;
  medianAsking: number | null;
  /** 25th/75th-percentile asking — the "homes like this ask $X–$Y" band (n≥3 only). */
  p25: number | null;
  p75: number | null;
  /** Nearest live listing of this type — the "your next-door comp" anchor card. */
  nearest: NearbyListing | null;
}

/** Momentum signals — ALL derived from the active IDX feed (campaign price cuts,
 *  listing age, entry date). Sold-side momentum stays behind the consumer gate. */
export interface MomentumStats {
  /** Actives whose campaign has at least one price cut. */
  cutCount: number;
  cutShare: number;
  medianCut: number | null;
  /** Listed within the last 7 days. */
  newThisWeek: number;
  /** Sitting 30+ days (this campaign's age — not stitched True DOM, which is gated). */
  sitting30: number;
}

/** One asking-side feed event. `new` = listed within the event window (dated by entry);
 *  `cut` = live listing with a price drop (cuts carry no event date in the feed doc, so
 *  the row shows "-$X · Nd on market" and sorts on campaign entry — conservative). */
export interface ActiveEvent {
  kind: "new" | "cut";
  listing: NearbyListing;
}

export interface NearbyForSale {
  listings: NearbyListing[];
  totalFound: number;
  radiusKm: number;
  stats: NearbyAskingStats;
  histogram: AskingHistogram | null;
  /** Property-type breakdown of the fetched actives, largest first. */
  typeMix: TypeSlice[];
  momentum: MomentumStats;
  /** NEW (≤30d) + CUT events for the activity feed/ticker, feed-ready order. */
  events: ActiveEvent[];
  /** All fetched actives with coords — the street-radar pin set (≤100 by construction).
   *  Carries id/address/price so the radar pins are tappable (IDX = public data). */
  pins: RadarPinData[];
  /** Median asking by bedrooms × property type over ALL fetched actives — the
   *  "typical rents" grid on lease queries. Null when the sample is too thin. */
  bedsTypeMatrix: AskingMatrix | null;
}

/** One cell of the beds × type asking grid. Median hides below MIN_CELL_SAMPLES. */
export interface AskingMatrixCell {
  median: number | null;
  count: number;
  /** Middle-50% band (25th/75th pct of the kept prices) — set only when the cell holds
   *  ≥ RANGE_MIN_N points, where quartiles stop being noise. Sale-price cells render it
   *  (owner call 2026-07-24: heterogeneous stock makes a bare sale median falsely
   *  precise — downtown condo 2bd IQR measured at 36% of median vs 4–11% suburban). */
  p25?: number | null;
  p75?: number | null;
}

export interface AskingMatrix {
  /**
   * Bedroom column KEYS present in the data — "0", "1", "1+1", "2", "2+1", … Render
   * them with `bedKeyLabel`; never parse them as integers. A "+1" column is a home
   * with a plus-room (a den in a condo, a basement bedroom in a house), which the
   * feed folds into `BedroomsTotal` and the market prices separately.
   */
  bedCols: string[];
  /** Top property types by inventory, each with one cell per bed column. */
  rows: Array<{ label: string; cells: AskingMatrixCell[]; count: number }>;
  /** Listings that entered the grid (beds + type + price all present). */
  sample: number;
}

// Owner calls (2026-07-24): a single real data point beats a dash — every cell with
// data shows its median WITH its sample count (the count is the honesty device), and
// the grid renders from 3 usable listings up. MEDIAN (not mean) throughout: rent
// distributions are right-skewed (audited live: Detached 5bd near Beckett — median
// $3,900 vs mean $4,167, one $6,000 lease dragging the mean 7% high).
const MIN_CELL_SAMPLES = 1;
const MIN_MATRIX_SAMPLE = 3;
const MAX_MATRIX_ROWS = 6;
/** Beds bucket cap: 0 (studio) and 1–5 render as-is; 6 means "6+". Shared with the
 *  bed classifier so the column keys and their labels cannot drift apart. */
const BEDS_BUCKET_CAP = BED_ABOVE_CAP;

/** Below this many rentals, the 2 km grid is mostly "—" cells — widen the net. */
const RENT_TARGET_SAMPLE = 12;
const WIDE_RENT_RADIUS_KM = 5;

export interface TypicalRents {
  matrix: AskingMatrix;
  radiusKm: number;
}

/** Prefer the local grid when it's dense enough; else the widest usable one. Pure — exported for tests. */
export function pickRentMatrix(
  near: AskingMatrix | null,
  nearRadiusKm: number,
  wide: AskingMatrix | null,
  wideRadiusKm: number
): TypicalRents | null {
  if (near && near.sample >= RENT_TARGET_SAMPLE) return { matrix: near, radiusKm: nearRadiusKm };
  if (wide && (!near || wide.sample > near.sample)) return { matrix: wide, radiusKm: wideRadiusKm };
  return near ? { matrix: near, radiusKm: nearRadiusKm } : null;
}

/**
 * Typical-rents grid with an ADAPTIVE radius: suburban pockets rarely hold enough
 * live rentals within 2 km to fill the beds × type cells (Barrhaven: 11), so a thin
 * local grid re-queries at 5 km and the denser result wins. `first` lets callers
 * that already fetched the 2 km lease pass it in (no duplicate query on the dense
 * path); pass null to have both radii fetched here.
 */
export async function getTypicalRents(
  lat: number,
  lng: number,
  first?: NearbyForSale | null
): Promise<TypicalRents | null> {
  const near = first !== undefined ? first : await getNearbyForSale(lat, lng, { transactionType: "lease" });
  const nearMatrix = near?.bedsTypeMatrix ?? null;
  if (nearMatrix && nearMatrix.sample >= RENT_TARGET_SAMPLE) {
    return { matrix: nearMatrix, radiusKm: near!.radiusKm };
  }
  const wide = await getNearbyForSale(lat, lng, { transactionType: "lease", radiusKm: WIDE_RENT_RADIUS_KM });
  return pickRentMatrix(nearMatrix, near?.radiusKm ?? 2, wide?.bedsTypeMatrix ?? null, wide?.radiusKm ?? WIDE_RENT_RADIUS_KM);
}

/**
 * In-home rental unit detector (owner-reported contamination 2026-07-24: Brampton's
 * "Detached 3bd" median was $1,975 — basements listed AS Detached: "41 Eberly Woods
 * Drive Basement $2,000", "6 Sweet Briar Lane Bsmt $1,700", "106 Benadir Avenue
 * #bsmnt $1,900"). Address markers, tuned against real feed strings:
 *  - "basement"/"bsmt"/"#bsmnt"/"walk-out" anywhere (never street names);
 *  - lower/upper/main ONLY in unit positions — parenthesized "(Lower Unit)", after a
 *    dash "B - Upper", before level/floor/unit/apt/suite, or trailing ("… St Upper")
 *    — so "Upper Canada Drive", "Lower Base Line" and "Main Street" never match.
 * Known miss: bare numeric units ("3407 Woodroffe Avenue 2") — no safe signal.
 */
const PARTIAL_UNIT_RE = new RegExp(
  [
    /\b(?:bsmn?t|basement|walk\s*-?\s*out)\b/.source,
    /#\s*(?:bsmn?t|basement)/.source,
    /\([^)]*\b(?:lower|upper|main|bsmn?t|basement)\b[^)]*\)/.source,
    /-\s*(?:lower|upper|main)\b/.source,
    /\b(?:lower|upper|main)\s+(?:level|floor|unit|apt|apartment|suite)\b/.source,
    /\b(?:lower|upper|main)\s*(?:$|,)/.source,
  ].join("|"),
  "i"
);

/** Whole-listing subtypes that ARE in-home units — folded into the same row. */
const IN_HOME_SUBTYPES = new Set(["lower level", "upper level"]);

export const IN_HOME_UNIT_LABEL = "Basement / in-home unit";

/** True when a rental is a PART of a house (basement/upper/main-floor unit). Exported for tests. */
export function isPartialUnitRental(address: string | null | undefined, subType?: string | null): boolean {
  if (subType && IN_HOME_SUBTYPES.has(subType.trim().toLowerCase())) return true;
  return !!address && PARTIAL_UNIT_RE.test(address);
}

// ── Outlier handling (owner decision 2026-07-24: "if it's an obvious outlier, we
// leave it out") ─────────────────────────────────────────────────────────────────
// Rule A — cell trim: in a cell with ≥4 points, anything outside 0.5×–2× of the
// cell's own median is dropped before the final median (the ×n count reflects what
// was kept). Rule B — unmarked basements: a 0–2 bd item in a HOUSE row priced under
// 70% of that row's own ≥3 bd whole-home median is reclassified to the in-home row
// (catches the address-marker misses; a legit whole 2 bd at ~80% stays). Condo rows
// are exempt from Rule B — a cheap condo 1 bd is normal, not a basement.
const TRIM_MIN_N = 4;
const TRIM_LO = 0.5;
const TRIM_HI = 2.0;
const HOUSE_ANCHOR_MIN_N = 3;
const RECLASS_FRACTION = 0.7;
/** Quartiles below this many kept points are noise — the cell shows median-only. */
const RANGE_MIN_N = 5;
/** Sale-side floor for standing a "+1" column on its own. Measured crossover, not a
 *  guess — see the backtest table in buildBedsTypeMatrix. */
const SPLIT_MIN_N = 5;

/** House-style types whose low-bed cheap items are almost always unmarked in-home units. */
function isHouseType(label: string): boolean {
  return !/condo|apartment|co-?op|room|other|lower|upper|duplex|triplex|multiplex/i.test(label);
}

/**
 * Median rent by bedrooms (Studio/1/2/3/4/5/6+) × property type. Pure — exported for
 * tests. Every cell with data shows its median plus the sample count; a grid under
 * MIN_MATRIX_SAMPLE listings returns null so the panel self-hides (silent-null
 * convention). Beds 0 is a real bucket (bachelor/basement studios lease constantly).
 * In-home units (basement/upper/main-floor rentals filed under the HOUSE's type) are
 * routed to their own row so they never drag a whole-home median down; obvious
 * outliers are trimmed per the rules above.
 *
 * mode "sale" (the sell-side grid): homes are never SOLD as a basement unit, so the
 * in-home classifier and Rule B are rent-only logic there — a cheap 2 bd detached is
 * a small bungalow, not an unmarked basement. Rule A (cell trim) applies to both.
 */
export function buildBedsTypeMatrix(
  items: Array<{
    beds: number | null;
    /** REQUIRED, not optional, so a caller that forgets the split fails to compile
     *  rather than quietly publishing merged medians again. */
    bedsAbove: number | null;
    bedsDen: 0 | 1;
    subType: string | null;
    price: number;
    address?: string | null;
  }>,
  opts: { mode?: "rent" | "sale" } = {}
): AskingMatrix | null {
  const isRent = (opts.mode ?? "rent") === "rent";
  const usable = items.filter((i) => i.bedsAbove !== null && i.bedsAbove >= 0 && i.subType && i.price > 0);
  if (usable.length < MIN_MATRIX_SAMPLE) return null;

  // Pass 1 — initial (label, bucket, price) assignment via the address classifier.
  const assigned = usable.map((i) => ({
    label: isRent && isPartialUnitRental(i.address, i.subType) ? IN_HOME_UNIT_LABEL : (i.subType as string).trim(),
    bucket: bedKey({ above: i.bedsAbove as number, den: i.bedsDen }, BEDS_BUCKET_CAP),
    // Where this item lands if its "+1" column turns out too thin to stand alone.
    mergedBucket: bedKey({ above: (i.bedsAbove as number) + i.bedsDen, den: 0 }, BEDS_BUCKET_CAP),
    den: i.bedsDen,
    price: i.price,
  }));

  // Pass 1b (SALE only) — collapse a "+1" column back into its whole-bedroom column
  // when it is too thin to beat the merged one.
  //
  // Backtested out-of-time over 44,663 sales and 56,228 leases (train to 2026-02,
  // test 2026-03..08), scoring each home against its cohort median:
  //
  //   SALE   cell 1-2  merged 16.90%  split 19.18%   <- split LOSES by 2.3pp
  //          cell 3-4  merged 14.25%  split 14.51%
  //          cell 5-6  merged 13.49%  split 13.50%   <- crossover
  //          cell 25+  merged 13.17%  split 12.71%
  //   LEASE  split wins at EVERY depth, 1-2 included (9.17% vs 11.32%)
  //
  // Sale prices scatter within a cell (floor, view, renovation) so a 2-sale split
  // median is noise and the merged cell's extra depth is worth more than its bias.
  // Rents are tight enough that the den gap dominates from the first sample, which
  // is why rent never collapses. Gating sales this way scored 13.09% against 13.41%
  // merged and 13.18% always-split — better than either alone.
  //
  // COUNT THE PUBLISHED CELL, NOT THE COLUMN. The grid publishes one median per
  // type x bucket, so a bucket-wide count lets a deep row carry a thin one past the
  // floor: Markham L3P served Detached 2+1 on 2 sales ($750k and $1.095M, median
  // $923k) purely because 11 condo apartment 2+1 sales kept that column open. The
  // backtest above measures cohorts, and the cohort IS the cell.
  if (!isRent) {
    const cellKey = (a: { label: string; bucket: string }) => `${a.label}|${a.bucket}`;
    const denCount = new Map<string, number>();
    for (const a of assigned) {
      if (a.den > 0) denCount.set(cellKey(a), (denCount.get(cellKey(a)) ?? 0) + 1);
    }
    for (const a of assigned) {
      if (a.den > 0 && (denCount.get(cellKey(a)) ?? 0) < SPLIT_MIN_N) a.bucket = a.mergedBucket;
    }
  }

  // Pass 2 (Rule B, rent only) — per house row, anchor on its ≥3 bd whole-home median
  // and move implausibly cheap 0–2 bd items to the in-home row.
  if (isRent) {
    const anchors = new Map<string, number | null>();
    for (const a of assigned) {
      if (a.label === IN_HOME_UNIT_LABEL || !isHouseType(a.label) || anchors.has(a.label)) continue;
      const bigBeds = assigned
        .filter((x) => x.label === a.label && bedKeyOrder(x.bucket) >= bedKeyOrder("3"))
        .map((x) => x.price);
      anchors.set(a.label, bigBeds.length >= HOUSE_ANCHOR_MIN_N ? median(bigBeds) : null);
    }
    for (const a of assigned) {
      const anchor = anchors.get(a.label);
      if (anchor && bedKeyOrder(a.bucket) <= bedKeyOrder("2") && a.price < anchor * RECLASS_FRACTION)
        a.label = IN_HOME_UNIT_LABEL;
    }
  }

  const byType = new Map<string, Map<string, number[]>>();
  const colsSeen = new Set<string>();
  for (const a of assigned) {
    colsSeen.add(a.bucket);
    const cols = byType.get(a.label) ?? new Map<string, number[]>();
    const prices = cols.get(a.bucket) ?? [];
    prices.push(a.price);
    cols.set(a.bucket, prices);
    byType.set(a.label, cols);
  }

  // Rule A — trim obvious outliers inside well-sampled cells.
  const trimCell = (prices: number[]): number[] => {
    if (prices.length < TRIM_MIN_N) return prices;
    const m = median(prices)!;
    const kept = prices.filter((p) => p >= m * TRIM_LO && p <= m * TRIM_HI);
    return kept.length ? kept : prices;
  };

  // Order 0, 0+1, 1, 1+1, 2, 2+1 … so each plus-room column sits beside its base.
  const bedCols = [...colsSeen].sort((a, b) => bedKeyOrder(a) - bedKeyOrder(b));
  const rows = [...byType.entries()]
    .map(([label, cols]) => {
      let count = 0;
      const cells: AskingMatrixCell[] = bedCols.map((b) => {
        const prices = trimCell(cols.get(b) ?? []);
        count += prices.length;
        const showRange = prices.length >= RANGE_MIN_N;
        const sorted = showRange ? [...prices].sort((x, y) => x - y) : null;
        return {
          median: prices.length >= MIN_CELL_SAMPLES ? median(prices) : null,
          count: prices.length,
          p25: sorted ? percentile(sorted, 0.25) : null,
          p75: sorted ? percentile(sorted, 0.75) : null,
        };
      });
      return { label, cells, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_MATRIX_ROWS)
    // A row whose every median hid (all lone samples) says nothing — drop it.
    .filter((r) => r.cells.some((c) => c.median !== null));
  if (!rows.length) return null;

  return { bedCols, rows, sample: usable.length };
}

/** One tappable street-radar pin — public IDX fields only. */
export interface RadarPinData {
  id: string;
  address: string;
  price: number;
  lat: number;
  lng: number;
  cut: boolean;
  dropAmount: number;
  distanceM: number | null;
}

// BedroomsAboveGrade/BelowGrade are LOAD-BEARING for the beds x type grid, not extras:
// drop them and every active reads as "no plus-room", which silently folds 1+den units
// back into the 2 bedroom column. The grid looks healthy and is wrong.
export const FIELDS =
  "id,UnparsedAddress,City,CityRegion,ListPrice,BedroomsTotal,BedroomsAboveGrade,BedroomsBelowGrade,BathroomsTotalInteger,PropertySubType,primaryImageUrl,ListOfficeName,BuildingAreaTotal,calculatedDOM,TotalPriceDrop,EntryTimestamp,location";

const NEW_EVENT_DAYS = 30;
const MAX_NEW_EVENTS = 8;
const MAX_CUT_EVENTS = 6;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function toListing(d: Record<string, unknown>, dist: number | undefined): NearbyListing {
  const loc = Array.isArray(d.location) && d.location.length === 2 ? (d.location as [number, number]) : null;
  const entry = typeof d.EntryTimestamp === "number" ? d.EntryTimestamp : 0;
  // EntryTimestamp is epoch ms; tolerate a seconds-scale value defensively.
  const entryMs = entry > 1e12 ? entry : entry > 0 ? entry * 1000 : null;
  const dom = typeof d.calculatedDOM === "number" && d.calculatedDOM >= 0 ? d.calculatedDOM : null;
  const split = bedSplit(d as BedCountsRaw);
  return {
    id: String(d.id ?? ""),
    address: typeof d.UnparsedAddress === "string" ? d.UnparsedAddress.split(",")[0] : "",
    cityRegion: typeof d.CityRegion === "string" && d.CityRegion ? d.CityRegion : null,
    price: typeof d.ListPrice === "number" ? d.ListPrice : 0,
    // 0 is a REAL value (bachelor/basement studio) — every card guard is truthy
    // (`l.beds ? …`), so 0 stays hidden in card metas but reaches the rents grid.
    beds: typeof d.BedroomsTotal === "number" && d.BedroomsTotal >= 0 ? d.BedroomsTotal : null,
    bedsAbove: split ? split.above : null,
    bedsDen: split ? split.den : 0,
    bedsDenKnown: split ? split.denKnown : false,
    baths: typeof d.BathroomsTotalInteger === "number" && d.BathroomsTotalInteger > 0 ? d.BathroomsTotalInteger : null,
    subType: typeof d.PropertySubType === "string" && d.PropertySubType ? d.PropertySubType : null,
    imageUrl: typeof d.primaryImageUrl === "string" && d.primaryImageUrl ? d.primaryImageUrl : null,
    brokerage: typeof d.ListOfficeName === "string" && d.ListOfficeName ? d.ListOfficeName : null,
    distanceM: typeof dist === "number" ? Math.round(dist) : null,
    lat: loc ? loc[0] : null,
    lng: loc ? loc[1] : null,
    entryMs,
    dom,
    dropAmount: typeof d.TotalPriceDrop === "number" && d.TotalPriceDrop > 0 ? d.TotalPriceDrop : 0,
  };
}

export async function getNearbyForSale(
  lat: number,
  lng: number,
  opts: { radiusKm?: number; limit?: number; transactionType?: "sale" | "lease" } = {}
): Promise<NearbyForSale | null> {
  const radiusKm = opts.radiusKm ?? 2;
  const limit = Math.min(opts.limit ?? 12, 12);
  // Default is FOR SALE (the profile hero). Lease rents sit far below the sale floor, so the
  // $100k sanity floor would drop nearly every rental — use a small floor for lease instead.
  const isLease = opts.transactionType === "lease";
  const txnType = isLease ? "For Lease" : "For Sale";
  const priceFloor = isLease ? 500 : 100000;
  try {
    // Fetch up to the 100 nearest (display cap, CLAUDE.md §4): first `limit` become
    // carousel cards; asking-price stats are computed over the whole page.
    const res = await getTypesenseClient()
      .collections("properties")
      .documents()
      .search({
        q: "*",
        query_by: "City",
        // Exclude commercial so the "homes for sale/rent" rows are actually homes (mirrors the
        // city hubs' ACTIVE_FILTER — otherwise "Sale Of Business"/"Store-Office" bleed in).
        filter_by: `location:(${lat}, ${lng}, ${radiusKm} km) && TransactionType:=\`${txnType}\` && ListPrice:>=${priceFloor} && PropertyType:!=Commercial`,
        sort_by: `location(${lat}, ${lng}):asc`,
        include_fields: FIELDS,
        per_page: 100,
      });
    const all: NearbyListing[] = (res.hits ?? [])
      .map((h) =>
        toListing(
          h.document as Record<string, unknown>,
          (h as { geo_distance_meters?: { location?: number } }).geo_distance_meters?.location
        )
      )
      .filter((l) => l.id);

    const listings = all.slice(0, limit);

    // Asking stats over ALL fetched actives (IDX only): price always; $/sqft and
    // days-listed only from listings that carry the field.
    const prices: number[] = [];
    const psfs: number[] = [];
    const doms: number[] = [];
    const cuts: number[] = [];
    const byType = new Map<string, NearbyListing[]>();
    let newThisWeek = 0;
    let sitting30 = 0;
    const weekAgoMs = Date.now() - 7 * 86_400_000;
    for (const l of all) {
      if (l.price > 0) prices.push(l.price);
      if (l.dom !== null) doms.push(l.dom);
      if (l.dom !== null && l.dom >= 30) sitting30++;
      if (l.dropAmount > 0) cuts.push(l.dropAmount);
      if (l.entryMs !== null && l.entryMs >= weekAgoMs) newThisWeek++;
      if (l.subType) {
        const arr = byType.get(l.subType.trim()) ?? [];
        arr.push(l);
        byType.set(l.subType.trim(), arr);
      }
    }
    // $/sqft from the raw hits (BuildingAreaTotal isn't kept on NearbyListing).
    for (const h of res.hits ?? []) {
      const d = h.document as Record<string, unknown>;
      const price = typeof d.ListPrice === "number" ? d.ListPrice : 0;
      const sqft = typeof d.BuildingAreaTotal === "number" ? d.BuildingAreaTotal : 0;
      if (price > 0 && sqft >= 200) psfs.push(price / sqft);
    }

    // Price histogram: 8 equal-width buckets, percentile-clipped against outliers.
    let histogram: AskingHistogram | null = null;
    if (prices.length >= 8) {
      const sorted = [...prices].sort((a, b) => a - b);
      const clip = sorted.length >= 20;
      const lo = clip ? sorted[Math.floor(sorted.length * 0.05)] : sorted[0];
      const hi = clip ? sorted[Math.ceil(sorted.length * 0.95) - 1] : sorted[sorted.length - 1];
      if (hi > lo) {
        const buckets = new Array(8).fill(0) as number[];
        for (const p of sorted) {
          if (p < lo || p > hi) continue;
          buckets[Math.min(7, Math.floor(((p - lo) / (hi - lo)) * 8))]++;
        }
        histogram = { min: lo, max: hi, buckets };
      }
    }

    // Per-type slice: count + median + p25-p75 band + the nearest listing of that type
    // (docs arrive distance-sorted, so byType arrays are nearest-first already).
    const typeMix: TypeSlice[] = [...byType.entries()]
      .map(([label, ls]) => {
        const ps = ls.map((l) => l.price).filter((p) => p > 0).sort((a, b) => a - b);
        return {
          label,
          count: ls.length,
          medianAsking: median(ps),
          p25: ps.length >= 3 ? percentile(ps, 0.25) : null,
          p75: ps.length >= 3 ? percentile(ps, 0.75) : null,
          nearest: ls[0] ?? null,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Feed events: NEW (entered ≤30d, newest first) then CUT (biggest cut first —
    // cuts have no event date on the doc, so they sort below the dated rows).
    const newCutoff = Date.now() - NEW_EVENT_DAYS * 86_400_000;
    const newEvents: ActiveEvent[] = all
      .filter((l) => l.entryMs !== null && l.entryMs >= newCutoff)
      .sort((a, b) => (b.entryMs ?? 0) - (a.entryMs ?? 0))
      .slice(0, MAX_NEW_EVENTS)
      .map((listing) => ({ kind: "new" as const, listing }));
    const newIds = new Set(newEvents.map((e) => e.listing.id));
    const cutEvents: ActiveEvent[] = all
      .filter((l) => l.dropAmount > 0 && !newIds.has(l.id))
      .sort((a, b) => b.dropAmount - a.dropAmount)
      .slice(0, MAX_CUT_EVENTS)
      .map((listing) => ({ kind: "cut" as const, listing }));

    return {
      listings,
      totalFound: res.found ?? listings.length,
      radiusKm,
      stats: {
        medianAsking: median(prices),
        medianPsf: median(psfs),
        medianDaysListed: median(doms),
      },
      histogram,
      typeMix,
      momentum: {
        cutCount: cuts.length,
        cutShare: all.length ? cuts.length / all.length : 0,
        medianCut: median(cuts),
        newThisWeek,
        sitting30,
      },
      events: [...newEvents, ...cutEvents],
      // Sale-side matrices use sale mode: no basement classifier / Rule B (rent logic).
      bedsTypeMatrix: buildBedsTypeMatrix(all, { mode: isLease ? "rent" : "sale" }),
      pins: all
        .filter((l) => l.lat !== null && l.lng !== null)
        .map((l) => ({
          id: l.id,
          address: l.address,
          price: l.price,
          lat: l.lat as number,
          lng: l.lng as number,
          cut: l.dropAmount > 0,
          dropAmount: l.dropAmount,
          distanceM: l.distanceM,
        })),
    };
  } catch (err) {
    console.error("[nearbyForSale] search failed:", err);
    return null;
  }
}
