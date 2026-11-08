/**
 * "Why is my house not selling?" facts for /house-not-selling and /house-not-selling/{city}.
 *
 * WHY. "why is my house not selling (after a price reduction)" is a top Ontario seller
 * question (autocomplete, 2026-11-08). The listing_outcome_stats precompute (migration 165)
 * compares homes that SOLD with homes that came off the market UNSOLD over 12 months:
 * how their asking price compared with similar homes that sold, their price cuts, and their
 * days on the market. Measured result (Ontario, 2026-11): unsold homes asked a median 12%
 * above similar homes, sold homes 2%; price cuts were about the same in both groups.
 *
 * HONESTY. The comparison shows an association, not a cause: "similar" = same community,
 * type and above-grade bedrooms, so size and condition still differ. The copy says so.
 * Small samples: a city's own comparison needs MIN_UNSOLD unsold homes with a cohort,
 * else Ontario, and the copy says which. Aggregates only. Pure builder; loader below.
 */
import { unstable_cache } from "next/cache";
import { getServiceRoleClient } from "@/lib/supabase/client";

export interface OutcomeRow {
  region: string;
  outcome: "sold" | "unsold";
  homes: number;
  cut_share: number | null;
  median_cut_pct: number | null;
  ratio_sample: number;
  median_ratio: number | null;
  over10_share: number | null;
  median_dom: number | null;
  computed_at: string;
}

/** A city's own comparison needs this many unsold homes with a similar-homes cohort. */
export const MIN_UNSOLD = 100;

const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct0 = (n: number) => `${Math.round(n)}%`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const count = (n: number) => Math.round(n).toLocaleString("en-CA");

async function loadOutcomes(): Promise<OutcomeRow[]> {
  const { data, error } = await getServiceRoleClient().from("listing_outcome_stats").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as OutcomeRow[];
}

/** All regions (~850 rows, small). Cached 1h; [] on failure. */
export async function getOutcomeStats(): Promise<OutcomeRow[]> {
  try {
    return await unstable_cache(loadOutcomes, ["listing-outcome-stats", "v1"], { revalidate: 3600 })();
  } catch (err) {
    console.error("[notSelling] stats read failed:", err);
    return [];
  }
}

/** "11% above" / "1% below" / "about the same as" for a price ratio. */
export function ratioWords(r: number): string {
  const d = (r - 1) * 100;
  if (Math.abs(d) < 0.5) return "about the same as";
  return `${pct0(Math.abs(d))} ${d > 0 ? "above" : "below"}`;
}

export interface NotSellingChart {
  /** Percent above (+) or below (-) similar homes' median sale price. */
  unsoldGap: number;
  soldGap: number;
  unsoldOver10: number | null;
  soldOver10: number | null;
  /** Where the comparison comes from ("Toronto" or "Ontario"). */
  basis: string;
}

export interface NotSellingFacts {
  facts: { id: "share" | "price" | "over10" | "cuts" | "dom"; text: string }[];
  faqs: { q: string; a: string }[];
  summary: string;
  /** Share (%) of homes that came off the market unsold, for the index list + split bar. */
  unsoldShare: number | null;
  sold: number | null;
  unsold: number | null;
  chart: NotSellingChart | null;
  updatedLabel: string | null;
  updatedIso: string | null;
}

const find = (rows: OutcomeRow[], region: string, outcome: "sold" | "unsold") =>
  rows.find((r) => r.region === region && r.outcome === outcome) ?? null;

/**
 * @param place  display name ("Brampton", "Ontario")
 * @param region stats key (lowercase city, or "ontario")
 */
