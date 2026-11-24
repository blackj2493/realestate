/**
 * Build data/sold-prices.json — median sold prices per city over the last 12 full months: all
 * homes, by home type, detached houses by bedrooms, sale-to-asking, days on market, and every
 * community with enough sales. /data/sold-prices renders the file statically.
 *
 *   npx tsx scripts/data/buildSoldPrices.ts          # print the results
 *   npx tsx scripts/data/buildSoldPrices.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction over raw_vow_sold). Run monthly by refresh-sold-prices.yml.
 * Medians only: no address, no single sale. Sold records with a price of $150K–$8M, by the date
 * the deal was signed. Toronto = every "Toronto C01…W10" City value; Ottawa = OTTAWA_AREAS.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { TYPE_GROUPS, typeGroupOf, type TypeGroup } from "@/lib/data/priceChangeModel";
import type { SoldCity, SoldCommunity, SoldPricesFile, SoldStats } from "@/lib/data/soldPricesModel";

const OUT = "data/sold-prices.json";
const WRITE = process.argv.includes("--write");
/** A type, bedroom group or community figure needs this many sales. */
const MIN_GROUP = 15;
/** A community is listed with this many sales of all types. */
const MIN_COMMUNITY = 25;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const k = (n: number | null) => (n == null ? null : Math.round(n / 1000) * 1000);

interface Sale {
  hood: string;
  type: TypeGroup;
  beds: number;
  price: number;
  ratio: number | null;
  dom: number | null;
}

function stats(s: Sale[]): SoldStats {
  const ratios = s.filter((x) => x.ratio != null).map((x) => x.ratio!);
  const doms = s.filter((x) => x.dom != null).map((x) => x.dom!);
  const r = median(ratios);
  return {
    sales: s.length,
    medianPrice: k(median(s.map((x) => x.price))),
    saleToAsk: r == null ? null : Math.round(r * 1000) / 10,
    overAskShare: ratios.length ? Math.round((ratios.filter((x) => x > 1.0001).length / ratios.length) * 100) : null,
    medianDom: median(doms) == null ? null : Math.round(median(doms)!),
  };
}

function cityFilter(city: string): { sql: string; params: unknown[] } {
  if (city === "Toronto") return { sql: `city like 'Toronto %'`, params: [] };
  if (city === "Ottawa") return { sql: `city = any($3::text[])`, params: [OTTAWA_AREAS] };
  return { sql: `city = $3`, params: [city] };
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const now = new Date();
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const from = addMonths(to, -12);
  const out: SoldCity[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of OUTLOOK_CITIES) {
      const f = cityFilter(city);
      const res = await client.query(
        `select coalesce(city_region,'') hood, property_sub_type t, coalesce(bedrooms_above_grade,0)::int beds,
                close_price::float8 price, list_price::float8 lp, days_on_market dom
           from raw_vow_sold
          where transaction_type = 'For Sale' and close_price between 150000 and 8000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and property_sub_type in ('Detached','Semi-Detached','Att/Row/Townhouse','Link','Condo Apartment','Condo Townhouse')
            and ${f.sql}`,
        [from, to, ...f.params],
      );
      const sales: Sale[] = [];
      for (const r of res.rows) {
        const type = typeGroupOf(String(r.t));
        if (!type) continue;
        const lp = Number(r.lp);
        const dom = Number(r.dom);
        sales.push({
          hood: r.hood,
          type,
          beds: r.beds,
          price: r.price,
          ratio: lp > 0 && r.price / lp > 0.7 && r.price / lp < 1.5 ? r.price / lp : null,
          dom: Number.isFinite(dom) && dom >= 0 && dom < 1000 ? dom : null,
        });
      }
      const byType = Object.fromEntries(
        TYPE_GROUPS.map((t) => {
          const s = sales.filter((x) => x.type === t);
          return [t, s.length >= MIN_GROUP ? stats(s) : null];
        }),
      ) as Record<TypeGroup, SoldStats | null>;
      const det = sales.filter((x) => x.type === "detached");
      const detachedByBeds = ["2", "3", "4", "5+"]
        .map((b) => {
          const s = det.filter((x) => (b === "5+" ? x.beds >= 5 : x.beds === Number(b)));
          return { beds: b, sales: s.length, medianPrice: k(median(s.map((x) => x.price))) ?? 0 };
        })
        .filter((x) => x.sales >= MIN_GROUP);
      const communities: SoldCommunity[] = [...new Set(sales.map((s) => s.hood).filter(Boolean))]
        .map((h) => {
          const s = sales.filter((x) => x.hood === h);
          return {
            name: h,
            sales: s.length,
            medianPrice: k(median(s.map((x) => x.price))) ?? 0,
            byType: Object.fromEntries(
              TYPE_GROUPS.map((t) => {
                const p = s.filter((x) => x.type === t).map((x) => x.price);
                return [t, p.length >= MIN_GROUP ? k(median(p)) : null];
              }),
            ) as Record<TypeGroup, number | null>,
          };
        })
        .filter((c) => c.sales >= MIN_COMMUNITY)
        .sort((a, b) => b.sales - a.sales);
      const row: SoldCity = { city, slug, all: stats(sales), byType, detachedByBeds, communities };
      out.push(row);
      console.log(
        `${city.padEnd(14)} n=${String(sales.length).padStart(6)} med $${row.all.medianPrice} s/a ${row.all.saleToAsk}% | ` +
          TYPE_GROUPS.map((t) => `${t}:${byType[t]?.medianPrice ?? "-"}`).join(" ") +
          ` | det beds ${detachedByBeds.map((b) => `${b.beds}:${b.medianPrice}`).join(" ")} | communities ${communities.length}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
  const file: SoldPricesFile = { generatedAt: new Date().toISOString(), from, to, cities: out };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
