/**
 * Weekly Data Drop — payload builder (engagement plan WS2, Unit 4).
 *
 * Turns the nightly board precomputes into ONE headline, THREE supporting rows and a set of
 * links, scoped to a recipient's saved markets or to the province when they have none.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HARD RULE: this module reads the BOARD MODULES and `metric_snapshots`, and NOTHING ELSE.
 * It must never query Typesense or `raw_vow_sold` directly. Every board carries "Aggregate
 * statistics only — no listing rows, ever", so reading only boards keeps the widest send we
 * make inside the IDX §6.3(b) aggregate exemption BY CONSTRUCTION — and keeps the email from
 * restating a figure the public pages compute differently (the #250 failure).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE HEADLINE IS A MOVE, NOT A LEVEL. "Toronto median price $1,043,000" is a fact nobody
 * can act on and can read anywhere; "34% of sellers have cut their price, up from 27% four
 * weeks ago" is a negotiating position. A deterministic ladder picks the lead, ordered by
 * CONSEQUENCE TO A DECISION rather than by magnitude. No LLM touches this — CLAUDE.md
 * forbids passing feed data through one, and a ladder is testable besides.
 *
 * Deltas come from `metric_snapshots` (migration 090), which already stores one row per
 * (day, region, metric) with 400-day retention. No new table.
 *
 * Pure and synchronous: every input is passed in, so the ladder is unit-testable without a
 * database. `loadDataDropInputs` (./data.ts) does the fetching.
 */
import type { MarketRow } from "@/lib/data/marketBoard";
import type { CompetitionRow } from "@/lib/data/competitionBoard";

// ── Public shapes ─────────────────────────────────────────────────────────────

export type HeadlineKind =
  | "over_ask_flip"
  | "leverage"
  | "speed"
  | "supply"
  | "bidding"
  | "price";

export interface Headline {
  kind: HeadlineKind;
  /** Big monospace number, already formatted (e.g. "34", "52", "$1.04M"). */
  figure: string;
  /** Unit rendered smaller beside the figure ("%", " days", ""). */
  unit: string;
  /** Completes the sentence the figure starts. */
  lede: string;
  /** The comparison and its consequence. */
  because: string;
}

export interface SupportRow {
  label: string;
  value: string;
  context: string;
}

export interface TrackerLink {
  label: string;
  slug: string;
}

export interface OtherMarket {
  region: string;
  value: string;
}

export interface SpreadNote {
  low: { region: string; pct: number };
  high: { region: string; pct: number };
}

export interface DataDropPayload {
  /** "market" = the reader picked this place. "province" = they have saved nothing. */
  scope: "market" | "province";
  region: string;
  weekId: string;
  headline: Headline;
  rows: SupportRow[];
  others: OtherMarket[];
  /** Province sends only: proof that the average hides their city. */
  spread: SpreadNote | null;
  trackers: TrackerLink[];
  dataAsOf: string | null;
}

// ── Snapshot history ──────────────────────────────────────────────────────────

export interface SnapshotEntry {
  region: string;
  metric: string;
  captured_on: string;
  value: number | null;
}

/** region:metric -> ascending [day, value] pairs. */
export type SnapshotIndex = Map<string, { day: string; value: number }[]>;

export function indexSnapshots(entries: SnapshotEntry[]): SnapshotIndex {
  const idx: SnapshotIndex = new Map();
  for (const e of entries) {
    if (e.value == null || !Number.isFinite(e.value)) continue;
    const key = `${e.region}:${e.metric}`;
    const list = idx.get(key);
    if (list) list.push({ day: e.captured_on, value: e.value });
    else idx.set(key, [{ day: e.captured_on, value: e.value }]);
  }
  for (const list of idx.values()) list.sort((a, b) => a.day.localeCompare(b.day));
  return idx;
}

const DAY_MS = 86_400_000;

/** The reserved region key for the synthesized province aggregate. */
export const PROVINCE_REGION = "Ontario";

