/**
 * The monthly Street Recap — payload builder.
 *
 * The owner-facing email that replaced the "your home's value moved" idea. It carries NO
 * valuation, and that is the whole design: `property_estimates` covers ACTIVE listings only,
 * and only ~21% of homes in our markets appear in the vault at all, so a per-home estimate
 * would be a model output the reader could disprove from their own kitchen. Real sales near
 * a real address cannot be disproved. See docs/strategy §Personal engine.
 *
 * Pure and synchronous — every input is passed in, so the whole thing is unit-testable with
 * no database. `./data.ts` does the fetching, exactly as the Data Drop splits payload/data.
 *
 * NO PRICE EVER APPEARS. Counts, shares and day-counts only. That is not squeamishness: it
 * means ONE rendering serves a reader who accepted VOW terms and one who never did, with no
 * gate and no second variant. A test enforces it.
 */

/** Public-safety floor for a published aggregate — mirrors MIN_SAMPLE_N across the repo. */
export const MIN_SALES = 5;

/** Below this many actives we do not characterise the standing inventory. */
export const MIN_ACTIVES = 8;

export type ScopeKind = "region" | "fsa" | "city";

export interface RecapScope {
  kind: ScopeKind;
  /** What the reader sees: "Patterson", "L6A", "Vaughan". */
  label: string;
  city: string;
}

export interface TypeRow {
  /** "Detached", "Condo Apartment", … verbatim from the feed. */
  type: string;
  sales: number;
  medianDom: number | null;
}

export interface SoldAgg {
  sales: number;
  aboveAsking: number;
  medianDom: number | null;
  byType: TypeRow[];
}

export interface ActiveAgg {
  active: number;
  cutPrice: number;
  medianTrueDom: number | null;
}

export interface StreetRecapPayload {
  scope: RecapScope;
  /** The home the reader asked us about. Rendered, never used to compute. */
  address: string;
  /** "August" — the window the figures describe. */
  monthLabel: string;
  local: SoldAgg;
  /** The city the scope sits in, as the comparison. Null when scope IS the city. */
  cityAgg: SoldAgg | null;
  actives: ActiveAgg | null;
  /** Share of local sales that closed above asking, 0-100. Null below the floor. */
  abovePct: number | null;
  cityAbovePct: number | null;
  /** Share of standing inventory that has cut, 0-100. */
  cutPct: number | null;
  dataAsOf: string | null;
}

export interface BuildInput {
  address: string;
  /** Tightest first. The builder walks down until one clears MIN_SALES. */
  candidates: { scope: RecapScope; sold: SoldAgg }[];
  /** The city rollup, used as the comparison and as the last rung. */
  city: { scope: RecapScope; sold: SoldAgg };
  actives: ActiveAgg | null;
  dataAsOf: string | null;
  now: number;
}

const pct = (n: number, d: number): number | null =>
  d > 0 ? Math.round((n / d) * 1000) / 10 : null;

/** The month the window describes, in the reader's timezone. */
export function monthLabel(now: number): string {
  return new Date(now).toLocaleDateString("en-CA", {
    month: "long",
    timeZone: "America/Toronto",
  });
}

/**
 * Build one recipient's recap, or null when even the city cannot clear the floor.
 *
 * THE SCOPE LADDER. A neighbourhood is a better email than a city — "Patterson" is where
 * they live, "Vaughan" is an administrative fact about them — so the tightest cohort that
 * clears MIN_SALES wins. Falling back is not a degradation the reader should notice: the
 * label simply names a wider area, and every figure stays true of it.
 *
 * Returning null rather than publishing a thin cohort is the same rule the Data Drop's
 * ladder follows. A recap built on three sales is not a quiet month; it is a number that
 * should not have been printed.
 */
export function buildStreetRecapPayload(i: BuildInput): StreetRecapPayload | null {
  const chosen =
    i.candidates.find((c) => c.sold.sales >= MIN_SALES) ??
    (i.city.sold.sales >= MIN_SALES ? i.city : null);

  if (!chosen) return null;

  const isCity = chosen.scope.kind === "city";
  const cityAgg = isCity ? null : i.city.sold;

  return {
    scope: chosen.scope,
    address: i.address,
    monthLabel: monthLabel(i.now),
    local: chosen.sold,
    cityAgg,
    actives: i.actives && i.actives.active >= MIN_ACTIVES ? i.actives : null,
    abovePct: pct(chosen.sold.aboveAsking, chosen.sold.sales),
    cityAbovePct: cityAgg ? pct(cityAgg.aboveAsking, cityAgg.sales) : null,
    cutPct:
      i.actives && i.actives.active >= MIN_ACTIVES
        ? pct(i.actives.cutPrice, i.actives.active)
        : null,
    dataAsOf: i.dataAsOf,
  };
}

/**
 * The property types worth printing, tightest cohort first.
 *
 * Capped at three and floored at MIN_SALES apiece. The split is the line a reader forwards
 * to a neighbour — "a townhouse near you sells in two weeks, a condo takes six" — but only
 * while each number rests on enough sales to mean anything.
 */
export function printableTypes(rows: TypeRow[], limit = 3): TypeRow[] {
  return rows
    .filter((r) => r.sales >= MIN_SALES && r.medianDom != null)
    .sort((a, b) => b.sales - a.sales)
    .slice(0, limit);
}

/**
 * The one comparison the email leads on: local days-to-sell against the city's.
 *
 * Returns null when there is nothing to say — no city comparison, or the two are close
 * enough that a claim of "faster" or "slower" would be noise. Two days on a ~20-day median
 * is inside the week-to-week wobble of any neighbourhood cohort.
 */
export function domVerdict(
  p: StreetRecapPayload,
  minGapDays = 3
): { faster: boolean; gapDays: number } | null {
  const local = p.local.medianDom;
  const city = p.cityAgg?.medianDom ?? null;
  if (local == null || city == null) return null;
  const gap = city - local;
  if (Math.abs(gap) < minGapDays) return null;
  return { faster: gap > 0, gapDays: Math.abs(Math.round(gap)) };
}
