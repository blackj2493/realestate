/**
 * "Do better schools raise house prices in {city}?" for /data/school-catchment-prices(/{city}).
 *
 * WHY. "toronto school catchment house prices" (AI-search panel 2026-11-24): the results were
 * undated pages and 2012–2014 figures; no source measured the premium inside a community.
 *
 * DATA. data/school-prices.json, built monthly by scripts/data/buildSchoolPrices.ts. Static.
 *
 * HONESTY. The gap compares similar houses in the same community, so it is the school's own
 * premium, not the neighbourhood's. Where it is not significant the copy says "no measurable
 * premium". A gap in the unexpected direction is reported as measured, with the reason it can
 * happen. Each catchment's figure is mix-adjusted (similar houses in the city), never a raw
 * median. Boundaries change: the copy says to check with the board.
 */
import raw from "@/data/school-prices.json";
import { BAND_LABEL, BASE_BAND, SCORE_BANDS, type Gap, type SchoolCity, type SchoolPricesFile } from "@/lib/data/schoolPricesModel";
export * from "@/lib/data/schoolPricesModel";

export const schoolPricesPath = (slug?: string) => (slug ? `/data/school-catchment-prices/${slug}` : "/data/school-catchment-prices");

export const SCHOOL_SOURCE_LINE =
  "Source: PureProperty analysis of MLS® sold records from the MLS® VOW feed (comprehensive but not exhaustive), public school board catchment maps and the PureProperty School Score (from EQAO results). Medians and model estimates only.";

export function getSchoolData(): SchoolPricesFile {
  return raw as unknown as SchoolPricesFile;
}

export function schoolCityBySlug(slug: string): SchoolCity | null {
  return getSchoolData().cities.find((c) => c.slug === slug.toLowerCase()) ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const lastMonthLabel = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m === 1 ? `Dec ${y - 1}` : `${MONTHS[m - 2]} ${y}`;
};
export const signedPct = (p: number) => `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`;

/** "Strong" = significant and positive per point; "none" = not significant; "reverse" = significant and negative. */
export function premiumKind(c: SchoolCity): "strong" | "none" | "reverse" | null {
  if (!c.perPoint) return null;
  if (!c.perPoint.significant) return "none";
  return c.perPoint.pct > 0 ? "strong" : "reverse";
}

export interface SchoolFacts {
  title: string;
  summary: string;
  window: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
}

export function buildSchoolFacts(c: SchoolCity, file: SchoolPricesFile, year: number): SchoolFacts | null {
  const kind = premiumKind(c);
  if (!kind || !c.perPoint) return null;
  const window = `${monthLabel(file.from)} to ${lastMonthLabel(file.to)}`;
  const pp = c.perPoint;
  const top = c.bands["9plus"];
  const facts: { id: string; text: string }[] = [];

  if (kind === "strong") {
    facts.push({
      id: "point",
      text: `In ${c.city}, each extra point of the elementary school's score added ${signedPct(pp.pct)} to the sale price of a similar house in the same community.`,
    });
  } else if (kind === "none") {
    facts.push({
      id: "point",
      text: `In ${c.city}, the elementary school's score made no measurable difference to the sale price of similar houses in the same community (${signedPct(pp.pct)} per point, not significant).`,
    });
  } else {
    facts.push({
      id: "point",
      text: `In ${c.city}, houses in lower-scored catchments sold for slightly more than similar houses in the same community (${signedPct(pp.pct)} per point). Within one community, catchment lines can also separate streets that differ in other ways (lot size, traffic, newer subdivisions), so this is not a school effect alone.`,
    });
  }
  const sigBands = SCORE_BANDS.filter((b) => b !== BASE_BAND && c.bands[b]?.significant);
  if (sigBands.length) {
    facts.push({
      id: "bands",
      text: `Against a school scored 7 to 8: ${sigBands.map((b) => `${BAND_LABEL[b].toLowerCase()} ${signedPct(c.bands[b]!.pct)}`).join(", ")}.`,
    });
  }
  if (top?.significant && c.medianPrice) {
    facts.push({
      id: "top",
      text: `At the ${c.city} median house price of $${c.medianPrice.toLocaleString("en-CA")}, a 9+ school against a 7–8 school is worth about $${(Math.round(((top.pct / 100) * c.medianPrice) / 1000) * 1000).toLocaleString("en-CA")}.`,
    });
  }
  if (c.catchments.length >= 6) {
    const hi = c.catchments[0];
    const lo = c.catchments[c.catchments.length - 1];
    facts.push({
      id: "range",
      text: `By catchment, against similar houses in ${c.city}: from ${signedPct(hi.vsSimilar)} (${hi.school}, score ${hi.score}) to ${signedPct(lo.vsSimilar)} (${lo.school}, score ${lo.score}). This includes the neighbourhood, not only the school.`,
    });
  }
  facts.push({ id: "basis", text: `${c.sales.toLocaleString("en-CA")} house sales matched to a ${c.board} elementary catchment, ${window}.` });

  const title = `${c.city} School Catchment House Prices ${year}: Does a Better School Raise the Price?`;
  const summary = facts[0].text + (facts.find((f) => f.id === "top") ? ` ${facts.find((f) => f.id === "top")!.text}` : "");
  const faqs = [
    { q: `Do better schools raise house prices in ${c.city}?`, a: [facts[0].text, facts.find((f) => f.id === "bands")?.text].filter(Boolean).join(" ") },
    {
      q: `Which ${c.city} school catchments have the highest house prices?`,
      a: c.catchments.length
        ? `Against similar houses in ${c.city}, the highest were ${c.catchments.slice(0, 3).map((x) => `${x.school} (${signedPct(x.vsSimilar)})`).join(", ")}. The full table is on this page. These figures include the neighbourhood as well as the school.`
        : "Too few sales per catchment to list them.",
    },
    {
      q: "How is the school premium measured?",
      a: `Each house sale is placed by its postal code and matched to the ${c.board} elementary catchment that contains it, with the school's PureProperty School Score (0–10, from EQAO results). The model compares similar houses in the same community (type, bedrooms above ground, size band) and controls for bathrooms, parking, lot width, basement, renovation words and the quarter of the sale. Postal codes are block-level, so a house on a boundary can be assigned to the wrong school. Boundaries change every year: check the zoned school with the board before you buy.`,
    },
  ];
  return { title, summary, window, facts, faqs };
}

/** Cities by premium per point, largest first. */
export function rankedSchoolCities(file: SchoolPricesFile): SchoolCity[] {
  return file.cities.filter((c) => c.perPoint).sort((x, y) => y.perPoint!.pct - x.perPoint!.pct);
}

export const gapCell = (g: Gap | null | undefined) => (g ? `${signedPct(g.pct)}${g.significant ? "" : "*"}` : "–");
