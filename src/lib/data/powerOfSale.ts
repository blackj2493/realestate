/**
 * Power-of-sale facts for /power-of-sale and /power-of-sale/{city}.
 *
 * WHY. "power of sale" searches in Ontario are ~5-8x their 2022 level (Google Trends,
 * 2026-11-08), and the searches are city lists: "power of sale homes brampton / vaughan /
 * toronto". The pages list today's power-of-sale homes (IDX, the description signal) and
 * state, from the pos_market_stats precompute (migration 164), how many sales were power
 * of sale and how they sold against other homes.
 *
 * SMALL SAMPLES. Most cities have well under 30 power-of-sale sales a year. A city's COUNT
 * and SHARE are always stated (with the count, so the reader sees the size); the price and
 * days-on-market comparison uses the city only at 30+ power-of-sale sales, else Ontario,
 * and says which. Aggregates only. The builder is pure; the loader is getPosStats.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";

export interface PosStatRow {
  region: string;
  period: "12m" | "prev12m";
  sales: number;
  pos_sales: number;
  pos_s2l: number | null;
  other_s2l: number | null;
  pos_below_share: number | null;
  other_below_share: number | null;
  pos_dom: number | null;
  other_dom: number | null;
  computed_at: string;
}

/** A city's own price comparison needs this many power-of-sale sales in 12 months. */
export const MIN_POS_FOR_CITY_RATIO = 30;
/** A year-on-year change in the count needs this many in each period. */
export const MIN_POS_FOR_CHANGE = 10;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct2 = (n: number) => `${(Math.round(n * 100) / 100).toFixed(2)}%`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const count = (n: number) => Math.round(n).toLocaleString("en-CA");

async function loadPosStats(): Promise<PosStatRow[]> {
  const { data, error } = await getServiceRoleClient().from("pos_market_stats").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as PosStatRow[];
}

/** All regions' rows (~800, small). Cached 1h; [] on failure — the page still lists homes. */
export async function getPosStats(): Promise<PosStatRow[]> {
  try {
    return await unstable_cache(loadPosStats, ["pos-market-stats", "v1"], { revalidate: 3600 })();
  } catch (err) {
    console.error("[powerOfSale] stats read failed:", err);
    return [];
  }
}

export interface PosFacts {
  facts: { id: "active" | "share" | "price" | "dom"; text: string }[];
  faqs: { q: string; a: string }[];
  /** Meta description / index line. */
  summary: string;
  /** 12-month share (%) and count, for the index list. */
  share: number | null;
  posSales: number | null;
  updatedLabel: string | null;
  updatedIso: string | null;
}

function row(rows: PosStatRow[], region: string, period: "12m" | "prev12m"): PosStatRow | null {
  return rows.find((r) => r.region === region && r.period === period) ?? null;
}

/**
 * @param place   display name ("Brampton", "Ontario")
 * @param region  stats key (lowercase city, or "ontario")
 * @param activeNow power-of-sale homes for sale now (Typesense), null when unknown
 */
export function buildPosFacts(place: string, region: string, rows: PosStatRow[], activeNow: number | null): PosFacts {
  const facts: PosFacts["facts"] = [];
  const cur = row(rows, region, "12m");
  const prev = row(rows, region, "prev12m");
  const ont = row(rows, "ontario", "12m");

  if (activeNow != null) {
    facts.push({
      id: "active",
      text:
        activeNow === 0
          ? `No homes for sale in ${place} are listed as power of sale right now.`
          : `${count(activeNow)} ${activeNow === 1 ? "home" : "homes"} for sale in ${place} ${activeNow === 1 ? "is" : "are"} listed as power of sale (a sale by the lender) right now.`,
    });
  }

  let share: number | null = null;
  const sales = num(cur?.sales) ?? 0;
  const pos = num(cur?.pos_sales) ?? 0;
  if (cur && sales > 0) {
    share = (pos / sales) * 100;
    const pSales = num(prev?.sales) ?? 0;
    const pPos = num(prev?.pos_sales) ?? 0;
    let changeText = "";
    if (prev && pSales > 0 && pos >= MIN_POS_FOR_CHANGE && pPos >= MIN_POS_FOR_CHANGE) {
      const prevShare = (pPos / pSales) * 100;
      const dir = share > prevShare ? "up" : share < prevShare ? "down" : "the same as";
      changeText =
        dir === "the same as"
          ? `, the same share as in the 12 months before`
          : `, ${dir} from ${count(pPos)} (${pct2(prevShare)}) in the 12 months before`;
    }
    facts.push({
      id: "share",
      text: `In the last 12 months, ${count(pos)} of ${count(sales)} home sales in ${place} (${pct2(share)}) were power-of-sale sales${changeText}.`,
    });
  }

  // Price and time-to-sell comparison: the city at 30+ sales, else Ontario.
  const useCity = cur && pos >= MIN_POS_FOR_CITY_RATIO;
  const cmp = useCity ? cur : ont;
  const where = useCity || region === "ontario" ? `in ${place}` : "across Ontario";
  const posS2l = num(cmp?.pos_s2l);
  const othS2l = num(cmp?.other_s2l);
  if (cmp && posS2l != null && othS2l != null) {
    facts.push({
      id: "price",
      text: `In the last 12 months, power-of-sale homes ${where} sold for a median of ${pct1(posS2l)} of their final asking price, compared with ${pct1(othS2l)} for other homes.`,
    });
  }
  const posDom = num(cmp?.pos_dom);
  const othDom = num(cmp?.other_dom);
  if (cmp && posDom != null && othDom != null) {
    facts.push({
      id: "dom",
      text: `They took a median of ${posDom} days to sell ${where}, compared with ${othDom} days for other homes.`,
    });
  }

  const t = (id: string) => facts.find((f) => f.id === id)?.text ?? null;
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ");
  const faqs = [
    {
      q: "What is a power of sale in Ontario?",
      a: "A power of sale is a sale by the lender. When an owner stops paying the mortgage, Ontario law lets the lender sell the home to recover the debt, usually without going to court. The lender, not the owner, sets the terms.",
    },
    {
      q: `Are power-of-sale homes cheaper in ${place}?`,
      a: join(
        t("price"),
        "The lender must try to get a fair market price, so a power-of-sale home is not automatically a bargain. The difference often comes from the condition of the home and the as-is terms."
      ),
    },
    {
      q: "What should I know before I buy a power-of-sale home?",
      a: "The lender sells the home as is and gives no promises about its condition, so get a home inspection. The owner can still pay what they owe and stop the sale until it closes. The lender may ask for its own terms in the agreement, and it can take longer to get an answer to an offer.",
    },
    {
      q: `How many power-of-sale homes are there in ${place}?`,
      a: join(t("active"), t("share")) || `See the list on this page for the power-of-sale homes for sale in ${place} now.`,
    },
  ];

  const summary =
    join(t("active"), t("share")) || `Power-of-sale homes for sale in ${place}, and how power-of-sale homes sold against other homes.`;
  const at = cur?.computed_at ?? ont?.computed_at ?? null;
  return {
    facts,
    faqs,
    summary,
    share,
    posSales: cur ? pos : null,
    updatedLabel: at ? new Date(at).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" }) : null,
    updatedIso: at ? new Date(at).toISOString() : null,
  };
}
