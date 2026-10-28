/**
 * "Power-of-sale houses sell for about $96,000 less" — 2026-10-28.
 *
 * Every figure is a share, a median or a model estimate. Sample sizes appear only as
 * sample sizes (the "in the sample" column), never as a count of how many homes the
 * market sold — the feed is a large subset of Ontario, not all of it.
 *
 * THE CONDITION CAVEAT IS LOAD-BEARING. About half of power-of-sale listings say
 * "as-is", against ~2.5% of other listings, because lenders write it on nearly every
 * one. It is boilerplate, not a description of the house, so it cannot be used as a
 * condition control without absorbing half the effect. The piece reports both readings
 * (−10.8% and about −5%) rather than picking the flattering one.
 *
 * Scripts and numbers: power-of-sale-insight-2026-10 (raw_vow_sold, contracts
 * 2024-07-01 to 2026-09-30, PublicRemarks ~* 'power\s+of\s+sale').
 */
import Link from "next/link";
import {
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
const FILTER = "/properties?signal=power_of_sale";
const LINK = "text-cyan-700 underline underline-offset-2 dark:text-cyan-400";

export default function OntarioPowerOfSaleDiscount() {
  return (
    <>
      <P>
        When a homeowner falls far enough behind on the mortgage, the lender can take over the sale. In
        Ontario that is a <strong>power of sale</strong>: the lender lists the home, sells it as-is, and
        recovers what it is owed. These sales are rare — about <strong>1 in 250</strong> Ontario sales over
        the last two years — but the buyers who found them paid noticeably less than their neighbours did.
      </P>

      <Pull
        value={
          <>
            $797K <span className="text-2xl font-normal text-muted-foreground">vs</span> $893K
          </>
        }
        caption="The typical power-of-sale house, against the price of a similar home in the same neighbourhood, signed in the same quarter. A gap of about $96,000, or 10.8%."
      />

      <H2>What power-of-sale buyers paid</H2>

      <P>
        We compared every power-of-sale house with the houses around it: the same neighbourhood, the same
        type, the same number of bedrooms and the same size range, with the deal signed in the same
        quarter. Against that comparison, power-of-sale houses sold for <strong>10.8% less</strong> (95%
        range: 8.8% to 12.6% less) — about <strong>$96,000</strong> on a typical house.
        A simpler check, comparing each one with the median of similar homes sold in the same half-year,
        gives $90,000.
      </P>

      <FigureTable caption="Power-of-sale homes against other homes · Ontario MLS® sales, contracts July 2024 to September 2026">
        <thead>
          <tr>
            <Th>Measure</Th>
            <Th num>Power of sale</Th>
            <Th num>Other homes</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>
              <Place name="Houses: price vs similar homes nearby" />
            </Td>
            <Td num tone="down">
              <strong>−10.8%</strong>
            </Td>
            <Td num tone="muted">
              —
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Houses: sold below the asking price" />
            </Td>
            <Td num>
              <strong>84%</strong>
            </Td>
            <Td num>75%</Td>
          </tr>
          <tr>
            <Td>
              <Place name="Houses: median sale price as a share of asking" />
            </Td>
            <Td num>95.6%</Td>
            <Td num>97.6%</Td>
          </tr>
          <tr>
            <Td>
              <Place name="Houses: median days on the market" />
            </Td>
            <Td num>
              <strong>32</strong>
            </Td>
            <Td num>22</Td>
          </tr>
          <tr>
            <Td>
              <Place name="Condos: price vs similar units nearby" />
            </Td>
            <Td num tone="down">
              <strong>−9.4%</strong>
            </Td>
            <Td num tone="muted">
              —
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Condos: sold below the asking price" />
            </Td>
            <Td num>86%</Td>
            <Td num>81%</Td>
          </tr>
          <tr>
            <Td>
              <Place name="Condos: median days on the market" />
            </Td>
            <Td num>48</Td>
            <Td num>29</Td>
          </tr>
        </tbody>
      </FigureTable>

      <P>
        The negotiation looks different too. Most Ontario homes sold under asking in this period, but
        power-of-sale homes did so more often, by more, and after longer on the market. A buyer who finds
        one has more time and more room than the same buyer bidding on the house next door.
      </P>

      <H2>Is it just the condition of the house?</H2>

      <P>
        Partly. A lender sells as-is, with none of the disclosures an owner would give, and some of these
        homes need work. But the gap does not go away when we look only at listings that mention no
        repairs at all:
      </P>

      <FigureTable caption="Power-of-sale houses · price against similar homes nearby">
        <thead>
          <tr>
            <Th>Which power-of-sale houses</Th>
            <Th num>Price vs similar homes</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>
              <Place name="All" />
            </Td>
            <Td num tone="down">
              −10.8%
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="Listing mentions no repairs" sub="no “needs work”, “TLC”, “handyman”, “fixer-upper”" />
            </Td>
            <Td num tone="down">
              −10.4%
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="If every “as-is” home is assumed to be in worse shape" />
            </Td>
            <Td num tone="down">
              about −5%
            </Td>
          </tr>
        </tbody>
      </FigureTable>

      <P>
        The last row is the cautious reading. About half of power-of-sale listings say &ldquo;as-is&rdquo;,
        against roughly 1 in 40 other listings, but that is because lenders write it on nearly every one —
        it describes the sale, not the house. Treating it as a sign of poor condition anyway halves the
        gap. The real discount sits somewhere between the two, and either way the buyer does more of the
        homework.
      </P>

      <H2>There are more of them now</H2>

      <FigureTable caption="Power-of-sale share of all sales · by contract date">
        <thead>
          <tr>
            <Th>Area</Th>
            <Th num>Jul 2024 – Jun 2025</Th>
            <Th num>Jul 2025 – Jun 2026</Th>
            <Th num>Jul – Sep 2026</Th>
          </tr>
        </thead>
        <tbody>
          {[
            { area: "Ontario", a: "0.26%", b: "0.36%", c: "0.41%" },
            { area: "Brampton", a: "0.70%", b: "1.38%", c: "1.87%" },
            { area: "Toronto", a: "0.24%", b: "0.35%", c: "0.36%" },
          ].map((r) => (
            <tr key={r.area}>
              <Td>
                <Place name={r.area} />
              </Td>
              <Td num>{r.a}</Td>
              <Td num>{r.b}</Td>
              <Td num>
                <strong>{r.c}</strong>
              </Td>
            </tr>
          ))}
        </tbody>
      </FigureTable>

      <P>
        Brampton stands out: this summer close to <strong>1 in 50</strong> sales there was a power of sale,
        more than double its rate two years earlier. Across the rest of the GTA outside Toronto the share
        also roughly doubled, while Ontario outside the GTA stayed flat at about 0.25–0.30%.
      </P>

      <P>
        One early sign, which we will keep watching: in the GTA, homes <strong>five years old or
        newer</strong> went to power of sale at about <strong>twice the rate</strong> of older homes in the
        same city (0.55% of sales against 0.25%). Those are mostly homes bought new, or pre-construction,
        close to the 2021–22 peak. The sample is still small, so treat it as a direction rather than a
        measurement.
      </P>

      <FigureTable caption="GTA power-of-sale share by building age · contracts July 2024 to September 2026">
        <thead>
          <tr>
            <Th>Building age at sale</Th>
            <Th num>Share of sales that were power of sale</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>
              <Place name="0–5 years" />
            </Td>
            <Td num>
              <strong>0.55%</strong>
            </Td>
          </tr>
          <tr>
            <Td>
              <Place name="6 years and older" />
            </Td>
            <Td num>0.25%</Td>
          </tr>
        </tbody>
      </FigureTable>

      <H2>Finding them</H2>

      <P>
        The hard part is not the price; it is noticing the listing. Power of sale is not a field on the
        MLS® record — it lives in the description an agent writes, worded a dozen ways. Our listing search
        reads each description and tags the ones that say power of sale, foreclosure, bank-owned,
        court-ordered or receivership, so they can be filtered like any other feature.{" "}
        <Link href={FILTER} className={LINK}>
          See every active power-of-sale listing in Ontario
        </Link>
        , or compare how often homes in your area sell above or below asking on the{" "}
        <Link href={TRACKER} className={LINK}>
          Sold Over Asking tracker
        </Link>
        .
      </P>

      <H2>What we are not claiming</H2>

      <Caveat>
        <CaveatItem>
          <strong className="text-foreground">A power-of-sale home is not automatically a good buy.</strong>{" "}
          The discount is an average across many homes. Some sold at full value; some needed every dollar of
          the difference in repairs. Inspect, and price the work in.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">We only see the ones that say so.</strong> A sale counts as power
          of sale when its listing description says &ldquo;power of sale&rdquo;. Listings that leave it out are
          missed, so every share here is a floor. None of the matches was a listing saying it was
          &ldquo;not a power of sale&rdquo;.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">The dollar figure is a typical home, not every home.</strong>{" "}
          $96,000 is the 10.8% gap applied to the median power-of-sale house in the comparison. Toronto and
          the rest of the GTA have higher prices, and the two methods we used disagree more there, so we do
          not quote a separate GTA dollar figure.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Building age is thinly reported.</strong> The listing&rsquo;s
          approximate-age field is filled in on only about 37% of GTA sales, and less often on power-of-sale
          listings. The age result is a direction, not a rate to quote.
        </CaveatItem>
        <CaveatItem>
          <strong className="text-foreground">Shares and medians, not volumes.</strong> Our feed is a large
          subset of the Ontario market rather than all of it. Proportions are reliable; we do not publish
          counts of how many homes sold.
        </CaveatItem>
      </Caveat>

      <P>
        Method. MLS® sales with a contract date from July 1, 2024 to September 30, 2026; leases excluded.
        &ldquo;Similar homes&rdquo; means the same city, neighbourhood, property type, bedroom count and size
        range, with the contract signed in the same quarter; groups with fewer than five sales are left out.
        The price gap is a regression on log sale price within those groups with quarter controls; its 95%
        range (−12.6% to −8.8% for houses) comes from resampling whole groups. Days on market is the
        listing&rsquo;s own count.
      </P>
    </>
  );
}