/**
 * Build "Ontario" history rows by aggregating each day's per-market snapshots.
 *
 * `metric_snapshots` is keyed by the 15 real markets — there is no Ontario row and never will
 * be. Without this, EVERY delta rank (leverage, speed, supply) silently skips on the province
 * send and the ladder drops straight to rank 7, which is the newsletter-of-levels failure the
 * whole design exists to prevent. It is a quiet failure: nothing errors, the email just gets
 * boring, and that is exactly the shape that survives review.
 *
 * The aggregation MUST match `syntheticProvinceRow` metric for metric — inventory-weighted
 * for rates, summed for counts, median-of-medians for price. Comparing a weighted present
 * against an unweighted past would manufacture a move that never happened.
 */
export function synthesizeProvinceSnapshots(entries: SnapshotEntry[]): SnapshotEntry[] {
  // day -> region -> metric -> value
  const byDay = new Map<string, Map<string, Map<string, number>>>();
  for (const e of entries) {
    if (e.value == null || !Number.isFinite(e.value)) continue;
    if (e.region === PROVINCE_REGION) continue;
    let regions = byDay.get(e.captured_on);
    if (!regions) byDay.set(e.captured_on, (regions = new Map()));
    let metrics = regions.get(e.region);
    if (!metrics) regions.set(e.region, (metrics = new Map()));
    metrics.set(e.metric, e.value);
  }

  const out: SnapshotEntry[] = [];
  for (const [day, regions] of byDay) {
    const cells = [...regions.values()].filter((m) => {
      const a = m.get("activeCount");
      return a != null && a > 0;
    });
    if (cells.length < 3) continue; // too thin a day to speak for a province

    const weighted = (metric: string): number | null => {
      let num = 0;
      let den = 0;
      for (const m of cells) {
        const v = m.get(metric);
        const w = m.get("activeCount");
        if (v == null || w == null) continue;
        num += v * w;
        den += w;
      }
      return den > 0 ? num / den : null;
    };
    const median = (metric: string): number | null => {
      const vals = cells.map((m) => m.get(metric)).filter(isNum).sort((a, b) => a - b);
      if (!vals.length) return null;
      const mid = Math.floor(vals.length / 2);
      return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    };

    const push = (metric: string, value: number | null) => {
      if (value != null) out.push({ region: PROVINCE_REGION, metric, captured_on: day, value });
    };
    push("activeCount", cells.reduce((s, m) => s + (m.get("activeCount") ?? 0), 0));
    push("cutSharePct", weighted("cutSharePct"));
    push("trueDom", weighted("trueDom"));
    push("monthsOfSupply", weighted("monthsOfSupply"));
    push("medianPrice", median("medianPrice"));
  }
  return out;
}

/**
 * Largest single-night relative jump allowed inside a comparison window.
 *
 * A market metric built from trailing windows barely moves night over night. A big overnight
 * move across every region at once is a CODE event, not a market event — that is the premise
 * migration 090 was written on.
 */
export const MAX_OVERNIGHT_MOVE = 0.25;

/**
 * Does the window between two days contain an overnight discontinuity?
 *
 * WHY THIS EXISTS — a real incident, found while building this. On 2026-08-14, #344/#345
 * shipped feed-verified liveness for the active aggregates, price cuts and True DOM. Across
 * all 15 markets on the same night, `trueDom` fell 107 -> 62 and `cutSharePct` rose 17 -> 26.
 * The new numbers are the CORRECT ones; the old ones counted listings the feed had stopped
 * serving. But a four-week delta measured across that night compares the old method with the
 * new one, so "up 9 points from a month ago" describes a deploy, not the housing market —
 * and it would have gone out to the whole base stated as fact.
 *
 * Only a comparison whose window is methodologically continuous is honest. When it is not,
 * the rank returns null and the ladder falls through to one that does not need history.
 * Two consecutive captures more than 2 days apart are not treated as overnight — a canary
 * that missed nights should not be read as a discontinuity.
 */
