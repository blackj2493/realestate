/**
 * "Quick facts about this home" — a short, closed section at the foot of a for-sale
 * listing page, written as plain sentences an AI assistant or a search engine can quote.
 *
 * WHY IT EXISTS: most of these facts are already on the page as cards and charts. The
 * section restates them as sentences in the server HTML (closed <details>, so it costs no
 * screen space), and adds the neighbourhood comparison from community_market_facts.
 *
 * VOW-SAFE BY CONSTRUCTION: inputs are the public listing fields (ListPrice,
 * OriginalListPrice, DaysOnMarket, beds, type) plus neighbourhood AGGREGATES that the
 * public neighbourhood pages already publish. Never a per-home estimate, never a sold
 * price of one home. Pure and deterministic (no IO).
 */
import { MIN_ACTIVE, MIN_SOLD, type CommunityFactsRow } from "@/lib/data/communityFacts";

export interface QuickFactsListing {
  listPrice: number | null;
  originalListPrice: number | null;
  daysOnMarket: number | null;
  beds: string | null; // "3" or "3+1"
  subType: string | null; // raw PropertySubType
  hood: string | null; // display name of the community
  city: string | null; // display name of the market
}

export interface QuickFacts {
  summary: string;
  faqs: { q: string; a: string }[];
  updatedLabel: string | null;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const pct0 = (n: number) => `${Math.round(n)}%`;
const pct1 = (n: number) => `${(Math.round(n * 10) / 10).toFixed(1)}%`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Feed sub-type → words for a sentence. Unknown types fall back to "home". */
export function typeWords(subType: string | null): string {
  const t = (subType ?? "").trim().toLowerCase();
  if (!t) return "home";
  if (t === "att/row/townhouse" || t.includes("townhouse") || t.includes("row")) return "townhouse";
  if (t === "detached") return "detached home";
  if (t === "semi-detached") return "semi-detached home";
  if (t.includes("condo apartment")) return "condo apartment";
  if (t.includes("link")) return "link home";
  if (t.includes("duplex") || t.includes("triplex") || t.includes("fourplex") || t.includes("multiplex")) return t;
  return "home";
}

function bedWords(beds: string | null): string {
  if (!beds) return "";
  const [above, below] = beds.split("+");
  if (!above || above === "0") return "";
  return below ? `${above}-bedroom (plus ${below} below grade) ` : `${above}-bedroom `;
}

function daysAgo(d: number): string {
  if (d <= 0) return "today";
  return d === 1 ? "1 day ago" : `${d.toLocaleString("en-CA")} days ago`;
}

export function buildQuickFacts(l: QuickFactsListing, row: CommunityFactsRow | null): QuickFacts | null {
  const price = l.listPrice && l.listPrice > 0 ? l.listPrice : null;
  if (!price) return null;
  const place = l.hood && l.city && l.hood !== l.city ? `${l.hood}, ${l.city}` : (l.hood ?? l.city);
  const where = place ? ` in ${place}` : "";

  // ── The summary: this listing, then (when the sample allows) its neighbourhood. ──
  const s: string[] = [];
  const kind = typeWords(l.subType);
  s.push(`This ${bedWords(l.beds)}${kind}${where} is listed for ${usd(price)}.`);
  if (l.daysOnMarket != null && l.daysOnMarket >= 0) s.push(`It came on the market ${daysAgo(Math.round(l.daysOnMarket))}.`);
  const orig = l.originalListPrice && l.originalListPrice > 0 ? l.originalListPrice : null;
  if (orig && orig > price) {
    s.push(`The asking price was cut from ${usd(orig)} to ${usd(price)} (${pct1(((orig - price) / orig) * 100)} lower).`);
  } else if (orig && orig < price) {
    s.push(`The asking price was raised from ${usd(orig)} to ${usd(price)}.`);
  } else if (orig) {
    s.push("The asking price has not changed.");
  }

  // ── Neighbourhood facts: the same thresholds as the neighbourhood pages. ──
  const faqs: QuickFacts["faqs"] = [];
  const hoodName = l.hood ?? l.city;
  let updatedLabel: string | null = null;
  if (row?.computed_at && hoodName && place) {
    const sales = num(row.sales_12m) ?? 0;
    const gapN = num(row.gap_sample) ?? 0;
    const domN = num(row.dom_sample) ?? 0;
    const active = num(row.active_count) ?? 0;
    const median = num(row.median_price);
    const under = num(row.under_ask_share);
    const gap = num(row.ask_gap_median);
    const dom = num(row.median_dom);
    const cut = num(row.cut_share);

    const hasDom = dom != null && domN >= MIN_SOLD;
    const hasCut = cut != null && active >= MIN_ACTIVE;

    if (median != null && median > 0 && sales >= MIN_SOLD) {
      const diff = ((price - median) / median) * 100;
      const rel =
        Math.abs(diff) < 0.5
          ? `about the same as the median sale price`
          : `${pct0(Math.abs(diff))} ${diff < 0 ? "below" : "above"} the median sale price`;
      faqs.push({
        q: `How does the asking price compare with ${hoodName}?`,
        a:
          `The asking price of ${usd(price)} is ${rel} of all home types in ${place} ` +
          `(${usd(median)} over the last 12 months, ${sales.toLocaleString("en-CA")} sales). ` +
          `That median mixes all home types and sizes, so it is a rough guide, not a value for this home.`,
      });
    }
    if (hasDom || hasCut) {
      const parts: string[] = [];
      if (hasDom) parts.push(`Homes that sold in ${place} in the last 12 months took a median of ${Math.round(dom)} days to sell.`);
      if (hasCut) parts.push(`Of the ${active.toLocaleString("en-CA")} homes for sale there now, ${pct0(cut * 100)} have cut their asking price.`);
      faqs.push({ q: `How fast do homes sell in ${hoodName}?`, a: parts.join(" ") });
    }
    if (under != null && gapN >= MIN_SOLD) {
      faqs.push({
        q: `Do homes in ${hoodName} sell over asking?`,
        a:
          `In the last 12 months, ${pct0(under * 100)} of homes in ${place} sold for less than their first asking price ` +
          `(${gapN.toLocaleString("en-CA")} sales)` +
          (gap != null ? `. The median sale was ${pct1(Math.abs(gap))} ${gap < 0 ? "below" : "above"} the first asking price.` : "."),
      });
    }
    if (faqs.length || hasDom) {
      updatedLabel = new Date(row.computed_at).toLocaleDateString("en-CA", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Toronto",
      });
    }
  }

  return { summary: s.join(" "), faqs, updatedLabel };
}
