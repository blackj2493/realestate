/**
 * Plain-language census rows — what each figure MEANS first (a verdict), then two bars:
 * this area and the city. Used by the listing page's Neighbourhood section (AreaCard) and its closed-row
 * summary. Pure and server-safe (no "use client"), so a server page can call it.
 *
 * Owner feedback 2026-10-29: the first card (3 lenses, bars, "Renters paying 30%+ of
 * income on housing") was hard to read and did not say why a figure matters. Each row
 * now leads with a short verdict ("Mostly owners") that the bars then back up. The owner
 * picked paired bars over plain sentences, spectrum dots, rings and gauges.
 */
import type { AreaFacts, RentCheck } from "./areaFacts";

export type AreaRowKey = "tenure" | "type" | "moves" | "commute";

/** One fact as a verdict over two bars: this area, then the city. */
export interface AreaRow {
  key: AreaRowKey;
  /** Short verdict, e.g. "Mostly owners". */
  label: string;
  /** What the bars measure, e.g. "homes rented". */
  measure: string;
  here: number;
  city: number | null;
  unit: "%" | "min";
  /** The full-width value of the bars (100 for a share; 60 for minutes). */
  max: number;
  /** The same fact as a sentence, for screen readers. */
  text: string;
}

const pct = (v: number) => `${Math.round(v)}%`;

/** "In Mississauga, 30% are." — empty when the city figure is missing. */
const cityAre = (city: string, v: number | null, verb: string) => (v != null ? ` In ${city}, ${pct(v)} ${verb}.` : "");

/** A commute bar is full at 60 minutes. */
export const COMMUTE_BAR_MAX = 60;

/** Up to 4 rows: tenure, housing type, moves, commute. A missing figure drops its row. */
export function areaRows(c: AreaFacts): AreaRow[] {
  const { here, city, cityName } = c;
  const out: AreaRow[] = [];

  if (here.rentPct != null) {
    const label = here.rentPct >= 60 ? "Mostly renters" : here.rentPct <= 40 ? "Mostly owners" : "Owners and renters";
    out.push({
      key: "tenure",
      label,
      measure: "homes rented",
      here: here.rentPct,
      city: city.rentPct,
      unit: "%",
      max: 100,
      text: `${pct(here.rentPct)} of homes here are rented.${cityAre(cityName, city.rentPct, "are")}`,
    });
  }

  if (here.aptPct != null) {
    const label = here.aptPct >= 60 ? "Mostly apartments" : here.aptPct <= 25 ? "Mostly houses" : "Houses and apartments";
    out.push({
      key: "type",
      label,
      measure: "apartments",
      here: here.aptPct,
      city: city.aptPct,
      unit: "%",
      max: 100,
      text: `${pct(here.aptPct)} of homes here are apartments.${cityAre(cityName, city.aptPct, "are")}`,
    });
  }

  if (here.moved5Pct != null) {
    const diff = city.moved5Pct != null ? here.moved5Pct - city.moved5Pct : 0;
    const label = diff <= -4 ? "People stay" : diff >= 8 ? "People move often" : "Moves";
    out.push({
      key: "moves",
      label,
      measure: "moved in, last 5 years",
      here: here.moved5Pct,
      city: city.moved5Pct,
      unit: "%",
      max: 100,
      text: `${pct(here.moved5Pct)} moved in during the last 5 years.${cityAre(cityName, city.moved5Pct, "did")}`,
    });
  }

  if (here.medianCommuteMin != null) {
    out.push({
      key: "commute",
      label: `${here.medianCommuteMin} min commute`,
      measure: "typical commute",
      here: here.medianCommuteMin,
      city: city.medianCommuteMin,
      unit: "min",
      max: COMMUTE_BAR_MAX,
      text: `${here.medianCommuteMin} minutes is typical here.${
        city.medianCommuteMin != null ? ` In ${cityName}, ${city.medianCommuteMin} minutes.` : ""
      }`,
    });
  }

  return out;
}

/** "14%" or "26 min". */
export const fmtRowValue = (v: number, unit: AreaRow["unit"]) => (unit === "%" ? pct(v) : `${Math.round(v)} min`);

/** Bar width in percent, 0-100. A value above the max fills the bar. */
export const barWidth = (v: number, max: number) => Math.max(0, Math.min(100, (v / max) * 100));

/** Closed-row summary: "Mostly owners · 26 min commute". */
export function areaSummary(c: AreaFacts): string | null {
  const parts: string[] = [];
  const tenure = areaRows(c).find((r) => r.key === "tenure");
  if (tenure) parts.push(tenure.label);
  if (c.here.medianCommuteMin != null) parts.push(`${c.here.medianCommuteMin} min commute`);
  return parts.length ? parts.join(" · ") : null;
}

/** Filled figures in the row of 10 people: 47% → 5. */
export const peopleOfTen = (sharePct: number) => Math.max(0, Math.min(10, Math.round(sharePct / 10)));

/** "About half", "About 3 in 10", "Fewer than 1 in 10" — a share in words. */
export function shareInWords(sharePct: number, atTop: boolean): string {
  const n = Math.round(sharePct / 10);
  if (n <= 0) return "Fewer than 1 in 10";
  if (n >= 10) return atTop ? "At most all" : "Almost all";
  if (n === 5) return atTop ? "At most half" : "About half";
  return `${atTop ? "At most" : "About"} ${n} in 10`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

/** The rent check as two plain sentences. */
export function rentCheckText(monthlyRent: number, check: RentCheck): [string, string] {
  const share = shareInWords(check.sharePct, check.atTop);
  return [
    `A rent of ${money(monthlyRent)}/mo needs a household income of about ${money(check.incomeNeeded)}.`,
    // "About half OF THE households", but "About 3 in 10 households".
    `${share} ${/half$/.test(share) ? "of the households" : "households"} here earn that much.`,
  ];
}
