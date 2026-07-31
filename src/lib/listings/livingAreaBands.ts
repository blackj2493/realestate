/**
 * TRREB LivingAreaRange → numeric bounds.
 *
 * TRREB does not publish a square-footage NUMBER for residential listings — it
 * publishes a BAND ("1100-1500"). Measured 2026-07-30 against the production
 * index: of 81,570 active houses, 81,555 carry a band and **zero** carry an exact
 * BuildingAreaTotal; condos are 37,932 of 37,933. Exact sqft is effectively a
 * commercial-only field (14,761 of the 14,794 exact values sit outside
 * residential). So for a house or a condo the band is not a fallback — it is the
 * only size signal that exists.
 *
 * Everything that filters on size must therefore work in INTERVALS, not in
 * collapsed midpoints. A midpoint answers "is this home ≥ 1,800 sqft?" with a
 * confidence the feed cannot support; an interval answers it with "definitely",
 * "possibly", or "no", which is the truth.
 *
 * Two vocabularies are in play and they do NOT share edges:
 *   - freehold: 9 coarse bands, 400–1,500 sqft wide, edges at 700/1100/1500/…
 *   - condo:   16 fine bands, 100–250 sqft wide, edges at 500/600/700/800/…
 * Within one vocabulary the bands tile the axis cleanly, so a band-aligned range
 * is unambiguous. Ambiguity comes from the two colliding: ~2,100 non-condo
 * listings are filed on the condo scale, and their bands straddle the freehold
 * edges. That collision is precisely what {@link overlapsRange} surfaces.
 *
 * Dependency-free on purpose — imported by both the Next app and the ETL workers.
 */

/** Stand-in for "no upper bound" (`5000 +`). Typesense int32 can't hold Infinity. */
export const SQFT_OPEN_MAX = 999_999;

/** Sentinel written to sqft_min/sqft_max when a listing reports no size at all.
 *  A real filter clause (`sqft_min:>=700`) excludes it naturally, while
 *  `sqft_min:=-1` can still surface it deliberately — so "no size reported" is a
 *  choice the user makes rather than a silent omission. */
export const SQFT_UNKNOWN = -1;

/** Half-open interval [lo, hi): lo is inclusive, hi is exclusive. */
export interface SqftBounds {
  lo: number;
  hi: number;
}

export interface SqftBand extends SqftBounds {
  /** The raw TRREB string, exactly as fed. */
  label: string;
  /** Short tick text for the slider scale. */
  tick: string;
}

/**
 * The freehold scale. TRREB writes these uppers as the NEXT band's lower
 * ("700-1100" then "1100-1500"), so the upper is already exclusive.
 */
export const FREEHOLD_BANDS: SqftBand[] = [
  { label: '< 700',     tick: '<700',  lo: 0,    hi: 700 },
  { label: '700-1100',  tick: '700',   lo: 700,  hi: 1100 },
  { label: '1100-1500', tick: '1100',  lo: 1100, hi: 1500 },
  { label: '1500-2000', tick: '1500',  lo: 1500, hi: 2000 },
  { label: '2000-2500', tick: '2000',  lo: 2000, hi: 2500 },
  { label: '2500-3000', tick: '2500',  lo: 2500, hi: 3000 },
  { label: '3000-3500', tick: '3000',  lo: 3000, hi: 3500 },
  { label: '3500-5000', tick: '3500',  lo: 3500, hi: 5000 },
  { label: '5000 +',    tick: '5000+', lo: 5000, hi: SQFT_OPEN_MAX },
];

/**
 * The condo scale. TRREB writes these uppers as INCLUSIVE ("1000-1199" then
 * "1200-1399"), so each exclusive upper is the stated upper + 1.
 */
export const CONDO_BANDS: SqftBand[] = [
  { label: '0-499',     tick: '0',     lo: 0,    hi: 500 },
  { label: '500-599',   tick: '500',   lo: 500,  hi: 600 },
  { label: '600-699',   tick: '600',   lo: 600,  hi: 700 },
  { label: '700-799',   tick: '700',   lo: 700,  hi: 800 },
  { label: '800-899',   tick: '800',   lo: 800,  hi: 900 },
  { label: '900-999',   tick: '900',   lo: 900,  hi: 1000 },
  { label: '1000-1199', tick: '1000',  lo: 1000, hi: 1200 },
  { label: '1200-1399', tick: '1200',  lo: 1200, hi: 1400 },
  { label: '1400-1599', tick: '1400',  lo: 1400, hi: 1600 },
  { label: '1600-1799', tick: '1600',  lo: 1600, hi: 1800 },
  { label: '1800-1999', tick: '1800',  lo: 1800, hi: 2000 },
  { label: '2000-2249', tick: '2000',  lo: 2000, hi: 2250 },
  { label: '2250-2499', tick: '2250',  lo: 2250, hi: 2500 },
  { label: '2500-2749', tick: '2500',  lo: 2500, hi: 2750 },
  { label: '2750-2999', tick: '2750',  lo: 2750, hi: 3000 },
  { label: '3000-3249', tick: '3000',  lo: 3000, hi: 3250 },
  { label: '3250-3499', tick: '3250',  lo: 3250, hi: 3500 },
  { label: '3500-3749', tick: '3500',  lo: 3500, hi: 3750 },
  { label: '3750-3999', tick: '3750',  lo: 3750, hi: 4000 },
  { label: '4000-4249', tick: '4000',  lo: 4000, hi: 4250 },
  { label: '4250-4499', tick: '4250',  lo: 4250, hi: 4500 },
];

