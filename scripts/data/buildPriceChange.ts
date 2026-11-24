/**
 * Build data/price-change.json — same-home price change by city and home type: the last 12
 * full months against the 12 before, and each of the last 5 full quarters against the same
 * quarter a year earlier. /data/price-change renders the file statically.
 *
 *   npx tsx scripts/data/buildPriceChange.ts          # print the results
 *   npx tsx scripts/data/buildPriceChange.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction over raw_vow_sold). Model: src/lib/data/priceChangeModel.ts.
 * Run monthly by refresh-price-change.yml.
 *
 * SALES. "For Sale" records with a sold price of $150K–$8M, by the date the deal was signed
 * (purchase_contract_date). Toronto = every "Toronto C01…W10" City value; Ottawa = OTTAWA_AREAS.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { TYPE_GROUPS, sameHomeChange, typeGroupOf, type Change, type PricedSale, type TypeGroup } from "@/lib/data/priceChangeModel";
import type { PriceChangeArea, PriceChangeFile, QuarterChange } from "@/lib/data/priceChange";

const OUT = "data/price-change.json";
const WRITE = process.argv.includes("--write");
/** A published annual figure needs this many later-period sales inside matched cells. */
const MIN_SALES = 150;
/** A published quarterly figure needs this many. */
const MIN_Q_SALES = 60;

interface Row {
  feedCity: string;
  hood: string;
  type: TypeGroup;
  subType: string;
  beds: number;
  band: string;
  price: number;
  date: string;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};

function cityFilter(city: string): { sql: string; params: unknown[] } {
  if (city === "Toronto") return { sql: `city like 'Toronto %'`, params: [] };
  if (city === "Ottawa") return { sql: `city = any($3::text[])`, params: [OTTAWA_AREAS] };
  return { sql: `city = $3`, params: [city] };
}

const keep = (c: Change | null, min: number) => (c && c.sales >= min ? c : null);