export function buildNotSellingFacts(place: string, region: string, rows: OutcomeRow[]): NotSellingFacts {
  const facts: NotSellingFacts["facts"] = [];
  const sold = find(rows, region, "sold");
  const unsold = find(rows, region, "unsold");

  let unsoldShare: number | null = null;
  const nSold = num(sold?.homes) ?? 0;
  const nUnsold = num(unsold?.homes) ?? 0;
  if (sold && unsold && nSold + nUnsold > 0) {
    unsoldShare = (nUnsold / (nSold + nUnsold)) * 100;
    facts.push({
      id: "share",
      text:
        `In the last 12 months, ${pct0(unsoldShare)} of the homes that came off the market in ${place} did not sell: ` +
        `${count(nSold)} homes sold, and ${count(nUnsold)} came off the market unsold and are not for sale again now.`,
    });
  }

  // The comparison: the city at MIN_UNSOLD unsold homes with a cohort, else Ontario.
  const useCity = unsold && (num(unsold.ratio_sample) ?? 0) >= MIN_UNSOLD;
  const cs = useCity ? sold : find(rows, "ontario", "sold");
  const cu = useCity ? unsold : find(rows, "ontario", "unsold");
  const basis = useCity || region === "ontario" ? place : "Ontario";
  const where = basis === place ? `in ${place}` : "across Ontario";

  const ru = num(cu?.median_ratio);
  const rs = num(cs?.median_ratio);
  let chart: NotSellingChart | null = null;
  if (ru != null && rs != null) {
    facts.push({
      id: "price",
      text:
        `Homes ${where} that did not sell asked a median of ${ratioWords(ru)} the median sale price of similar homes ` +
        `(same neighbourhood, home type and bedrooms). Homes that sold asked ${ratioWords(rs)} it.`,
    });
    const ou = num(cu?.over10_share);
    const os = num(cs?.over10_share);
    if (ou != null && os != null) {
      facts.push({
        id: "over10",
        text: `${pct0(ou * 100)} of the homes that did not sell asked more than 10% above similar homes, compared with ${pct0(os * 100)} of the homes that sold.`,
      });
    }
    chart = {
      unsoldGap: Math.round((ru - 1) * 1000) / 10,
      soldGap: Math.round((rs - 1) * 1000) / 10,
      unsoldOver10: ou != null ? Math.round(ou * 1000) / 10 : null,
      soldOver10: os != null ? Math.round(os * 1000) / 10 : null,
      basis,
    };
  }

  const cuU = num(cu?.cut_share);
  const cuS = num(cs?.cut_share);
  const mcU = num(cu?.median_cut_pct);
  const mcS = num(cs?.median_cut_pct);
  if (cuU != null && cuS != null) {
    facts.push({
      id: "cuts",
      text:
        `${pct0(cuU * 100)} of the homes ${where} that did not sell had cut their asking price` +
        (mcU != null ? ` (a median cut of ${pct1(mcU)})` : "") +
        `, compared with ${pct0(cuS * 100)} of the homes that sold` +
        (mcS != null ? ` (${pct1(mcS)})` : "") +
        `.`,
    });
  }

  const dU = num(unsold?.median_dom);
  const dS = num(sold?.median_dom);
  if (dU != null && dS != null) {
    facts.push({
      id: "dom",
      text: `Homes that sold in ${place} took a median of ${dS} days. Homes that did not sell came off the market after a median of ${dU} days.`,
    });
  }

  const t = (id: string) => facts.find((f) => f.id === id)?.text ?? null;
  const join = (...xs: (string | null)[]) => xs.filter(Boolean).join(" ");
  const faqs = [
    {
      q: `Why is my house not selling in ${place}?`,
      a: join(
        t("price"),
        "The price is the reason that shows most clearly in the sales data. Photos, condition, the time of year and how the home is shown also matter, but the data cannot measure them.",
      ),
    },
    {
      q: "Should I cut my price?",
      a: join(
        t("cuts"),
        "A cut helps only when it closes the gap to what similar homes sold for. A small cut on a home that asks much more than similar homes often changes little. Compare your asking price with recent sales of similar homes first.",
      ),
    },
    {
      q: `How long does it take to sell a house in ${place}?`,
      a: t("dom") ?? `See the facts on this page for how long homes in ${place} take to sell.`,
    },
    {
      q: "Should I take my house off the market and relist it?",
      a: "A relist at the same price usually gets the same result. Buyers and their agents can see the earlier listing. Change the price, the photos or the condition before you relist.",
    },
    {
      q: "My home is listed with an agent. Can I still ask for a price opinion?",
      a: "Yes. We send a free written price opinion, and we do not ask you to change agents or to end your listing. Share the opinion with your agent and decide together.",
    },
  ];

  const summary =
    join(t("share"), t("price")) ||
    `Why homes do not sell in ${place}: how homes that did not sell compared with homes that sold.`;
  const at = sold?.computed_at ?? find(rows, "ontario", "sold")?.computed_at ?? null;
  return {
    facts,
    faqs,
    summary,
    unsoldShare,
    sold: sold ? nSold : null,
    unsold: unsold ? nUnsold : null,
    chart,
    updatedLabel: at ? new Date(at).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Toronto" }) : null,
    updatedIso: at ? new Date(at).toISOString() : null,
  };
}
