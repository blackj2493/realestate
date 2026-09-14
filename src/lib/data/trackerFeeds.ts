/**
 * Per-tracker rankings, shaped for syndication (RSS) rather than for a table.
 *
 * WHY THIS IS NOT `embed/[tracker]`'s buildWidget. That function builds table COLUMNS;
 * a feed needs a SENTENCE. Same source boards, same filters, same sort order — different
 * output shape. Keeping them apart means a column change on the embed can never silently
 * reword a feed item, and a feed reword can never shift a published table.
 *
 * KEEP THE SORTS IN STEP. Every filter/sort below mirrors the matching branch of
 * `buildWidget` in `src/app/embed/[tracker]/page.tsx`. If a tracker's ranking changes
 * there, change it here too — a feed that ranks Vaughan first while the page ranks Milton
 * first is the kind of contradiction that costs a citation.
 *
 * COMPLIANCE. Aggregates only. See the header of `rss.ts`.
 */

import { getMarketBoard, type MarketRow } from "@/lib/data/marketBoard";
import { getCondoFeeBoard } from "@/lib/data/condoFeeBoard";
import { getRentBoard } from "@/lib/data/rentBoard";
import { getCompetitionBoard } from "@/lib/data/competitionBoard";
import { trackerBySlug } from "@/lib/data/trackers";

const DASH = "—";
const pct = (n: number | null | undefined, d = 1) => (n == null ? DASH : `${n.toFixed(d)}%`);
const money0 = (n: number | null | undefined) =>
  n == null ? DASH : `$${Math.round(n).toLocaleString("en-CA")}`;
