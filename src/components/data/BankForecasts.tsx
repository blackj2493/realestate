import { forecastDateLabel, forecastPct, forecastRange, type ForecastRange } from "@/lib/data/bankForecasts";

/**
 * "What the banks forecast for {year}": the published Ontario forecasts (src/lib/data/bankForecasts.ts),
 * each with its source, date and link. Renders nothing when no forecast covers `year`.
 * `city` names the page's city in the note that no bank forecasts it alone. `range` replaces the
 * live list with a frozen one (a monthly report edition shows the forecasts as they were).
 */
export default function BankForecasts({ year, city, range }: { year: number; city?: string; range?: ForecastRange | null }) {
  const r = range === undefined ? forecastRange(year) : range;
  if (!r) return null;
  return (
    <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="forecasts">
      <h2 id="forecasts" className="text-lg font-semibold">What the banks forecast for Ontario in {year}</h2>
      <p className="mt-2 text-sm leading-relaxed">
        PureProperty does not forecast prices. These are the {range ? "" : "latest "}published forecasts for Ontario as a whole{range ? ` at the time of this report` : ""}. They expect home prices to change
        by {forecastPct(r.priceLow)} to {forecastPct(r.priceHigh)} in {year}, and home sales by {forecastPct(r.salesLow)} to {forecastPct(r.salesHigh)}.
        {city ? ` None of them publishes a forecast for ${city} alone; the figures above are what ${city} sales show now.` : ""}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Forecast by</th>
              <th className="py-2 pr-3 font-medium">Published</th>
              <th className="py-2 pr-3 text-right font-medium">Ontario prices, {year}</th>
              <th className="py-2 text-right font-medium">Ontario sales, {year}</th>
            </tr>
          </thead>
          <tbody>
            {r.forecasts.map((f) => (
              <tr key={f.source} className="border-b border-border/60">
                <td className="py-2 pr-3">
                  <a href={f.url} target="_blank" rel="noopener" className="underline hover:text-foreground">
                    {f.source}
                  </a>
                </td>
                <td className="py-2 pr-3">{forecastDateLabel(f.published)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {forecastPct(f.pricePct)}
                  {f.priceMeasure ? "*" : ""}
                </td>
                <td className="py-2 text-right tabular-nums">{forecastPct(f.salesPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Annual change against the year before. Prices are the MLS® average price
        {r.forecasts.filter((f) => f.priceMeasure).map((f) => `; * ${f.source} forecasts ${f.priceMeasure}`).join("")}. A forecast is the publisher&apos;s
        view, not a measured figure.
      </p>
    </section>
  );
}