export function hasDiscontinuity(
  list: { day: string; value: number }[],
  fromDay: string,
  toMs: number,
  threshold = MAX_OVERNIGHT_MOVE
): boolean {
  const fromMs = Date.parse(fromDay);
  const window = list.filter((p) => {
    const t = Date.parse(p.day);
    return t >= fromMs && t <= toMs;
  });
  for (let k = 1; k < window.length; k++) {
    const a = window[k - 1];
    const b = window[k];
    const nights = (Date.parse(b.day) - Date.parse(a.day)) / DAY_MS;
    if (nights > 2) continue; // a gap in coverage, not a jump
    if (a.value === 0) continue;
    if (Math.abs(b.value - a.value) / Math.abs(a.value) > threshold) return true;
  }
  return false;
}

/**
 * The value nearest to `daysAgo` before `now`, within `tolerance` days either side — or null
 * when the window since then contains a methodology break.
 *
 * NOT an exact-day lookup. The canary that writes these rows can miss a night (it has), and
 * an exact match would then silently return null and drop the whole rank. Nearest-within-a-
 * window degrades instead: a 26-day-old reading still answers "a month ago" honestly.
 */
export function priorValue(
  idx: SnapshotIndex,
  region: string,
  metric: string,
  now: number,
  daysAgo = 28,
  tolerance = 10
): { value: number; day: string } | null {
  const list = idx.get(`${region}:${metric}`);
  if (!list?.length) return null;
  const target = now - daysAgo * DAY_MS;
  let best: { day: string; value: number } | null = null;
  let bestGap = Infinity;
  for (const p of list) {
    const gap = Math.abs(Date.parse(p.day) - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  if (!best || bestGap > tolerance * DAY_MS) return null;
  if (hasDiscontinuity(list, best.day, now)) return null;
  return { value: best.value, day: best.day };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pct = (n: number, dp = 0) => `${n.toFixed(dp)}%`;
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** $1,043,000 -> "$1.04M". Big numbers read faster abbreviated in a headline. */
function compactMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return dollars(n);
}

/**
 * "one seller in three" — a share said the way a person would say it.
 *
 * Returns the whole phrase INCLUDING the noun, because "one in three sellers who has" is
 * broken agreement; the subject has to be the singular "one seller", not the plural.
 */
function asFraction(sharePct: number, noun: string): string | null {
  const denom = Math.round(100 / sharePct);
  if (!Number.isFinite(denom) || denom < 2 || denom > 10) return null;
  const words = ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return `one ${noun} in ${words[denom]}`;
}

/** ISO week id, e.g. "2026-W36" — the idempotency key's stable prefix. */
export function isoWeekId(now: number): string {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dt = new Date(t);
  // ISO: Thursday of the current week decides the year.
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThursday = Date.UTC(dt.getUTCFullYear(), 0, 4);
  const ft = new Date(firstThursday);
  const ftDayNum = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - ftDayNum + 3);
  const week = 1 + Math.round((dt.getTime() - ft.getTime()) / (7 * DAY_MS));
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Public-safety floor — mirrors snapshotPublicData.ts / viralityRubric.MIN_SAMPLE_N. */
export const MIN_SAMPLE_N = 5;
/** Rank 2: points of change in the share of listings that have cut. */
export const LEVERAGE_MIN_PTS = 4;
/** Rank 3: fractional change in True Days on Market. */
export const SPEED_MIN_FRAC = 0.2;
/** Rank 4: fractional change in active inventory. */
export const SUPPLY_MIN_FRAC = 0.15;
/** Rank 5: points of year-over-year change in the over-ask rate. */
export const BIDDING_MIN_PTS = 8;

// ── The ladder ────────────────────────────────────────────────────────────────

export interface LadderInput {
  region: string;
  row: MarketRow;
  competition: CompetitionRow | null;
  snapshots: SnapshotIndex;
  now: number;
}

/** One rung. Returns null when its threshold is not cleared or its inputs are missing. */
type Rung = (i: LadderInput) => Headline | null;

/**
 * RANK 1 — the bidding advantage changed hands.
 *
 * Specified as "pctOverAsk crosses 50%", but `pctOverAsk` is NOT one of the ten metrics
 * `snapshotFromRows` writes, so there is no four-week prior to cross against. Until it is
 * added, the crossing is measured against the board's own year-over-year figure
 * (`yoyOverAskPts`), which competitionBoard already computes. Weaker claim, works on day one.
 */
const rungOverAskFlip: Rung = (i) => {
  const c = i.competition;
  if (!c || !isNum(c.pctOverAsk) || !isNum(c.yoyOverAskPts)) return null;
  if (c.sampleCount < MIN_SAMPLE_N || c.priorSample < MIN_SAMPLE_N) return null;
  const prior = c.pctOverAsk - c.yoyOverAskPts;
  const crossed = prior >= 50 !== c.pctOverAsk >= 50;
  if (!crossed) return null;
  const nowMajority = c.pctOverAsk >= 50;
  return {
    kind: "over_ask_flip",
    figure: c.pctOverAsk.toFixed(0),
    unit: "%",
    lede: `of ${i.region} homes sold <b>above the seller's asking price</b> last month.`,
    because: nowMajority
      ? `A year ago it was ${pct(prior)}. Most homes here now go for more than the asking price.`
      : `A year ago it was ${pct(prior)}. For the first time in a year, most sellers are taking less than they asked.`,
  };
};

/** RANK 2 — how much room a buyer has. The share of listings that blinked first. */
const rungLeverage: Rung = (i) => {
  if (!isNum(i.row.cutShare)) return null;
  const nowPct = i.row.cutShare * 100;
  const prior = priorValue(i.snapshots, i.region, "cutSharePct", i.now);
  if (!prior) return null;
  const delta = nowPct - prior.value;
  if (Math.abs(delta) < LEVERAGE_MIN_PTS) return null;
  const frac = asFraction(nowPct, "seller");
  const dir = delta > 0 ? "up" : "down";
  return {
    kind: "leverage",
    figure: nowPct.toFixed(0),
    unit: "%",
    lede: `of active ${i.region} listings have <b>cut their asking price</b>.`,
    because:
      `Four weeks ago it was <b>${pct(prior.value)}</b> — ${dir} ${Math.abs(delta).toFixed(0)} points.` +
      (frac && delta > 0 ? ` That is ${frac} who has already moved first.` : ""),
  };
};

/** RANK 3 — how long a buyer has to decide. Relist-adjusted, so it is the real clock. */
const rungSpeed: Rung = (i) => {
  if (!isNum(i.row.trueDom)) return null;
  const prior = priorValue(i.snapshots, i.region, "trueDom", i.now);
  if (!prior || prior.value < 5) return null;
  const frac = (i.row.trueDom - prior.value) / prior.value;
  if (Math.abs(frac) < SPEED_MIN_FRAC) return null;
  const diff = Math.round(Math.abs(i.row.trueDom - prior.value));
  const slower = frac > 0;
  return {
    kind: "speed",
    figure: Math.round(i.row.trueDom).toString(),
    unit: " days",
    lede: `is how long a ${i.region} home now takes to sell.`,
    because: slower
      ? `Four weeks ago it was <b>${Math.round(prior.value)}</b>. You have ${diff} more days to decide than buyers had last month.`
      : `Four weeks ago it was <b>${Math.round(prior.value)}</b>. Homes are moving ${diff} days faster than they were last month.`,
  };
};

/**
 * RANK 4 — how much there is to choose from.
 *
 * Deliberately reports the CHANGE IN INVENTORY, not a "buyer's/seller's market" label. A
 * months-of-supply band is a number standing in for a category nobody publishes at this
 * grain, and this codebase has been burned by exactly that proxy-threshold move before.
 */
const rungSupply: Rung = (i) => {
  if (!isNum(i.row.activeCount)) return null;
  const prior = priorValue(i.snapshots, i.region, "activeCount", i.now);
  if (!prior || prior.value < 50) return null;
  const frac = (i.row.activeCount - prior.value) / prior.value;
  if (Math.abs(frac) < SUPPLY_MIN_FRAC) return null;
  const rising = frac > 0;
  return {
    kind: "supply",
    figure: i.row.activeCount.toLocaleString("en-CA"),
    unit: "",
    lede: `homes are for sale in ${i.region} right now.`,
    because: rising
      ? `That is <b>${pct(Math.abs(frac) * 100)}</b> more than four weeks ago — more choice, and more competition between sellers.`
      : `That is <b>${pct(Math.abs(frac) * 100)}</b> fewer than four weeks ago — less to choose from than buyers had last month.`,
  };
};

/** RANK 5 — the year-over-year read on bidding pressure, when no crossing happened. */
const rungBidding: Rung = (i) => {
  const c = i.competition;
  if (!c || !isNum(c.pctOverAsk) || !isNum(c.yoyOverAskPts)) return null;
  if (c.sampleCount < MIN_SAMPLE_N) return null;
  if (Math.abs(c.yoyOverAskPts) < BIDDING_MIN_PTS) return null;
  const down = c.yoyOverAskPts < 0;
  return {
    kind: "bidding",
    figure: c.pctOverAsk.toFixed(0),
    unit: "%",
    lede: `of ${i.region} sales closed <b>above the asking price</b> last month.`,
    because: down
      ? `That is <b>${Math.abs(c.yoyOverAskPts).toFixed(0)} points lower</b> than a year ago. Bidding pressure has come off.`
      : `That is <b>${c.yoyOverAskPts.toFixed(0)} points higher</b> than a year ago. Competition has picked up.`,
  };
};

/**
 * RANK 7 — the fallback. Always resolves where the market has data, and reads like it.
 *
 * The province wording differs on purpose and is not interchangeable: the Ontario figure is a
 * MEDIAN OF THE MARKET MEDIANS, which describes a typical market, not a typical home. Saying
 * "a typical Ontario home sold for $870K" would be a different and unsupported claim.
 */
const rungPrice: Rung = (i) => {
  if (!isNum(i.row.medianPrice)) return null;
  const yoy = i.row.yoyPct;
  const province = i.region === PROVINCE_REGION;
  return {
    kind: "price",
    figure: compactMoney(i.row.medianPrice),
    unit: "",
    lede: province
      ? `is the middle sold price across the markets we cover.`
      : `is what a typical ${i.region} home sold for last month.`,
    because: isNum(yoy)
      ? `That is <b>${yoy >= 0 ? "up" : "down"} ${pct(Math.abs(yoy), 1)}</b> from a year ago.`
      : `Measured across every sale we have on record for the month.`,
  };
};

/** The ladder, in order. First rung to clear its threshold wins. */
export const LADDER: { rank: number; kind: HeadlineKind; run: Rung }[] = [
  { rank: 1, kind: "over_ask_flip", run: rungOverAskFlip },
  { rank: 2, kind: "leverage", run: rungLeverage },
  { rank: 3, kind: "speed", run: rungSpeed },
  { rank: 4, kind: "supply", run: rungSupply },
  { rank: 5, kind: "bidding", run: rungBidding },
  { rank: 7, kind: "price", run: rungPrice },
];

export interface LadderTrace {
  rank: number;
  kind: HeadlineKind;
  result: "FIRED" | "skip";
}

export function pickHeadline(i: LadderInput): { headline: Headline; trace: LadderTrace[] } | null {
  const trace: LadderTrace[] = [];
  for (const rung of LADDER) {
    const out = rung.run(i);
    trace.push({ rank: rung.rank, kind: rung.kind, result: out ? "FIRED" : "skip" });
    if (out) return { headline: out, trace };
  }
  return null;
}

// ── Supporting rows ───────────────────────────────────────────────────────────

/**
 * The three rows never move between weeks — pressure, leverage, speed. A fixed skeleton is
 * what lets a reader scan the email in six seconds by week three; only the lead rotates.
 * A row whose data is missing is DROPPED, never rendered as a dash.
 */
function buildRows(i: LadderInput): SupportRow[] {
  const rows: SupportRow[] = [];
  const c = i.competition;

  if (c && isNum(c.pctOverAsk) && c.sampleCount >= MIN_SAMPLE_N) {
    rows.push({
      label: "Sold above asking",
      value: pct(c.pctOverAsk),
      context: isNum(c.yoyOverAskPts)
        ? `${c.yoyOverAskPts >= 0 ? "up" : "down"} ${Math.abs(c.yoyOverAskPts).toFixed(0)} points vs last year`
        : "of sales last month",
    });
  }

  if (isNum(i.row.medianCutAmt)) {
    rows.push({
      label: "Typical price cut",
      value: dollars(i.row.medianCutAmt),
      context: "median, among those that cut",
    });
  } else if (isNum(i.row.cutShare)) {
    rows.push({
      label: "Homes cutting price",
      value: pct(i.row.cutShare * 100),
      context: "of active listings",
    });
  }

  if (isNum(i.row.trueDom)) {
    const prior = priorValue(i.snapshots, i.region, "trueDom", i.now);
    rows.push({
      label: "Days to sell",
      value: Math.round(i.row.trueDom).toString(),
      context: prior
        ? `${i.row.trueDom >= prior.value ? "up" : "down"} from ${Math.round(prior.value)} a month ago`
        : "relist-adjusted",
    });
  }

  // Never repeat the headline's own figure as a row — one question, one answer.
  return rows.filter((r) => !(i.region && r.value === undefined)).slice(0, 3);
}

const TRACKERS: TrackerLink[] = [
  { label: "Price cuts", slug: "price-cuts" },
  { label: "Days on market", slug: "days-on-market" },
  { label: "Sold over asking", slug: "over-asking" },
];

// ── Entry point ───────────────────────────────────────────────────────────────

export interface BuildInput {
  /** The recipient's saved markets, already intersected with BOARD_MARKETS. */
  regions: string[];
  rows: MarketRow[];
  /** Neighbourhood/city competition cells. */
  competitionByCity: Map<string, CompetitionRow>;
  /** The reserved province-wide competition rollup. */
  province: CompetitionRow | null;
  snapshots: SnapshotIndex;
  dataAsOf: string | null;
  now: number;
}

export interface BuildResult {
  payload: DataDropPayload;
  trace: LadderTrace[];
}

/**
 * Build one recipient's payload, or null when no honest headline exists.
 *
 * A null is a SKIP, not an error: a skipped week costs nothing, while a week that ships a
 * dash or a bare "0" costs the open rate of the next twelve.
 */
export function buildDataDropPayload(i: BuildInput): BuildResult | null {
  const weekId = isoWeekId(i.now);
  const byRegion = new Map(i.rows.map((r) => [r.region, r]));

  // Rank every saved market by how strong a lead it produces, then lead with the best.
  const candidates: { region: string; res: NonNullable<ReturnType<typeof pickHeadline>> }[] = [];
  for (const region of i.regions) {
    const row = byRegion.get(region);
    if (!row) continue;
    const res = pickHeadline({
      region,
      row,
      competition: i.competitionByCity.get(region) ?? null,
      snapshots: i.snapshots,
      now: i.now,
    });
    if (res) candidates.push({ region, res });
  }

  if (candidates.length > 0) {
    const rankOf = (k: HeadlineKind) => LADDER.find((l) => l.kind === k)?.rank ?? 99;
    candidates.sort((a, b) => rankOf(a.res.headline.kind) - rankOf(b.res.headline.kind));
    const win = candidates[0];
    const row = byRegion.get(win.region)!;
    const ladderInput: LadderInput = {
      region: win.region,
      row,
      competition: i.competitionByCity.get(win.region) ?? null,
      snapshots: i.snapshots,
      now: i.now,
    };
    const others: OtherMarket[] = candidates
      .slice(1, 5)
      .map((c) => {
        const r = byRegion.get(c.region);
        return isNum(r?.cutShare)
          ? { region: c.region, value: `${pct(r!.cutShare! * 100)} cutting price` }
          : null;
      })
      .filter((o): o is OtherMarket => o !== null);

    return {
      payload: {
        scope: "market",
        region: win.region,
        weekId,
        headline: win.res.headline,
        rows: buildRows(ladderInput),
        others,
        spread: null,
        trackers: TRACKERS,
        dataAsOf: i.dataAsOf,
      },
      trace: win.res.trace,
    };
  }

  // ── Province-wide. NOT a fallback: 70.6% of the base has saved no market, so this is
  // seven sends in ten. Its job is conversion, and the spread is what makes the ask land.
  const provinceRow = syntheticProvinceRow(i.rows);
  if (!provinceRow) return null;
  const res = pickHeadline({
    region: "Ontario",
    row: provinceRow,
    competition: i.province,
    snapshots: i.snapshots,
    now: i.now,
  });
  if (!res) return null;

  return {
    payload: {
      scope: "province",
      region: "Ontario",
      weekId,
      headline: res.headline,
      rows: buildRows({
        region: "Ontario",
        row: provinceRow,
        competition: i.province,
        snapshots: i.snapshots,
        now: i.now,
      }),
      others: [],
      spread: computeSpread(i.competitionByCity),
      trackers: TRACKERS,
      dataAsOf: i.dataAsOf,
    },
    trace: res.trace,
  };
}

/**
 * A province-level MarketRow assembled from the per-market rows.
 *
 * region_metrics holds no "Ontario" row, and the competition/rent boards' province rollups
 * carry only their own columns. Medians of medians are not medians — so this reports
 * INVENTORY-WEIGHTED figures where weighting is meaningful and a plain median of the market
 * medians for price, which is the honest summary of "a typical market", not "a typical home".
 */
function syntheticProvinceRow(rows: MarketRow[]): MarketRow | null {
  const usable = rows.filter((r) => isNum(r.activeCount) && r.activeCount! > 0);
  if (usable.length === 0) return null;
  const totalActive = usable.reduce((s, r) => s + (r.activeCount ?? 0), 0);

  const weighted = (pick: (r: MarketRow) => number | null): number | null => {
    let num = 0;
    let den = 0;
    for (const r of usable) {
      const v = pick(r);
      if (!isNum(v)) continue;
      num += v * (r.activeCount ?? 0);
      den += r.activeCount ?? 0;
    }
    return den > 0 ? num / den : null;
  };
  const median = (pick: (r: MarketRow) => number | null): number | null => {
    const vals = usable.map(pick).filter(isNum).sort((a, b) => a - b);
    if (!vals.length) return null;
    const m = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
  };

  const base = usable[0];
  return {
    ...base,
    region: "Ontario",
    activeCount: totalActive,
    medianPrice: median((r) => r.medianPrice),
    avgPrice: median((r) => r.avgPrice),
    yoyPct: weighted((r) => r.yoyPct),
    cutShare: weighted((r) => r.cutShare),
    medianCutAmt: median((r) => r.medianCutAmt),
    medianCutPct: median((r) => r.medianCutPct),
    trueDom: weighted((r) => r.trueDom),
    soldToListPct: weighted((r) => r.soldToListPct),
    monthsOfSupply: weighted((r) => r.monthsOfSupply),
    priceSeries: [],
    rentalRows: [],
  };
}

/**
 * The spread across markets — the load-bearing sentence of the province send.
 *
 * It turns "nice statistic" into "this number is useless to me until I choose", which is the
 * only honest reason to pick a city. Needs a real gap to be worth saying.
 */
export function computeSpread(byCity: Map<string, CompetitionRow>): SpreadNote | null {
  const cells = [...byCity.values()].filter(
    (c) => isNum(c.pctOverAsk) && c.sampleCount >= MIN_SAMPLE_N
  );
  if (cells.length < 3) return null;
  let low = cells[0];
  let high = cells[0];
  for (const c of cells) {
    if (c.pctOverAsk < low.pctOverAsk) low = c;
    if (c.pctOverAsk > high.pctOverAsk) high = c;
  }
  if (high.pctOverAsk - low.pctOverAsk < 10) return null; // no story without a real gap
  return {
    low: { region: low.city, pct: low.pctOverAsk },
    high: { region: high.city, pct: high.pctOverAsk },
  };
}
