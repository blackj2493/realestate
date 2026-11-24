/**
 * Build data/best-time-to-sell.json — for each board city, by the month the deal was signed:
 * sales, sale-to-asking, the share sold over asking, days on market, and the price against
 * similar homes in the average month; and by the weekday the home was listed. /data/best-time-to-sell
 * renders the file statically.
 *
 *   npx tsx scripts/data/buildBestTimeToSell.ts          # print the results
 *   npx tsx scripts/data/buildBestTimeToSell.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction over raw_vow_sold). Run monthly by refresh-best-time-to-sell.yml.
 *
 * WINDOW. The last 24 full months, so every calendar month is counted exactly twice (see
 * seasonality.ts for why an uneven window misleads).
 *
 * PRICE. A raw median by month mixes the season with the year's trend and with which homes sell
 * when. The model compares similar homes (community × type × bedrooms × size band, the
 * within-cell method of withinCellModel.ts) with month dummies and a quadratic time trend, so a
 * month's figure is the season alone. Seeded cluster bootstrap, 95% ranges.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { OTTAWA_AREAS } from "@/lib/dashboard/ottawaAreas";
import { median } from "@/lib/data/basementValueModel";
import { fitWithinCell, type CellRow } from "@/lib/data/withinCellModel";
import { monthEffects, type BestTimeFile, type MonthStats, type SellCity, type WeekdayStats } from "@/lib/data/bestTimeToSellModel";

const OUT = "data/best-time-to-sell.json";
const WRITE = process.argv.includes("--write");
/** Every calendar month needs this many sales (over 2 years) for the city to be shown. */
const MIN_MONTH = 60;
/** A weekday row needs this many sales. */
const MIN_DAY = 100;

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const r1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);

interface Sale {
  cell: string;
  month: number;
  /** Months since the window start, plus the fraction of the month. */
  t: number;
  weekday: number | null;
  price: number;
  ratio: number | null;
  dom: number | null;
}

function cityFilter(city: string): { sql: string; params: unknown[] } {
  if (city === "Toronto") return { sql: `city like 'Toronto %'`, params: [] };
  if (city === "Ottawa") return { sql: `city = any($3::text[])`, params: [OTTAWA_AREAS] };
  return { sql: `city = $3`, params: [city] };
}

function ratioStats(s: Sale[]) {
  const ratios = s.filter((x) => x.ratio != null).map((x) => x.ratio!);
  const doms = s.filter((x) => x.dom != null).map((x) => x.dom!);
  const r = median(ratios);
  const d = median(doms);
  return {
    saleToAsk: r == null ? null : Math.round(r * 1000) / 10,
    overAskShare: ratios.length ? Math.round((ratios.filter((x) => x > 1.0001).length / ratios.length) * 100) : null,
    medianDom: d == null ? null : Math.round(d),
  };
}

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const now = new Date();
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const from = addMonths(to, -24);
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const out: SellCity[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of OUTLOOK_CITIES) {
      const f = cityFilter(city);
      const res = await client.query(
        `select coalesce(city_region,'') hood, property_sub_type t, coalesce(bedrooms_above_grade,0)::int beds,
                coalesce(living_area_range::text,'') band, close_price::float8 price, list_price::float8 lp,
                days_on_market dom, purchase_contract_date::text d, listing_contract_date::text ld
           from raw_vow_sold
          where transaction_type = 'For Sale' and close_price between 150000 and 8000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and property_sub_type in ('Detached','Semi-Detached','Att/Row/Townhouse','Link','Condo Apartment','Condo Townhouse')
            and ${f.sql}`,
        [from, to, ...f.params],
      );
      const sales: Sale[] = res.rows.map((r) => {
        const lp = Number(r.lp);
        const dom = Number(r.dom);
        const d = new Date(`${r.d.slice(0, 10)}T00:00:00Z`);
        const ld = r.ld ? new Date(`${String(r.ld).slice(0, 10)}T00:00:00Z`) : null;
        return {
          cell: [r.hood, r.t, r.beds, r.band].join("|"),
          month: d.getUTCMonth() + 1,
          t: (d.getTime() - start) / (30.44 * 86_400_000),
          weekday: ld && !Number.isNaN(ld.getTime()) ? ld.getUTCDay() : null,
          price: r.price,
          ratio: lp > 0 && r.price / lp > 0.7 && r.price / lp < 1.5 ? r.price / lp : null,
          dom: Number.isFinite(dom) && dom >= 0 && dom < 1000 ? dom : null,
        };
      });
      const perMonth = Array.from({ length: 12 }, (_, i) => sales.filter((s) => s.month === i + 1));
      if (perMonth.some((m) => m.length < MIN_MONTH)) {
        console.log(`${city.padEnd(14)} skipped: a month below ${MIN_MONTH} sales`);
        continue;
      }

      // Month dummies (Feb..Dec against Jan) + quadratic trend, within similar homes.
      const tMid = 12;
      const rows: CellRow[] = sales.map((s) => ({
        cell: s.cell,
        y: Math.log(s.price),
        x: [...Array.from({ length: 11 }, (_, i) => +(s.month === i + 2)), (s.t - tMid) / 12, ((s.t - tMid) / 12) ** 2],
      }));
      const monthTerms = Array.from({ length: 11 }, (_, i) => `m${i + 2}`);
      const fit = fitWithinCell(rows, [...monthTerms, "trend", "trend2"], { keepDraws: true, boot: 300, seed: 7 });
      const effects = fit ? monthEffects(fit, monthTerms) : null;

      const months: MonthStats[] = perMonth.map((s, i) => {
        const e = effects?.[i] ?? null;
        return {
          month: i + 1,
          sales: s.length,
          ...ratioStats(s),
          price: e ? { pct: r1(e.pct)!, lo: r1(e.lo)!, hi: r1(e.hi)!, significant: e.significant } : null,
        };
      });
      const weekdays: WeekdayStats[] = Array.from({ length: 7 }, (_, day) => {
        const s = sales.filter((x) => x.weekday === day);
        const st = ratioStats(s);
        return { day, sales: s.length, overAskShare: st.overAskShare, medianDom: st.medianDom };
      }).filter((w) => w.sales >= MIN_DAY);

      out.push({ city, slug, sales: sales.length, months, weekdays });
      console.log(
        `${city.padEnd(14)} n=${String(sales.length).padStart(6)} fit=${fit ? `${fit.n}/${fit.cells}` : "none"} | ` +
          months.map((m) => `${m.month}:${m.overAskShare}%/${m.medianDom}d/${m.price ? `${m.price.pct > 0 ? "+" : ""}${m.price.pct}${m.price.significant ? "*" : ""}` : "-"}`).join(" "),
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }
  const file: BestTimeFile = { generatedAt: new Date().toISOString(), from, to, cities: out };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
