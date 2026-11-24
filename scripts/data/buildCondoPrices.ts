/**
 * Build data/condo-prices.json — condo apartment prices and fees per city over the last 12
 * full months: median sale price by unit type, approximate price per sq ft, median monthly
 * fee and fee per sq ft, sale-to-asking, days on market, and the same figures for each
 * community with enough sales. /data/condo-prices renders the file statically.
 *
 *   npx tsx scripts/data/buildCondoPrices.ts          # print the results
 *   npx tsx scripts/data/buildCondoPrices.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction over raw_vow_sold). Run monthly by refresh-condo-prices.yml.
 *
 * SIZE. The feed gives a size RANGE ("600-699"), never an exact area; living_area_range holds
 * the range midpoint. Per-sq-ft figures divide by that midpoint, so they are approximate and
 * the pages say so. Fees: AssociationFee (monthly), kept when $50–$5,000 and $0.20–$3.00/sq ft.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { UNIT_TYPES, unitTypeOf, type CondoArea, type CondoPricesFile, type CondoStats, type UnitType } from "@/lib/data/condoPricesModel";

const OUT = "data/condo-prices.json";
const WRITE = process.argv.includes("--write");
/** A city is published with this many condo apartment sales in 12 months. */
const MIN_CITY = 150;
/** A unit type or a community row needs this many. */
const MIN_GROUP = 25;

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
const round = (n: number | null, step: number) => (n == null ? null : Math.round(n / step) * step);

interface Sale {
  hood: string;
  unit: UnitType | null;
  price: number;
  sqft: number | null;
  fee: number | null;
  ratio: number | null;
  dom: number | null;
}

function stats(sales: Sale[]): CondoStats {
  const psf = sales.filter((s) => s.sqft).map((s) => s.price / s.sqft!);
  const fees = sales.filter((s) => s.fee != null).map((s) => s.fee!);
  const feePsf = sales.filter((s) => s.fee != null && s.sqft).map((s) => s.fee! / s.sqft!);
  const ratios = sales.filter((s) => s.ratio != null).map((s) => s.ratio!);
  const doms = sales.filter((s) => s.dom != null).map((s) => s.dom!);
  return {
    sales: sales.length,
    medianPrice: round(median(sales.map((s) => s.price)), 1000),
    medianSqft: round(median(sales.filter((s) => s.sqft).map((s) => s.sqft!)), 10),
    pricePsf: round(median(psf), 1),
    medianFee: round(median(fees), 1),
    feePsf: median(feePsf) == null ? null : Math.round(median(feePsf)! * 100) / 100,
    feeSample: fees.length,
    saleToAsk: median(ratios) == null ? null : Math.round(median(ratios)! * 1000) / 10,
    overAskShare: ratios.length ? Math.round((ratios.filter((r) => r > 1.0001).length / ratios.length) * 100) : null,
    medianDom: round(median(doms), 1),
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

  const areas: CondoArea[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of OUTLOOK_CITIES) {
      const f = cityFilter(city);
      const res = await client.query(
        `select coalesce(city_region,'') hood, coalesce(bedrooms_above_grade,0)::int ba,
                nullif(raw_payload->>'BedroomsTotal','') bt, living_area_range sqft, close_price::float8 price,
                list_price::float8 lp, days_on_market dom, raw_payload->>'AssociationFee' fee
           from raw_vow_sold
          where transaction_type = 'For Sale' and property_sub_type = 'Condo Apartment'
            and close_price between 100000 and 6000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and ${f.sql}`,
        [from, to, ...f.params],
      );
      const sales: Sale[] = res.rows.map((r) => {
        const sqft = Number(r.sqft) >= 200 && Number(r.sqft) <= 5000 ? Number(r.sqft) : null;
        const feeRaw = Number(r.fee);
        const fee =
          Number.isFinite(feeRaw) && feeRaw >= 50 && feeRaw <= 5000 && (!sqft || (feeRaw / sqft >= 0.2 && feeRaw / sqft <= 3)) ? feeRaw : null;
        const lp = Number(r.lp);
        const ratio = lp > 0 && r.price / lp > 0.7 && r.price / lp < 1.5 ? r.price / lp : null;
        const dom = Number(r.dom);
        return {
          hood: r.hood,
          unit: unitTypeOf(r.ba, r.bt == null ? null : Number(r.bt)),
          price: r.price,
          sqft,
          fee,
          ratio,
          dom: Number.isFinite(dom) && dom >= 0 && dom < 1000 ? dom : null,
        };
      });
      if (sales.length < MIN_CITY) {
        console.log(`${city.padEnd(14)} n=${sales.length} — not published`);
        continue;
      }
      const byUnit = Object.fromEntries(
        UNIT_TYPES.map((u) => {
          const s = sales.filter((x) => x.unit === u);
          return [u, s.length >= MIN_GROUP ? stats(s) : null];
        }),
      ) as Record<UnitType, CondoStats | null>;
      const hoods = [...new Set(sales.map((s) => s.hood).filter(Boolean))]
        .map((h) => ({ name: h, ...stats(sales.filter((s) => s.hood === h)) }))
        .filter((h) => h.sales >= MIN_GROUP)
        .sort((a, b) => b.sales - a.sales);
      const all = stats(sales);
      areas.push({ city, slug, all, byUnit, communities: hoods });
      console.log(
        `${city.padEnd(14)} n=${String(sales.length).padStart(5)} med $${all.medianPrice} psf $${all.pricePsf} fee $${all.medianFee} (${all.feePsf}/sqft) s/a ${all.saleToAsk}% over ${all.overAskShare}% dom ${all.medianDom} | ` +
          UNIT_TYPES.map((u) => `${u}:${byUnit[u]?.medianPrice ?? "-"}`).join(" ") +
          ` | communities ${hoods.length}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const file: CondoPricesFile = { generatedAt: new Date().toISOString(), from, to, cities: areas };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