const int = (n: number | null | undefined) => (n == null ? DASH : n.toLocaleString("en-CA"));
const signed = (n: number | null | undefined, d = 1) =>
  n == null ? DASH : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(d)}%`;

const TEMP_LABEL: Record<string, string> = {
  hot: "Seller's market",
  balanced: "Balanced",
  cold: "Buyer's market",
};

export interface RankedEntry {
  /** The place this row describes ("Vaughan", or "Toronto — Willowdale East · Condo"). */
  label: string;
  /** The ranked number, formatted ("31.2%"). */
  display: string;
  /** Supporting numbers, one line, already formatted. */
  detail: string;
}

export interface TrackerRanking {
  slug: string;
  title: string;
  /** What being first on this list means. Goes in the feed item's first line. */
  rankedBy: string;
  entries: RankedEntry[];
  dataAsOf: string | null;
}

/** Ranked rows for one tracker; null when the slug is unknown. */
export async function getTrackerRanking(slug: string): Promise<TrackerRanking | null> {
  const def = trackerBySlug(slug);
  if (!def || def.status !== "live") return null;
  const base = { slug, title: def.title };

  if (slug === "price-cuts") {
    const board = await getMarketBoard();
    const entries = board.rows
      .filter((r) => r.cutShare != null)
      .sort((a, b) => (b.cutShare ?? 0) - (a.cutShare ?? 0))
      .map((r) => ({
        label: r.region,
        display: pct((r.cutShare ?? 0) * 100),
        detail: `median cut ${pct(r.medianCutPct)} (${money0(r.medianCutAmt)} off) · ${int(r.cutCount)} of ${int(r.cutActive)} active listings have cut`,
      }));
    return { ...base, rankedBy: "Highest share of active listings that have cut their asking price", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "price-rankings") {
    const board = await getMarketBoard();
    const entries = board.rows
      .filter((r) => r.medianPrice != null)
      .sort((a, b) => (b.medianPrice ?? 0) - (a.medianPrice ?? 0))
      .map((r) => ({
        label: r.region,
        display: money0(r.medianPrice),
        detail: `${signed(r.yoyPct)} year-over-year · ${money0(r.medianPpsf)}/sqft`,
      }));
    return { ...base, rankedBy: "Highest median sold price, most recent month", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "days-on-market") {
    const board = await getMarketBoard();
    const entries = board.rows
      .filter((r) => r.soldMedianDom != null)
      .sort((a, b) => (a.soldMedianDom ?? 0) - (b.soldMedianDom ?? 0))
      .map((r) => ({
        label: r.region,
        display: `${int(r.soldMedianDom)} days`,
        detail: `middle half sold in ${int(r.soldP25Dom)}–${int(r.soldP75Dom)} days · ${int(r.trueDom)} days typical for what is still listed`,
      }));
    return { ...base, rankedBy: "Fastest median days-to-sell for recently sold homes", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "market-temperature") {
    const board = await getMarketBoard();
    const entries = board.rows
      .filter((r) => r.temperature != null)
      .sort((a, b) => (b.soldToListPct ?? 0) - (a.soldToListPct ?? 0))
      .map((r) => ({
        label: r.region,
        display: TEMP_LABEL[r.temperature ?? ""] ?? DASH,
        detail: `sold-to-list ${pct(r.soldToListPct)} · ${r.monthsOfSupply == null ? DASH : r.monthsOfSupply.toFixed(1)} months of supply`,
      }));
    return { ...base, rankedBy: "Strongest sold-to-list ratio (most competitive first)", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "rent-vs-buy") {
    const board = await getMarketBoard();
    // Two-bedroom is the comparable most publications quote (mirrors the embed).
    const entries = board.rows
      .map((r) => ({ region: r.region, rr: r.rentalRows.find((x) => x.beds === 2) }))
      .filter((x) => x.rr != null)
      .sort((a, b) => (b.rr?.grossYieldPct ?? 0) - (a.rr?.grossYieldPct ?? 0))
      .map((x) => ({
        label: x.region,
        display: pct(x.rr?.grossYieldPct, 2),
        detail: `${money0(x.rr?.typicalRent)}/mo rent on a ${money0(x.rr?.medianPrice)} two-bedroom`,
      }));
    return { ...base, rankedBy: "Highest gross rental yield on a two-bedroom", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "over-asking") {
    const board = await getCompetitionBoard();
    const entries = board.rows
      .slice()
      .sort((a, b) => b.pctOverAsk - a.pctOverAsk)
      .map((r) => ({
        label: `${r.city} — ${r.area} · ${r.group}`,
        display: pct(r.pctOverAsk),
        detail: `median sale-to-list ${pct(r.medianSaleToList)} · ${signed(r.yoyOverAskPts)} points vs last year · ${int(r.sampleCount)} sales`,
      }));
    return { ...base, rankedBy: "Highest share of sales closing above the final asking price", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "condo-fees") {
    const board = await getCondoFeeBoard();
    const entries = board.rows
      .slice()
      .sort((a, b) => b.annualPct - a.annualPct)
      .map((r) => ({
        label: `${r.city} — ${r.area}`,
        display: `${signed(r.annualPct)}/yr`,
        detail: `${r.medianPsf == null ? DASH : `$${r.medianPsf.toFixed(2)}/sqft/mo`} typical fee · ${int(r.buildingCount)} buildings`,
      }));
    return { ...base, rankedBy: "Fastest-rising condo maintenance fees, annualized", entries, dataAsOf: board.dataAsOf };
  }

  if (slug === "rents") {
    const board = await getRentBoard();
    // Mirrors the embed: three-bedroom houses, sample-gated so a thin cell never ranks.
    const entries = board.rows
      .filter((r) => r.group === "House" && r.beds === "3" && r.sampleCount >= 20)
      .sort((a, b) => b.medianRent - a.medianRent)
      .map((r) => ({
        label: `${r.city} — ${r.area}`,
        display: `${money0(r.medianRent)}/mo`,
        detail: `${money0(r.p25Rent)}–${money0(r.p75Rent)} middle half · ${signed(r.yoyPct)} year-over-year · ${int(r.sampleCount)} closed leases`,
      }));
    return { ...base, rankedBy: "Highest median closed rent on a three-bedroom house", entries, dataAsOf: board.dataAsOf };
  }

  return null;
}

export interface CityReading {
  /** What this line measures. */
  label: string;
  /** The value for this city, formatted. */
  value: string;
  /** Where the city places against every other market we cover ("3rd of 41"). */
  rank: string;
  /** The tracker this reading belongs to, for the item link. */
  trackerSlug: string;
}

export interface CityFeed {
  region: string;
  readings: CityReading[];
  dataAsOf: string | null;
}

/**
 * Every region-grade reading we hold for ONE market, each with its standing against the
 * rest of the board.
 *
 * Region grade is the point. The neighbourhood-keyed boards (over-asking, condo fees,
 * rents) are deliberately absent: they are cut by area and property group, so folding
 * them into a city line would mean inventing an aggregate that no published page shows.
 * A feed must never be the only place a number exists.
 */
export async function getCityFeed(region: string): Promise<CityFeed | null> {
  const board = await getMarketBoard();
  const row = board.rows.find((r) => r.region === region);
  if (!row) return null;

  const standing = <T,>(
    pick: (r: MarketRow) => T | null | undefined,
    better: (a: T, b: T) => number
  ): string => {
    const ranked = board.rows.filter((r) => pick(r) != null);
    const idx = ranked.slice().sort((a, b) => better(pick(a) as T, pick(b) as T)).findIndex((r) => r.region === region);
    return idx < 0 ? DASH : `${ordinal(idx + 1)} of ${ranked.length}`;
  };
  const desc = (a: number, b: number) => b - a;
  const asc = (a: number, b: number) => a - b;

  const readings: CityReading[] = [];
  const push = (label: string, value: string, rank: string, trackerSlug: string) => {
    if (value !== DASH) readings.push({ label, value, rank, trackerSlug });
  };

  push("Median sold price", money0(row.medianPrice), standing((r) => r.medianPrice, desc), "price-rankings");
  push("Year-over-year", signed(row.yoyPct), standing((r) => r.yoyPct, desc), "price-rankings");
  push("Listings cutting price", pct((row.cutShare ?? 0) * 100), standing((r) => r.cutShare, desc), "price-cuts");
  push("Median price cut", pct(row.medianCutPct), standing((r) => r.medianCutPct, desc), "price-cuts");
  push("Median days to sell", `${int(row.soldMedianDom)} days`, standing((r) => r.soldMedianDom, asc), "days-on-market");
  push("Sold-to-list ratio", pct(row.soldToListPct), standing((r) => r.soldToListPct, desc), "market-temperature");
  push("Months of supply", row.monthsOfSupply == null ? DASH : row.monthsOfSupply.toFixed(1), standing((r) => r.monthsOfSupply, asc), "market-temperature");
  push("Market type", TEMP_LABEL[row.temperature ?? ""] ?? DASH, DASH, "market-temperature");

  const twoBed = row.rentalRows.find((x) => x.beds === 2);
  if (twoBed) {
    push(
      "Gross yield, two-bedroom",
      pct(twoBed.grossYieldPct, 2),
      standing((r) => r.rentalRows.find((x) => x.beds === 2)?.grossYieldPct, desc),
      "rent-vs-buy"
    );
  }

  return { region, readings, dataAsOf: board.dataAsOf };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
