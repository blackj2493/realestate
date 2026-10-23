/**
 * "The cost of a price cut" — pure shaping for the /analytics panel (migration 157).
 *
 * The RPC returns five overlapping groups: none / under5 / 5to10 / over10 / 5plus, where
 * 5plus is the union of the last two. This file picks which of them a reader sees and turns
 * a group's median "sold ÷ first ask" into dollars for the reader's own first price.
 *
 * VOW: every figure is from sold prices. Shown to a signed-in reader only, never in email.
 */

/** A group with fewer sales than this is hidden: a median of a handful of sales is noise. */
export const MIN_GROUP_SALES = 20;

export type CutBucket = "none" | "under5" | "5to10" | "over10" | "5plus";

export interface CutGroup {
  bucket: CutBucket;
  sales: number;
  /** Median sold price as a % of the first asking price, e.g. 97.0. */
  pctOfFirstAsk: number;
  /** Median days on market, or null when the group has no usable dates. */
  medianDom: number | null;
  medianFirstAsk: number | null;
}

export interface PriceCutCost {
  months: number;
  groups: CutGroup[];
}

export const EMPTY_PRICE_CUT_COST: PriceCutCost = { months: 12, groups: [] };

export const BUCKET_LABEL: Record<CutBucket, string> = {
  none: "No price cut",
  under5: "Cut under 5%",
  "5to10": "Cut 5% to 10%",
  over10: "Cut over 10%",
  "5plus": "Cut 5% or more",
};

const BUCKETS = new Set<CutBucket>(["none", "under5", "5to10", "over10", "5plus"]);

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/** RPC rows → typed groups. Drops unknown buckets and rows without a share. */
export function parseCutRows(data: unknown): CutGroup[] {
  const rows = Array.isArray(data) ? data : [];
  const out: CutGroup[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const bucket = r.bucket as CutBucket;
    const pct = num(r.pct_of_first_ask);
    if (!BUCKETS.has(bucket) || pct == null) continue;
    out.push({
      bucket,
      sales: num(r.sales) ?? 0,
      pctOfFirstAsk: pct,
      medianDom: num(r.median_dom),
      medianFirstAsk: num(r.median_first_ask),
    });
  }
  return out;
}

/**
 * The groups to show, in order. The "no cut" group is the baseline, so without it there is
 * nothing to compare and nothing shows. Deep cuts show as 5-10% and over 10% when both are
 * big enough, else as one "5% or more" group, else not at all.
 */
export function visibleGroups(groups: CutGroup[], min = MIN_GROUP_SALES): CutGroup[] {
  const by = new Map(groups.map((g) => [g.bucket, g]));
  const ok = (b: CutBucket) => {
    const g = by.get(b);
    return g && g.sales >= min ? g : null;
  };
  const none = ok("none");
  if (!none) return [];
  const out: CutGroup[] = [none];
  const under5 = ok("under5");
  if (under5) out.push(under5);
  const mid = ok("5to10");
  const deep = ok("over10");
  if (mid && deep) out.push(mid, deep);
  else {
    const plus = ok("5plus");
    if (plus) out.push(plus);
  }
  // A baseline alone compares with nothing.
  return out.length > 1 ? out : [];
}

/** What a first asking price became for a group, to the nearest $1,000. */
export function soldFor(firstAsk: number, pctOfFirstAsk: number): number {
  return Math.round((firstAsk * pctOfFirstAsk) / 100 / 1000) * 1000;
}

/** "$1,300,000" from free text such as "1.3m", "1,300,000" or "$950k". Null when unusable. */
export function parseAsk(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[$,\s]/g, "");
  const m = /^(\d+(?:\.\d+)?)(k|m)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1);
  return n >= 50_000 && n <= 50_000_000 ? Math.round(n) : null;
}