function analyse(rows: Row[], win: { a0: string; a1: string; b1: string }, quarters: { label: string; start: string }[]): Omit<PriceChangeArea, "city" | "slug"> {
  const cellOf = (r: Row) => [r.feedCity, r.hood, r.subType, r.beds, r.band].join("|");
  const annual = (filter: (r: Row) => boolean): PricedSale[] =>
    rows
      .filter((r) => filter(r) && r.date >= win.a0 && r.date < win.b1)
      .map((r) => ({ cell: cellOf(r), price: r.price, side: r.date < win.a1 ? 0 : 1 }));

  const all = keep(sameHomeChange(annual(() => true)), MIN_SALES);
  const byType = Object.fromEntries(
    TYPE_GROUPS.map((t) => [t, keep(sameHomeChange(annual((r) => r.type === t)), MIN_SALES)]),
  ) as Record<TypeGroup, Change | null>;

  const q: QuarterChange[] = quarters.map(({ label, start }) => {
    const end = addMonths(start, 3);
    const prevStart = addMonths(start, -12);
    const prevEnd = addMonths(start, -9);
    const sales = (filter: (r: Row) => boolean): PricedSale[] =>
      rows
        .filter((r) => filter(r) && ((r.date >= prevStart && r.date < prevEnd) || (r.date >= start && r.date < end)))
        .map((r) => ({ cell: cellOf(r), price: r.price, side: r.date >= start ? 1 : 0 }));
    const isHouse = (r: Row) => r.type === "detached" || r.type === "semiTown";
    return {
      label,
      all: keep(sameHomeChange(sales(() => true), 2, 15), MIN_Q_SALES),
      house: keep(sameHomeChange(sales(isHouse), 2, 15), MIN_Q_SALES),
      condo: keep(sameHomeChange(sales((r) => !isHouse(r)), 2, 15), MIN_Q_SALES),
    };
  });

  const later = rows.filter((r) => r.date >= win.a1 && r.date < win.b1);
  const med = (t: TypeGroup) => {
    const v = later.filter((r) => r.type === t).map((r) => r.price).sort((x, y) => x - y);
    return v.length >= 50 ? Math.round(v[Math.floor(v.length / 2)] / 1000) * 1000 : null;
  };
  return {
    sales: later.length,
    all,
    byType,
    medianPrice: Object.fromEntries(TYPE_GROUPS.map((t) => [t, med(t)])) as Record<TypeGroup, number | null>,
    quarters: q,
  };
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const now = new Date();
  const b1 = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))); // exclusive end
  const a1 = addMonths(b1, -12);
  const a0 = addMonths(b1, -24);
  // The last 5 full calendar quarters before b1.
  const lastQEnd = (() => {
    const d = new Date(`${b1}T00:00:00Z`);
    return ymd(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
  })();
  const quarters = [4, 3, 2, 1, 0].map((k) => {
    const start = addMonths(lastQEnd, -3 * (k + 1));
    const m = Number(start.slice(5, 7));
    return { label: `Q${Math.floor((m - 1) / 3) + 1} ${start.slice(0, 4)}`, start };
  });
  const from = [a0, addMonths(quarters[0].start, -12)].sort()[0];

  const areas: PriceChangeArea[] = [];
  const pooled: Row[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of OUTLOOK_CITIES) {
      const f = cityFilter(city);
      const res = await client.query(
        `select city, coalesce(city_region,'') hood, property_sub_type t, coalesce(bedrooms_above_grade,0)::int beds,
                living_area_range::text band, close_price::float8 price, purchase_contract_date::text d
           from raw_vow_sold
          where transaction_type = 'For Sale' and close_price between 150000 and 8000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and property_sub_type in ('Detached','Semi-Detached','Att/Row/Townhouse','Link','Condo Apartment','Condo Townhouse')
            and ${f.sql}`,
        [from, b1, ...f.params],
      );
      const rows: Row[] = [];
      for (const r of res.rows) {
        const type = typeGroupOf(String(r.t));
        if (!type || !r.band || !r.hood) continue;
        rows.push({ feedCity: r.city, hood: r.hood, type, subType: String(r.t).trim(), beds: r.beds, band: r.band, price: r.price, date: r.d.slice(0, 10) });
      }
      pooled.push(...rows);
      const a = analyse(rows, { a0, a1, b1 }, quarters);
      areas.push({ city, slug, ...a });
      const fmt = (c: Change | null) => (c ? `${c.pct.toFixed(1)}%${c.significant ? "" : "~"}` : "-");
      console.log(
        `${city.padEnd(14)} n=${String(a.sales).padStart(6)} all ${fmt(a.all)} | det ${fmt(a.byType.detached)} st ${fmt(a.byType.semiTown)} ca ${fmt(a.byType.condoApt)} ct ${fmt(a.byType.condoTown)}` +
          ` | q ${a.quarters.map((x) => `${x.label}:${fmt(x.all)}`).join(" ")}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const ontario = analyse(pooled, { a0, a1, b1 }, quarters);
  const fmt = (c: Change | null) => (c ? `${c.pct.toFixed(1)}% [${c.lo.toFixed(1)},${c.hi.toFixed(1)}]` : "-");
  console.log(`ALL 15        n=${ontario.sales} all ${fmt(ontario.all)} | det ${fmt(ontario.byType.detached)} ca ${fmt(ontario.byType.condoApt)}`);
  console.log(`  quarters house: ${ontario.quarters.map((x) => `${x.label} ${fmt(x.house)}`).join(" | ")}`);
  console.log(`  quarters condo: ${ontario.quarters.map((x) => `${x.label} ${fmt(x.condo)}`).join(" | ")}`);

  const file: PriceChangeFile = {
    generatedAt: new Date().toISOString(),
    earlierFrom: a0,
    laterFrom: a1,
    laterTo: b1,
    ontario: { city: "Ontario", slug: "", ...ontario },
    cities: areas,
  };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
