/**
 * Build data/property-tax.json — what owners pay in property tax, per city, over the last 12
 * full months of sales: median annual tax by home type, the middle half of the range, tax per
 * $100,000 of sale price, and the same figures for each community with enough sales.
 * /data/property-tax renders the file statically.
 *
 *   npx tsx scripts/data/buildPropertyTax.ts          # print the results
 *   npx tsx scripts/data/buildPropertyTax.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction over raw_vow_sold). Run monthly by refresh-property-tax.yml.
 *
 * SOURCE. TaxAnnualAmount is the seller's last annual tax bill as entered on the listing, with
 * TaxYear (mostly the year before the sale). Kept when $300-$100,000 and 0.1%-3% of the sale
 * price, which drops typos, monthly amounts entered as annual, and vacant land.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { STUDY_CITIES, studyCityFilter } from "@/lib/data/studyCities";
import { TAX_HOME_TYPES, taxHomeTypeOf, type PropertyTaxFile, type TaxArea, type TaxHomeType, type TaxStats } from "@/lib/data/propertyTaxModel";

const OUT = "data/property-tax.json";
const WRITE = process.argv.includes("--write");
/** A city is published with this many sales with a usable tax amount in 12 months. */
const MIN_CITY = 150;
/** A home type or a community row needs this many. */
const MIN_GROUP = 25;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const quantile = (v: number[], q: number): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};
const round = (n: number | null, step: number) => (n == null ? null : Math.round(n / step) * step);

interface Sale {
  hood: string;
  type: TaxHomeType | null;
  price: number;
  tax: number;
  year: number | null;
}

function stats(sales: Sale[]): TaxStats {
  const taxes = sales.map((s) => s.tax);
  return {
    sales: sales.length,
    medianTax: round(quantile(taxes, 0.5), 10),
    lowTax: round(quantile(taxes, 0.25), 10),
    highTax: round(quantile(taxes, 0.75), 10),
    medianPrice: round(quantile(sales.map((s) => s.price), 0.5), 1000),
    taxPer100k: round(quantile(sales.map((s) => (s.tax / s.price) * 100000), 0.5), 1),
  };
}

function modeYear(sales: Sale[]): number | null {
  const counts = new Map<number, number>();
  for (const s of sales) if (s.year) counts.set(s.year, (counts.get(s.year) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const now = new Date();
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const from = addMonths(to, -12);
  const minYear = Number(from.slice(0, 4)) - 2;

  const areas: TaxArea[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of STUDY_CITIES) {
      const f = studyCityFilter(city, 3);
      const res = await client.query(
        `select coalesce(city_region,'') hood, property_sub_type st, close_price::float8 price,
                tax_annual_amount::float8 tax, nullif(raw_payload->>'TaxYear','') yr
           from raw_vow_sold
          where transaction_type = 'For Sale'
            and close_price between 100000 and 10000000
            and tax_annual_amount between 300 and 100000
            and tax_annual_amount / close_price between 0.001 and 0.03
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and ${f.sql}`,
        [from, to, ...f.params],
      );
      const sales: Sale[] = res.rows
        .map((r) => {
          const yr = Number(r.yr);
          return { hood: r.hood, type: taxHomeTypeOf(r.st), price: r.price, tax: r.tax, year: Number.isInteger(yr) && yr > 1990 && yr < 2100 ? yr : null };
        })
        // An old bill would understate today's tax; keep the last few tax years only.
        .filter((s) => s.year == null || s.year >= minYear);
      if (sales.length < MIN_CITY) {
        console.log(`${city.padEnd(14)} n=${sales.length} — not published`);
        continue;
      }
      const typed = sales.filter((s) => s.type);
      const byType = Object.fromEntries(
        TAX_HOME_TYPES.map((t) => {
          const s = typed.filter((x) => x.type === t);
          return [t, s.length >= MIN_GROUP ? stats(s) : null];
        }),
      ) as Record<TaxHomeType, TaxStats | null>;
      const communities = [...new Set(typed.map((s) => s.hood).filter(Boolean))]
        .map((h) => ({ name: h, ...stats(typed.filter((s) => s.hood === h)) }))
        .filter((h) => h.sales >= MIN_GROUP)
        .sort((a, b) => b.sales - a.sales);
      const all = stats(typed);
      const taxYear = modeYear(typed);
      areas.push({ city, slug, taxYear, all, byType, communities });
      console.log(
        `${city.padEnd(14)} n=${String(typed.length).padStart(5)} yr ${taxYear} med $${all.medianTax} (${all.lowTax}-${all.highTax}) per100k $${all.taxPer100k} | ` +
          TAX_HOME_TYPES.map((t) => `${t}:${byType[t]?.medianTax ?? "-"}`).join(" ") +
          ` | communities ${communities.length}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const file: PropertyTaxFile = { generatedAt: new Date().toISOString(), from, to, cities: areas };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
