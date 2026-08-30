/**
 * Weekly Data Drop — input loader (Unit 4b).
 *
 * Fetches everything the pure builder needs, ONCE per run, and hands it over. Split from
 * payload.ts so the ladder stays unit-testable with no database.
 *
 * Reads the UNCACHED board computers on purpose: the worker runs outside a Next request, so
 * `unstable_cache` has no context, and a marketing send must see the same live values the
 * data-health canary validates rather than a snapshot cached for a page render.
 */
import { getServiceRoleClient } from "@/lib/supabase/client";
import { computeMarketBoardUncached, BOARD_MARKETS, type MarketRow } from "@/lib/data/marketBoard";
import { computeCompetitionBoardUncached, type CompetitionRow } from "@/lib/data/competitionBoard";
import {
  indexSnapshots,
  synthesizeProvinceSnapshots,
  type SnapshotEntry,
  type SnapshotIndex,
} from "./payload";

/** Metrics the ladder and the rows actually read. Fetching only these keeps the query small
 *  — and, more importantly, well under PostgREST's 1000-row default cap. */
const METRICS = ["cutSharePct", "trueDom", "activeCount", "monthsOfSupply", "medianPrice"];

/** How far back the deltas look, plus the tolerance window priorValue() searches. */
const HISTORY_DAYS = 45;

export interface DataDropInputs {
  rows: MarketRow[];
  competitionByCity: Map<string, CompetitionRow>;
  province: CompetitionRow | null;
  snapshots: SnapshotIndex;
  dataAsOf: string | null;
  /** Age of the newest board precompute, in hours. The freshness gate reads this. */
  ageHours: number | null;
}

/**
 * Board `dataAsOf` older than this and the run REFUSES to send.
 *
 * The dominant failure mode in this codebase is a metric that freezes rather than errors. A
 * weekly email restating a stale number to the whole base, with nothing raising a hand, is
 * exactly that shape. Sending nothing is always the better half of that trade.
 */
export const MAX_DATA_AGE_HOURS = 48;

export async function loadDataDropInputs(now: number): Promise<DataDropInputs> {
  const sb = getServiceRoleClient();

  const [board, competition] = await Promise.all([
    computeMarketBoardUncached(),
    computeCompetitionBoardUncached(),
  ]);

  // City-level competition cells, collapsed to one per city. The board returns
  // neighbourhood rows; the email speaks in cities, so take the largest-sample cell per city
  // rather than averaging rates across unequal samples.
  const byCity = new Map<string, CompetitionRow>();
  for (const r of competition.rows) {
    if (!BOARD_MARKETS.includes(r.city)) continue;
    const held = byCity.get(r.city);
    if (!held || r.sampleCount > held.sampleCount) byCity.set(r.city, r);
  }

  // The reserved province rollup the refresh job writes.
  const province =
    competition.summary.find((s) => s.group === "House") ?? competition.summary[0] ?? null;

  const since = new Date(now - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);

  // ── PAGE THIS. 15 regions x 5 metrics x 45 days = 3375 rows, and an unlimited supabase-js
  // select silently truncates at 1000 with no error and no signal. A truncated history does
  // not fail loudly — it just loses the oldest days, so "four weeks ago" quietly becomes
  // "eleven days ago" and the email states a delta that never happened.
  const PAGE = 1000;
  const entries: SnapshotEntry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from("metric_snapshots")
      .select("region, metric, captured_on, value")
      .in("metric", METRICS)
      .gte("captured_on", since)
      .order("captured_on", { ascending: true })
      .order("region", { ascending: true })
      .order("metric", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("[data-drop] metric_snapshots read failed:", error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const row = r as { region: string; metric: string; captured_on: string; value: string | number | null };
      entries.push({
        region: row.region,
        metric: row.metric,
        captured_on: row.captured_on,
        value: row.value == null ? null : Number(row.value),
      });
    }
    if (data.length < PAGE) break;
  }

  const days = new Set(entries.map((e) => e.captured_on));
  console.log(`   snapshots: ${entries.length} rows across ${days.size} days`);

  const ageHours =
    board.dataAsOf != null ? (now - Date.parse(board.dataAsOf)) / 3_600_000 : null;

  // metric_snapshots has no Ontario row, so the province send would otherwise have no
  // history and every delta rank would silently skip. Synthesize it the same way the
  // province MarketRow is built, or the comparison is not like-for-like.
  const withProvince = [...entries, ...synthesizeProvinceSnapshots(entries)];

  return {
    rows: board.rows,
    competitionByCity: byCity,
    province,
    snapshots: indexSnapshots(withProvince),
    dataAsOf: board.dataAsOf,
    ageHours,
  };
}

/** The recipient's saved markets, intersected with what the weekly can actually cover. */
export function scopeRegions(saved: string[]): string[] {
  return saved.filter((r) => BOARD_MARKETS.includes(r));
}
