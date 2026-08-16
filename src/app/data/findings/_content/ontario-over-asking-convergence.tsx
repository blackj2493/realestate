/**
 * "Ontario's bidding wars are converging" — 2026-08-16.
 *
 * NOTE ON THE SECOND PARAGRAPH. An earlier draft of this piece, written outside the
 * repo, said "No Canadian source has published it before" about the over-ask rate.
 * That is false — Wahi has published a monthly GTA overbid report since July 2022 —
 * and it is the same claim that had to be corrected in production two days earlier.
 * The paragraph now names the prior art and states what actually differs. Do not
 * re-introduce a novelty claim here; noveltyClaims.test.ts fails the build on one,
 * which is the point of keeping findings inside src/app/data.
 *
 * Every figure is a share or a median. No counts, no listing-level detail — see the
 * caveat block for why that constraint is real rather than cautious.
 */
import Link from "next/link";
import {
  BarCell,
  Caveat,
  CaveatItem,
  FigureTable,
  H2,
  P,
  Place,
  Pull,
  Td,
  Th,
} from "@/components/data/FindingParts";

const TRACKER = "/data/over-asking";

export default function OntarioOverAskingConvergence() {
  return (
    <>
      <P>
        Ontario&rsquo;s housing market is usually described with a single number. In the last twelve
        months the typical home sold for <strong>97.4% of its asking price</strong> — a buyer&rsquo;s
        market, on the face of it, where sellers concede. But that number hides something more
        interesting: <strong>18.1% of houses still sold for more than the seller asked</strong>, and in a
        handful of Toronto neighbourhoods it was the clear majority.
      </P>

      <P>
        The over-ask rate is not a new statistic. Wahi has published a monthly GTA overbid report since
        2022, and Redfin has run a version of it in the United States for years. TRREB reports average
        prices, sales and new listings; CREA publishes a price index. What differs here is the cut:{" "}
        <Link href={TRACKER} className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400">
          we measure each individual sale against its own final asking price
        </Link>
        , across 1,156 neighbourhoods province-wide rather than one metro, updated nightly, and we report
        the premium alongside the rate. That grain is what makes the pattern below visible at all — at
        city level it averages away.
      </P>

      <Pull
        value={
          <>
            61.8% <span className="text-2xl font-normal text-muted-foreground">vs</span> 2.7%
          </>
        }
        caption="Share of houses selling above asking in Runnymede-Bloor West Village, Toronto, against Tillsonburg — the two ends of the same province, the same twelve months."
      />

      <H2>The compression</H2>

      <P>
        The headline is that competition cooled: the over-ask rate for houses fell from 23.2% to{" "}
        <strong>18.1%</strong>, and for condos from 16.5% to <strong>12.2%</strong>. But an average
        conceals which neighbourhoods gave up those points, and the answer is not evenly distributed at
        all.
      </P>

      <P>
        Sorting neighbourhoods by how competitive they were <em>a year ago</em>, and then measuring what
        happened to each group, the pattern is unambiguous — <strong>the hotter a market was, the more
        it cooled</strong>:
      </P>

      <FigureTable caption="House neighbourhoods grouped by their over-ask rate a year ago · 201 areas, ≥100 sales in both periods">
        <thead>
          <tr>
            <Th>Group, ranked by last year</Th>
            <Th num>Areas</Th>
            <Th num>Rate a year ago</Th>
            <Th num>Rate now</Th>
            <Th num>Change</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>
              <Place name="Hottest quarter" />
            </Td>
            <Td num>50</Td>
            <Td num>45.0%</Td>
            <Td num>33.1%</Td>
            <Td num tone="down">
              <strong>−11.9 pts</strong>
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Third quarter" />
            </Td>
            <Td num>50</Td>
            <Td num>27.0%</Td>
            <Td num>19.4%</Td>
            <Td num tone="down">
              −7.6 pts
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Second quarter" />
            </Td>
            <Td num>50</Td>
            <Td num>18.1%</Td>
            <Td num>12.9%</Td>
            <Td num tone="down">
              −5.3 pts
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Coldest quarter" />
            </Td>
            <Td num>51</Td>
            <Td num>11.2%</Td>
            <Td num>9.6%</Td>
            <Td num tone="down">
              −1.6 pts
            </Td>
          </tr>
        </tbody>
      </FigureTable>

      <P>
        A year ago the distance between Ontario&rsquo;s hottest and coldest quarter of neighbourhoods was
        33.8 points. Today it is 23.5. The competitive market did not retreat to a defensible core — it{" "}
        <strong>compressed toward the middle</strong>. Of 201 neighbourhoods with enough sales to compare,{" "}
        <strong>172 fell and 29 rose</strong>.
      </P>

      <P>
        That is the opposite of what a cooling market is usually assumed to do. The intuition is that
        prime neighbourhoods hold their premium while marginal ones give way first. Here the premium
        neighbourhoods surrendered the most ground, precisely because they had the most to give up.
      </P>

      <H2>It is a geography story, not a price story</H2>

      <P>
        The obvious explanation for who sells over asking is money — that cheap homes attract multiple
        bidders and expensive ones sit. The data does not support it. Splitting every house sale in
        Ontario into five equal price bands, the over-ask rate barely moves:
      </P>

      <FigureTable caption="Over-ask rate by price band · Ontario houses, 107,380 sales">
        <thead>
          <tr>
            <Th>Price band</Th>
            <Th num>Sales</Th>
            <Th>Share sold over asking</Th>
          </tr>
        </thead>
        <tbody>
          {[
            { band: "Under $539,900", n: "21,476", pct: 14.6 },
            { band: "$539,900 – $700,000", n: "21,476", pct: 15.6 },
            { band: "$700,000 – $875,000", n: "21,476", pct: 19.7 },
            { band: "$875,000 – $1,180,000", n: "21,476", pct: 21.0 },
            { band: "Over $1,180,000", n: "21,476", pct: 20.3 },
          ].map((r) => (
            <tr key={r.band}>
              <Td>
                <Place name={r.band} />
              </Td>
              <Td num>{r.n}</Td>
              <Td>
                <BarCell pct={r.pct} />
              </Td>
            </tr>
          ))}
        </tbody>
      </FigureTable>

      <P>
        From the cheapest fifth of the market to the most expensive, the over-ask rate moves by under six
        points. Where the home <em>is</em> matters far more than what it costs:
      </P>

      <FigureTable caption="Over-ask rate by region · house neighbourhoods with ≥100 sales">
        <thead>
          <tr>
            <Th>Region</Th>
            <Th num>Areas</Th>
            <Th>Average over-ask rate</Th>
            <Th num>Hottest area</Th>
            <Th num>Change vs last year</Th>
          </tr>
        </thead>
        <tbody>
          {[
            { region: "Toronto (416)", areas: 28, pct: 34.6, hottest: "61.8%", chg: "−7.0 pts" },
            { region: "GTA (905)", areas: 74, pct: 22.6, hottest: "41.0%", chg: "−8.2 pts" },
            { region: "Rest of Ontario", areas: 124, pct: 13.3, hottest: "43.4%", chg: "−5.4 pts" },
            { region: "Ottawa", areas: 6, pct: 11.0, hottest: "16.7%", chg: "−9.2 pts" },
          ].map((r) => (
            <tr key={r.region}>
              <Td>
                <Place name={r.region} />
              </Td>
              <Td num>{r.areas}</Td>
              <Td>
                <BarCell pct={r.pct} />
              </Td>
              <Td num>{r.hottest}</Td>
              <Td num tone="down">
                {r.chg}
              </Td>
            </tr>
          ))}
        </tbody>
      </FigureTable>

      <P>
        Sharpen it further and the pattern narrows to one specific thing: <strong>houses in the old city
        of Toronto</strong>. Toronto houses average 34.6% over asking. Toronto condos average 15.2% —
        closer to houses in the rest of the province (16.6%) than to the houses on their own streets. The
        bidding war is not a Toronto phenomenon. It is a Toronto <em>house</em> phenomenon.
      </P>

      <P>
        And it is rarer than the coverage suggests. Of 232 house neighbourhoods with enough sales to
        measure, only <strong>three</strong> still see more than half of homes sell over asking.
        Twenty-two are above a third. <strong>Fifty are below 10%.</strong>
      </P>

      <H2>Why the rate alone will mislead you</H2>

      <P>
        Two neighbourhoods can share an over-ask rate and mean completely different things by it. In
        Ferris, North Bay, 43.4% of houses sold above asking — a rate that would place it among
        Toronto&rsquo;s hottest markets. The typical amount above asking was <strong>$12,000</strong>. In
        South Riverdale, 57.8% sold over asking by a median of <strong>$221,069</strong>.
      </P>

      <P>
        Both are real competition. Only one of them changes what a household can afford. Any figure
        quoted from this dataset should carry the premium alongside the rate.
      </P>

      <FigureTable caption="Where houses most often sell over asking · 12 months to August 2026, ≥100 sales">
        <thead>
          <tr>
            <Th>Neighbourhood</Th>
            <Th>Share sold over asking</Th>
            <Th num>Typical premium</Th>
            <Th num>vs last year</Th>
            <Th num>Sales</Th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: "Runnymede-Bloor West Village", sub: "Toronto", pct: 61.8, prem: "$170,000", chg: null, n: 102 },
            { name: "South Riverdale", sub: "Toronto", pct: 57.8, prem: "$221,069", chg: "+2.4 pts", n: 187 },
            { name: "East End-Danforth", sub: "Toronto", pct: 53.2, prem: "$182,750", chg: "−7.5 pts", n: 111 },
            { name: "Mount Pleasant East", sub: "Toronto", pct: 48.8, prem: "$112,040", chg: "−0.2 pts", n: 127 },
            { name: "Danforth Village-East York", sub: "Toronto", pct: 48.5, prem: "$151,000", chg: "−1.5 pts", n: 163 },
            { name: "Greenwood-Coxwell", sub: "Toronto", pct: 47.9, prem: "$175,500", chg: "−10.8 pts", n: 121 },
            { name: "Dovercourt-Wallace Emerson-Junction", sub: "Toronto", pct: 46.3, prem: "$200,181", chg: "+2.1 pts", n: 162 },
            { name: "The Beaches", sub: "Toronto", pct: 44.1, prem: "$196,000", chg: "−3.4 pts", n: 170 },
            { name: "Ferris", sub: "North Bay", pct: 43.4, prem: "$12,000", chg: "−10.4 pts", n: 113 },
            { name: "Waterloo", sub: "all areas", pct: 42.4, prem: "$50,100", chg: "−10.0 pts", n: 542 },
            { name: "Cambridge", sub: "all areas", pct: 41.5, prem: "$42,600", chg: "−4.9 pts", n: 937 },
            { name: "Lakeview", sub: "Oshawa", pct: 41.0, prem: "$41,000", chg: "−8.2 pts", n: 122 },
          ].map((r) => (
            <tr key={`${r.name}-${r.sub}`}>
              <Td>
                <Place name={r.name} sub={r.sub} />
              </Td>
              <Td>
                <BarCell pct={r.pct} />
              </Td>
              <Td num>{r.prem}</Td>
              {r.chg === null ? (
                <Td num tone="muted">
                  —
                </Td>
              ) : (
                <Td num tone={r.chg.startsWith("+") ? "up" : "down"}>
                  {r.chg}
                </Td>
              )}
              <Td num>{r.n}</Td>
            </tr>
          ))}
        </tbody>
      </FigureTable>

      <FigureTable caption="Where they almost never do · same period, ≥100 sales">
        <thead>
          <tr>
            <Th>Neighbourhood</Th>
            <Th>Share sold over asking</Th>
            <Th num>Typical discount</Th>
            <Th num>Sold vs ask</Th>
            <Th num>Sales</Th>
          </tr>
        </thead>
        <tbody>
          {[
            { name: "Tillsonburg", sub: undefined, pct: 2.7, disc: "$18,900", ratio: "97.2%", n: 220 },
            { name: "Grey Highlands", sub: undefined, pct: 2.8, disc: "$36,700", ratio: "94.6%", n: 145 },
            { name: "Meaford", sub: undefined, pct: 3.1, disc: "$37,375", ratio: "95.3%", n: 131 },
            { name: "Barrhaven – Half Moon Bay", sub: "Ottawa", pct: 3.5, disc: "$14,900", ratio: "98.2%", n: 256 },
            { name: "Northern Bruce Peninsula", sub: undefined, pct: 5.6, disc: "$29,940", ratio: "94.7%", n: 142 },
            { name: "Wasaga Beach", sub: undefined, pct: 5.7, disc: "$23,500", ratio: "96.7%", n: 473 },
          ].map((r) => (
            <tr key={r.name}>
              <Td>
                <Place name={r.name} sub={r.sub} />
              </Td>
              <Td>
                <BarCell pct={r.pct} />
              </Td>
              <Td num>{r.disc}</Td>
              <Td num>{r.ratio}</Td>
              <Td num>{r.n}</Td>
            </tr>
          ))}
        </tbody>
      </FigureTable>

      <H2>What we are not claiming</H2>

      <Caveat>
        <CaveatItem>
          <strong className="text-foreground">&ldquo;Over asking&rdquo; is not the same as &ldquo;bidding
          war.&rdquo;</strong>{" "}
          It means one buyer paid more than the seller publicly asked. That usually follows competing
          offers, but some listings are deliberately underpriced to invite them. We report the outcome in
          the record, not the process behind it.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Part of the compression is regression to the mean.</strong>{" "}
          Grouping neighbourhoods by last year&rsquo;s rate and measuring their change will always
          exaggerate movement at the extremes. The effect is real but not the whole story: pure
          regression would have pushed the coldest quarter <em>up</em>, and it fell too.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Shares and medians, never volumes.</strong> Our feed is a
          large subset of the Ontario market rather than all of it. Proportions are reliable; we do not
          publish counts of how many homes sold.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Runnymede-Bloor West Village has no year-over-year
          figure.</strong>{" "}
          Its prior 12-month window had under 100 sales, so we leave it blank rather than publish a change
          we cannot stand behind.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Year-over-year is in percentage points.</strong> A rate
          moving from 23.2% to 18.1% is a fall of five <em>points</em>, not 22%.
        </CaveatItem>
      </Caveat>

      <P>
        Every figure here compares a home&rsquo;s closed sale price against the final asking price on the
        same listing, from MLS® records after completion. Neighbourhoods need 30 closed sales in the
        trailing twelve months to appear at all, and 100 to be ranked or given a year-over-year change — a
        share is noisier than a median, and &ldquo;most competitive neighbourhood in Ontario&rdquo; is the
        most quotable and least robust cut available. Sales where the closing price differs from the ask
        by more than 50% either way are excluded as data-entry errors.
      </P>
    </>
  );
}
