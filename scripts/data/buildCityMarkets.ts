/**
 * Build data/city-markets.json — the market-board figures (monthly median sale price, sales
 * and sale-to-asking; sold below the first asking price; price cuts on homes for sale now;
 * market type) for the extra study cities, which the nightly region_metrics precompute does
 * not cover. Feeds /data/housing-market, /data/days-on-market, /data/good-time-to-buy,
 * /data/rent-vs-buy and /home-value for those cities.
 *
 * DEFINITIONS. Each query copies its region RPC: region_price_trend (migration 109) for the
 * monthly points and the 90-day summary, region_sold_dynamics (153) for the 12-month gap to
 * the first asking price and the days to sell, region_dom_distribution (153) for the time on
 * the market of homes for sale now, region_price_cuts (153) for the cuts, region_rental_yield
 * (153, as live in the database) for rent against price by bedroom count, and monthlyVelocity /
 * temperatureOf (src/lib/market/aggregates.ts, src/lib/dashboard/marketAggregates.ts) for
 * the market type. One change: the city filter is studyCityFilter, with no CountyOrParish
 * match (county "Waterloo" holds Kitchener and Cambridge; "Peterborough" its townships).
 *
 * Read-only (one READ ONLY transaction). Run weekly by refresh-city-markets.yml.
 *
 *   npx tsx scripts/data/buildCityMarkets.ts           # print only
 *   npx tsx scripts/data/buildCityMarkets.ts --write   # write data/city-markets.json
 *   CITIES=Mississauga npx tsx scripts/data/buildCityMarkets.ts   # check against a board city's region_metrics
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { EXTRA_STUDY_CITIES, studyCityFilter } from "@/lib/data/studyCities";
import { cityHubSlug } from "@/lib/listings/listingPath";
import { temperatureOf } from "@/lib/dashboard/marketAggregates";
import type { CityMarket, CityMarketsFile } from "@/lib/data/cityMarketsModel";

const OUT = "data/city-markets.json";
const WRITE = process.argv.includes("--write");

const num = (v: unknown): number | null => (v == null ? null : Number(v));
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const now = new Date();
  const out: CityMarket[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    const cities = process.env.CITIES ? process.env.CITIES.split(",") : EXTRA_STUDY_CITIES;
    for (const city of cities) {
      const f = studyCityFilter(city, 1);

      // region_price_trend: 24 month-aligned months, full months only; plus the 90-day summary.
      const trend = await client.query(
        `with base as (
           select close_price::numeric price, list_price::numeric list, purchase_contract_date::date pcd
             from raw_vow_sold
            where ${f.sql} and transaction_type = 'For Sale' and close_price >= 50000
              and purchase_contract_date >= date_trunc('month', current_date) - interval '24 months')
         select to_char(date_trunc('month', pcd), 'YYYY-MM') as month,
                round(percentile_cont(0.5) within group (order by price))::int median_price,
                count(*)::int sales,
                round(avg(price / list) filter (where list >= 50000 and price / list > 0.5 and price / list < 2) * 100, 1) s2l,
                null::int sales90, null::int with_list, null::numeric ratio_avg, null::int over_ask
           from base where pcd < date_trunc('month', current_date) group by 1
         union all
         select 's90', null, null, null, count(*)::int,
                count(*) filter (where list >= 50000 and price / list > 0.5 and price / list < 2)::int,
                avg(price / list) filter (where list >= 50000 and price / list > 0.5 and price / list < 2),
                count(*) filter (where list >= 50000 and price / list > 0.5 and price / list < 2 and price > list)::int
           from base where pcd >= current_date - 90
         order by 1`,
        f.params,
      );
      const monthly = trend.rows
        .filter((r) => r.month !== "s90" && r.median_price != null)
        .map((r) => ({ month: String(r.month), medianPrice: Number(r.median_price), sales: Number(r.sales), soldToList: num(r.s2l) }));
      const s = trend.rows.find((r) => r.month === "s90")!;
      const sales90 = Number(s.sales90);
      const withList = Number(s.with_list);
      const listOk = withList >= 10 && withList / Math.max(sales90, 1) >= 0.5;
      const soldToListPct = listOk ? Math.round(Number(s.ratio_avg) * 1000) / 10 : null;
      const pctOverAsking = listOk ? Math.round((Number(s.over_ask) / withList) * 1000) / 10 : null;

      // region_sold_dynamics: last 12 months, sale against the FIRST asking price, and the
      // days to sell (board value, else the contract-date span; 0..730).
      const dyn = await client.query(
        `with base as (
           select close_price::numeric price,
                  coalesce(original_list_price, nullif(raw_payload->>'OriginalListPrice', '')::numeric) olp,
                  coalesce(days_on_market,
                           case when listing_contract_date is not null
                                then greatest(0, purchase_contract_date - listing_contract_date) end,
                           nullif(raw_payload->>'DaysOnMarket', '')::numeric,
                           case when raw_payload->>'ListingContractDate' ~ '^\\d{4}-\\d{2}-\\d{2}'
                                then greatest(0, purchase_contract_date - (raw_payload->>'ListingContractDate')::date) end) dom
             from raw_vow_sold
            where ${f.sql} and transaction_type = 'For Sale' and close_price >= 50000
              and purchase_contract_date >= (current_date - interval '12 months')),
         gap as (select (price - olp) / olp gap, (price < olp) under from base
                  where olp > 50000 and (price - olp) / olp between -0.6 and 0.6),
         dom_band as (select dom from base where dom is not null and dom >= 0 and dom <= 730)
         select (select count(*)::int from base) sold,
                (select round(percentile_cont(0.5) within group (order by dom))::int from dom_band) dom_median,
                (select round(percentile_cont(0.25) within group (order by dom))::int from dom_band) dom_p25,
                (select round(percentile_cont(0.75) within group (order by dom))::int from dom_band) dom_p75,
                (select round((percentile_cont(0.5) within group (order by gap) * 100)::numeric, 1) from gap) gap_median,
                (select round(avg(case when under then 1 else 0 end), 3) from gap) under_share`,
        f.params,
      );
      const d = dyn.rows[0];

      // region_dom_distribution: homes for sale now, latest listing per property, relist chains
      // joined (property_dom_chain), true clock against the listing's own clock.
      const domq = await client.query(
        `with scoped as materialized (
           select distinct on (coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key))
                  property_hash, original_entry_timestamp oet_ts,
                  coalesce(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', ''))) eff_status
             from listings
            where ${f.sql} and list_price >= 50000
              and coalesce(last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor()
            order by coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key),
                     original_entry_timestamp desc nulls last, listing_key desc),
         live as (
           select s.oet_ts, c.stitched_start, c.newest_entry
             from scoped s left join property_dom_chain c on c.property_hash = s.property_hash
            where case when c.newest_status is not null then c.newest_status = 'Active'
                       else s.eff_status not in ('sold','closed','closed sale','leased','terminated','expired','suspended') end),
         calc as (
           select greatest(0, floor(extract(epoch from (now() - coalesce(newest_entry, oet_ts))) / 86400))::int naive,
                  greatest(0, floor(extract(epoch from (now() - coalesce(stitched_start, newest_entry, oet_ts))) / 86400))::int td
             from live where coalesce(newest_entry, oet_ts) is not null)
         select count(*)::int n,
                round(percentile_cont(0.5) within group (order by td))::int true_dom,
                round(percentile_cont(0.5) within group (order by naive))::int naive_dom,
                count(*) filter (where td between 0 and 14)::int d0_14,
                count(*) filter (where td between 15 and 30)::int d15_30,
                count(*) filter (where td between 31 and 60)::int d31_60,
                count(*) filter (where td between 61 and 90)::int d61_90,
                count(*) filter (where td >= 91)::int d90plus
           from calc`,
        f.params,
      );
      const dm = domq.rows[0];
      const domActive = Number(dm.n);

      // region_price_cuts: homes for sale now (latest row per property, feed-verified live).
      const cuts = await client.query(
        `with ranked as (
           select last_seen_at, list_price, total_price_drop as dr,
                  row_number() over (partition by coalesce(nullif(property_hash, ''), nullif(norm_address, ''), listing_key)
                                     order by last_seen_at desc nulls last, original_entry_timestamp desc nulls last, listing_key desc) rn
             from listings
            where ${f.sql} and list_price >= 50000
              and coalesce(standard_status, lower(coalesce(full_payload->>'Status', full_payload->>'MlsStatus', full_payload->>'StandardStatus', '')))
                  not in ('sold','closed','closed sale','leased','terminated','expired','suspended')),
         active as (
           select list_price, dr,
                  (dr > 0 and list_price > 0 and (dr / (list_price + dr)) between 0.005 and 0.6) is_cut
             from ranked
            where rn = 1 and coalesce(last_seen_at, '-infinity'::timestamptz) >= public.feed_liveness_floor())
         select count(*)::int active, count(*) filter (where is_cut)::int cut,
                round(percentile_cont(0.5) within group (order by dr) filter (where is_cut))::int cut_amt,
                round(percentile_cont(0.5) within group (order by (dr / (list_price + dr) * 100)) filter (where is_cut)::numeric, 1) cut_pct
           from active`,
        f.params,
      );
      const c = cuts.rows[0];
      const activeCount = Number(c.active);

      // region_rental_yield: rent per bedroom count (rental_market_index, city tier, one row
      // per cohort by basis priority) against the 12-month median sale price.
      const rental = await client.query(
        `with region_rows as (
           select match_tier, city, city_region, county, property_sub_type, sub_type_family,
                  bedrooms_total, bedrooms_above, den, bathrooms, basis, avg_rent, sample_count
             from rental_market_index
            where match_tier = 'city' and ${f.sql}
              and bedrooms_above is not null and bedrooms_above between 1 and 5),
         one_per_cohort as (
           select distinct on (match_tier, city, city_region, county, property_sub_type, sub_type_family,
                               bedrooms_total, bedrooms_above, den, bathrooms)
                  bedrooms_above, avg_rent, sample_count
             from region_rows
            order by match_tier, city, city_region, county, property_sub_type, sub_type_family,
                     bedrooms_total, bedrooms_above, den, bathrooms,
                     case basis when 'closed_12' then 1 when 'closed_24' then 2 else 3 end),
         rent as (
           select bedrooms_above beds,
                  round(sum(avg_rent * greatest(sample_count, 1)) / sum(greatest(sample_count, 1)))::int rent,
                  sum(coalesce(sample_count, 0))::int rent_n
             from one_per_cohort where avg_rent > 0 group by 1),
         price as (
           select bedrooms_above_grade beds,
                  percentile_cont(0.5) within group (order by close_price)::bigint price,
                  count(*)::int price_n
             from raw_vow_sold
            where ${f.sql} and transaction_type = 'For Sale' and close_price >= 50000
              and purchase_contract_date >= current_date - interval '12 months'
              and bedrooms_above_grade between 1 and 5
            group by 1)
         select r.beds, r.rent, r.rent_n, p.price, coalesce(p.price_n, 0) price_n,
                case when p.price > 50000 and p.price_n >= 5 then round((r.rent * 12.0) / p.price * 100, 2) end yield
           from rent r left join price p on p.beds = r.beds
          where r.rent_n > 0 order by r.beds`,
        f.params,
      );
      const rentalRows = rental.rows.map((r) => ({
        beds: Number(r.beds),
        typicalRent: num(r.rent),
        medianPrice: num(r.price),
        grossYieldPct: num(r.yield),
        rentSample: Number(r.rent_n),
        priceSample: Number(r.price_n),
      }));

      // monthlyVelocity: the 3 settled months 2..4 back; months of supply gated on sales90 >= 10.
      const byMonth = new Map(monthly.map((m) => [m.month, m.sales]));
      let vel = 0;
      for (let i = 2; i <= 4; i++) vel += byMonth.get(monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)))) ?? 0;
      const velocity = vel > 0 ? vel / 3 : null;
      const monthsOfSupply = sales90 >= 10 && activeCount > 0 && velocity ? Math.round((activeCount / velocity) * 10) / 10 : null;

      const row: CityMarket = {
        city,
        slug: cityHubSlug(city),
        monthly,
        sales90,
        soldToListPct,
        pctOverAsking,
        soldCount12m: Number(d.sold),
        soldMedianDom: num(d.dom_median),
        soldP25Dom: num(d.dom_p25),
        soldP75Dom: num(d.dom_p75),
        // assembleRegionScore: the true clock needs 10+ homes for sale.
        trueDom: domActive >= 10 ? num(dm.true_dom) : null,
        medianNaiveDom: num(dm.naive_dom),
        domBuckets: domActive > 0
          ? { d0_14: Number(dm.d0_14), d15_30: Number(dm.d15_30), d31_60: Number(dm.d31_60), d61_90: Number(dm.d61_90), d90plus: Number(dm.d90plus) }
          : null,
        underAskShare: num(d.under_share),
        askGapMedian: num(d.gap_median),
        activeCount,
        cutCount: Number(c.cut),
        medianCutPct: num(c.cut_pct),
        medianCutAmt: num(c.cut_amt),
        monthsOfSupply,
        temperature: temperatureOf(monthsOfSupply, soldToListPct),
        rentalRows,
      };
      out.push(row);
      const last = monthly[monthly.length - 1];
      console.log(
        `${city.padEnd(14)} months=${monthly.length} last=${last?.month} $${last?.medianPrice} n=${last?.sales} | s90=${sales90} s2l=${soldToListPct} over=${pctOverAsking}% | ` +
          `12m=${row.soldCount12m} under=${row.underAskShare} gap=${row.askGapMedian} dom=${row.soldMedianDom} (${row.soldP25Dom}-${row.soldP75Dom}) | ` +
          `true=${row.trueDom} naive=${row.medianNaiveDom} 90+=${row.domBuckets?.d90plus}/${domActive} | ` +
          `rent ${rentalRows.map((r) => `${r.beds}b $${r.typicalRent} n=${r.rentSample} y=${r.grossYieldPct}`).join(" ")} | active=${activeCount} cut=${row.cutCount} (${row.medianCutPct}%) | mos=${monthsOfSupply} ${row.temperature}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const file: CityMarketsFile = { generatedAt: now.toISOString(), cities: out };
  if (WRITE && !process.env.CITIES) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
