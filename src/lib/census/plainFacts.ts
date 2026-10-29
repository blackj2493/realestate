/**
 * Plain-language census lines — what each figure MEANS first, then the figure next to the
 * city. Used by the listing page's Neighbourhood section (AreaCard) and its closed-row
 * summary. Pure and server-safe (no "use client"), so a server page can call it.
 *
 * Owner feedback 2026-10-29: the first card (3 lenses, bars, "Renters paying 30%+ of
 * income on housing") was hard to read and did not say why a figure matters. Each line
 * now leads with a short verdict ("Mostly owners") that the number then backs up.
 */
import type { AreaFacts, RentCheck } from "./areaFacts";

export interface PlainLine {
  /** Short verdict, e.g. "Mostly owners". */
  label: string;
  /** One or two short sentences with the figure and the city figure. */
  text: string;
}

const pct = (v: number) => `${Math.round(v)}%`;

/** "In Mississauga, 30% are." — empty when the city figure is missing. */
const cityAre = (city: string, v: number | null, verb: string) => (v != null ? ` In ${city}, ${pct(v)} ${verb}.` : "");

/** Up to 4 lines: tenure, housing type, moves, commute. A missing figure drops its line. */
export function plainLines(c: AreaFacts): PlainLine[] {
  const { here, city, cityName } = c;
  const out: PlainLine[] = [];

  if (here.rentPct != null) {
    const label = here.rentPct >= 60 ? "Mostly renters" : here.rentPct <= 40 ? "Mostly owners" : "Owners and renters";
    out.push({ label, text: `${pct(here.rentPct)} of homes here are rented.${cityAre(cityName, city.rentPct, "are")}` });
  }

  if (here.aptPct != null) {
    const label = here.aptPct >= 60 ? "Mostly apartments" : here.aptPct <= 25 ? "Mostly houses" : "Houses and apartments";
    out.push({ label, text: `${pct(here.aptPct)} of homes here are apartments.${cityAre(cityName, city.aptPct, "are")}` });
  }

  if (here.moved5Pct != null) {
    const diff = city.moved5Pct != null ? here.moved5Pct - city.moved5Pct : 0;
    const label = diff <= -4 ? "People stay" : diff >= 8 ? "People move often" : "Moves";
    out.push({
      label,
      text: `${pct(here.moved5Pct)} moved in during the last 5 years.${cityAre(cityName, city.moved5Pct, "did")}`,
    });
  }

  if (here.medianCommuteMin != null) {
    out.push({
      label: "Commute",
      text: `${here.medianCommuteMin} minutes is typical here.${
        city.medianCommuteMin != null ? ` In ${cityName}, ${city.medianCommuteMin} minutes.` : ""
      }`,
    });
  }

  return out;
}

/** Closed-row summary: "Mostly owners · 26 min commute". */
export function areaSummary(c: AreaFacts): string | null {
  const parts: string[] = [];
  const tenure = plainLines(c).find((l) => /owners|renters/.test(l.label));
  if (tenure) parts.push(tenure.label);
  if (c.here.medianCommuteMin != null) parts.push(`${c.here.medianCommuteMin} min commute`);
  return parts.length ? parts.join(" · ") : null;
}

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