export type SqftScale = 'freehold' | 'condo';

export function bandsForScale(scale: SqftScale): SqftBand[] {
  return scale === 'condo' ? CONDO_BANDS : FREEHOLD_BANDS;
}

/** Condo subtypes are graded on the fine scale; everything else on the coarse one. */
export function scaleForSubType(subType: string | null | undefined): SqftScale {
  return /condo/i.test(String(subType ?? '')) ? 'condo' : 'freehold';
}

/** Exact-string lookup for every band TRREB is known to emit. */
const BY_LABEL = new Map<string, SqftBounds>();
for (const b of [...FREEHOLD_BANDS, ...CONDO_BANDS]) {
  // Freehold wins ties — there are none today, but a duplicate label would mean
  // the two scales had converged, and the coarse reading is the safe default.
  if (!BY_LABEL.has(b.label)) BY_LABEL.set(b.label, { lo: b.lo, hi: b.hi });
}

/** `1199` → inclusive upper (add 1); `1500` → already the next band's lower. */
function exclusiveUpper(stated: number): number {
  return stated % 10 === 9 ? stated + 1 : stated;
}

/**
 * Parse a LivingAreaRange into half-open [lo, hi) bounds, or null when the value
 * carries no usable size.
 *
 * Known labels resolve by table lookup; anything TRREB introduces later falls
 * through to a shape-based read, so a new band degrades to approximately-right
 * rather than to null. Both open-ended forms are handled — `livingAreaRangeToInt`
 * in the ingester historically could not parse either, which is what nulled
 * 5,607 sold rows and 5,748 active listings.
 */
export function parseLivingAreaBand(value: unknown): SqftBounds | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === '') return null;

  const known = BY_LABEL.get(s);
  if (known) return { ...known };

  // "1100-1500" / "1000 - 1199"
  const range = s.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    const lo = Number(range[1]);
    const hi = exclusiveUpper(Number(range[2]));
    return hi > lo ? { lo, hi } : null;
  }

  // "5000 +" / "5000+"
  const open = s.match(/(\d+)\s*\+/);
  if (open) {
    const lo = Number(open[1]);
    return lo > 0 ? { lo, hi: SQFT_OPEN_MAX } : null;
  }

  // "< 700" / "under 700"
  const below = s.match(/(?:<|under)\s*(\d+)/i);
  if (below) {
    const hi = Number(below[1]);
    return hi > 0 ? { lo: 0, hi } : null;
  }

  // A bare number is a point, not a band.
  const bare = s.match(/^(\d+(?:\.\d+)?)$/);
  if (bare) {
    const n = Math.round(Number(bare[1]));
    return n > 0 ? { lo: n, hi: n + 1 } : null;
  }

  return null;
}

/**
 * The size bounds to index for a listing: an exact BuildingAreaTotal collapses to
 * a one-wide interval, otherwise the band's own bounds, otherwise unknown.
 *
 * Reading the exact value first matches `resolveLivingArea`'s priority chain, so
 * the filter and the AVM agree on which signal wins.
 */
export function sqftBoundsFor(payload: {
  BuildingAreaTotal?: unknown;
  LivingAreaRange?: unknown;
} | null | undefined): SqftBounds {
  const exactRaw = payload?.BuildingAreaTotal;
  if (exactRaw !== undefined && exactRaw !== null && exactRaw !== '') {
    const n = Number(exactRaw);
    // Same sanity window as feeStability's SQFT_MIN/SQFT_MAX (100 / 20,000),
    // restated rather than imported so this module stays dependency-free for the
    // ETL workers. A 5-sqft or 999,999-sqft "exact" value is a data-entry error,
    // and indexing it would let one bad row dominate every range query.
    if (Number.isFinite(n) && n >= 100 && n <= 20_000) {
      const r = Math.round(n);
      return { lo: r, hi: r + 1 };
    }
  }

  const band = parseLivingAreaBand(payload?.LivingAreaRange);
  if (band) return band;

  return { lo: SQFT_UNKNOWN, hi: SQFT_UNKNOWN };
}

/** Does this listing report a size at all? */
export function hasSqft(bounds: SqftBounds): boolean {
  return bounds.lo !== SQFT_UNKNOWN;
}

/** The listing's whole size band sits inside [lo, hi) — a certain match. */
export function withinRange(b: SqftBounds, lo: number, hi: number): boolean {
  return hasSqft(b) && b.lo >= lo && b.hi <= hi;
}

/** The band touches [lo, hi) — a certain match OR a straddler. */
export function overlapsRange(b: SqftBounds, lo: number, hi: number): boolean {
  return hasSqft(b) && b.lo < hi && b.hi > lo;
}
