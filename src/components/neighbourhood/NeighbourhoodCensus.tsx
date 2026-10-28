import { FACTS, fmtFact, type AreaFacts, type FactKey } from "@/lib/census/areaFacts";

/**
 * "The area" on a neighbourhood hub — Census 2021 facts for the community next to its city
 * (census_community_area, migration 161). A server component: the text is in the HTML for
 * search engines. Facts about PLACES only, never facts about who lives there by a protected
 * ground (Ontario Human Rights Code; TRESA). See src/lib/census/characteristics.ts.
 */
const ORDER: FactKey[] = [
  "rentPct",
  "aptPct",
  "bed3PlusPct",
  "builtBefore1981Pct",
  "moved5Pct",
  "transitWalkBikePct",
  "medianCommuteMin",
  "medianIncome",
];

/** Two plain sentences from the strongest facts, or null when the census has neither. */
function lead(hood: string, c: AreaFacts): string | null {
  const parts: string[] = [];
  const { here, city, cityName } = c;
  if (here.rentPct != null) {
    parts.push(
      `In ${hood}, ${Math.round(here.rentPct)}% of households rent${
        city.rentPct != null ? `, against ${Math.round(city.rentPct)}% across ${cityName}` : ""
      }.`,
    );
  }
  if (here.medianCommuteMin != null) {
    parts.push(
      `The typical commute is ${here.medianCommuteMin} minutes${
        city.medianCommuteMin != null ? ` (${cityName}: ${city.medianCommuteMin})` : ""
      }.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}

export default function NeighbourhoodCensus({ hoodName, census }: { hoodName: string; census: AreaFacts }) {
  const rows = ORDER.map((k) => ({ k, here: census.here[k], city: census.city[k], ...FACTS[k] })).filter(
    (r) => r.here != null,
  );
  if (rows.length === 0) return null;
  const intro = lead(hoodName, census);

  return (
    <section aria-labelledby="hood-area" className="mt-10 rounded-xl border border-border bg-card p-4 sm:p-6 dark:bg-card/40">
      <h2 id="hood-area" className="text-lg font-bold text-foreground">
        Living in {hoodName}
      </h2>
      {intro && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{intro}</p>}

      <dl className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {rows.map((r) => (
          <div key={r.k} className="rounded-lg bg-muted/50 p-3">
            <dt className="text-[12px] leading-snug text-muted-foreground">{r.label}</dt>
            <dd className="mt-1">
              <span className="block font-mono text-lg font-bold text-foreground">{fmtFact(r.here!, r.unit)}</span>
              {r.city != null && (
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {census.cityName} {fmtFact(r.city, r.unit)}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 font-mono text-[10px] leading-snug text-muted-foreground">
        Statistics Canada, Census 2021 · the census blocks where most {hoodName} listings sit
        {census.pop ? ` (about ${(Math.round(census.pop / 100) * 100).toLocaleString("en-CA")} people)` : ""}
      </p>
    </section>
  );
}
