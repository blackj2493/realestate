/**
 * Build data/school-prices.json — what a better-scored public elementary school catchment adds
 * to house sale prices, per city, and how each catchment's houses sold against similar houses.
 * /data/school-catchment-prices renders the file statically.
 *
 *   npx tsx scripts/data/buildSchoolPrices.ts          # print the results
 *   npx tsx scripts/data/buildSchoolPrices.ts --write  # also write the JSON
 *
 * Read-only. Run monthly by refresh-school-prices.yml.
 *
 * GEOCODING. Sold records carry a postal code, not coordinates. Each sale is placed at its full
 * postal code's point (data/Ontario-postal-code-to-coordinate.txt, committed), then matched to
 * the public board's regular elementary catchment that contains it (geo_features,
 * kind='school_catchment'). Postal codes are block-level, so a house on a boundary can land on
 * the wrong side; the method reproduced the earlier geometry-based result (2026-10-20).
 *
 * MODEL. Within-cell regression (withinCellModel.ts), cell = community × type × beds × size band,
 * controls = bathrooms, parking, lot width, finished basement, basement apartment, renovation and
 * fixer-upper words, quarter. School terms: score bands against the 7–8 band, and (second fit)
 * score per point. The cell holds the community, so the gap compares houses inside one area.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { FIX_RE, RENO_RE, basementFlags, parseBasement } from "@/lib/data/basementValueModel";
import { asPct, fitWithinCell, type CellRow } from "@/lib/data/withinCellModel";
import { BASE_BAND, SCORE_BANDS, bandOf, type CatchmentRow, type Gap, type SchoolCity, type SchoolPricesFile } from "@/lib/data/schoolPricesModel";

const OUT = "data/school-prices.json";
const WRITE = process.argv.includes("--write");
const MIN_CATCHMENT = 15;

/** Covered cities with a public board's current, scored elementary catchments. */
const CITIES: { city: string; slug: string; board: string; boardCode: string; level: string | null }[] = [
  { city: "Toronto", slug: "toronto", board: "Toronto District School Board", boardCode: "TDSB", level: "junior" },
  { city: "Mississauga", slug: "mississauga", board: "Peel District School Board", boardCode: "PDSB", level: null },
  { city: "Brampton", slug: "brampton", board: "Peel District School Board", boardCode: "PDSB", level: null },
  { city: "Markham", slug: "markham", board: "York Region District School Board", boardCode: "YRDSB", level: null },
  { city: "Vaughan", slug: "vaughan", board: "York Region District School Board", boardCode: "YRDSB", level: null },
  { city: "Richmond Hill", slug: "richmond-hill", board: "York Region District School Board", boardCode: "YRDSB", level: null },
  { city: "Hamilton", slug: "hamilton", board: "Hamilton-Wentworth District School Board", boardCode: "HWDSB", level: null },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
};
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quarterOf = (d: string) => `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const halfOf = (d: string) => `${d.slice(0, 4)}H${Number(d.slice(5, 7)) <= 6 ? 1 : 2}`;
const clip = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadPostalPoints(): Map<string, [number, number]> {
  const m = new Map<string, [number, number]>();
  for (const line of readFileSync("data/Ontario-postal-code-to-coordinate.txt", "utf8").split(/\r?\n/).slice(1)) {
    const [pc, lat, lng] = line.split("\t");
    if (pc && lat && lng) m.set(pc.replace(/\s+/g, "").toUpperCase(), [Number(lng), Number(lat)]);
  }
  return m;
}

const gap = (e: { b: number; lo: number; hi: number; significant: boolean } | null): Gap | null =>
  e ? { pct: asPct(e.b), lo: asPct(e.lo), hi: asPct(e.hi), significant: e.significant } : null;

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const points = loadPostalPoints();
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const now = new Date();
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const from = addMonths(to, -24);
  const out: SchoolCity[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const c of CITIES) {
      const cityFilter = c.city === "Toronto" ? `city like 'Toronto %'` : `city = $3`;
      const res = await client.query(
        `select city, coalesce(city_region,'') hood, property_sub_type t, coalesce(bedrooms_above_grade,0)::int beds,
                living_area_range::text band, close_price::float8 price, purchase_contract_date::text d, postal_code pc,
                raw_payload->'Basement' bsmt, raw_payload->>'KitchensBelowGrade' kb, raw_payload->>'BathroomsTotalInteger' ba,
                raw_payload->>'ParkingTotal' park, raw_payload->>'LotWidth' lw, raw_payload->>'PublicRemarks' remarks
           from raw_vow_sold
          where transaction_type = 'For Sale' and close_price between 300000 and 5000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and property_sub_type in ('Detached','Semi-Detached','Att/Row/Townhouse','Link')
            and ${cityFilter}`,
        c.city === "Toronto" ? [from, to] : [from, to, c.city],
      );
      const sales = res.rows
        .map((r) => ({ r, pt: points.get(String(r.pc ?? "").replace(/\s+/g, "").toUpperCase()) }))
        .filter((x): x is { r: (typeof res.rows)[number]; pt: [number, number] } => Boolean(x.pt));

      // One spatial query: every geocoded sale against the board's regular elementary zones.
      const match = await client.query(
        `select p.i, g.attrs->>'school_name' school, (g.attrs->>'score')::float8 score
           from unnest($1::float8[], $2::float8[], $3::int[]) as p(lng, lat, i)
           join geo_features g
             on g.kind = 'school_catchment'
            and g.attrs->>'boardCode' = $4
            and g.attrs->>'panel' = 'elementary'
            and coalesce(g.attrs->>'program', 'regular') = 'regular'
            and ($5::text is null or g.attrs->>'level' = $5)
            and (g.attrs->>'score') is not null
            and ST_Intersects(g.geom, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))`,
        [sales.map((s) => s.pt[0]), sales.map((s) => s.pt[1]), sales.map((_, i) => i), c.boardCode, c.level],
      );
      const school = new Map<number, { school: string; score: number }>();
      for (const m of match.rows) if (!school.has(m.i)) school.set(m.i, { school: m.school, score: m.score });

      type S = { cell: string; mixKey: string; price: number; date: string; school: string; score: number; x: number[] };
      const rows: S[] = [];
      sales.forEach(({ r }, i) => {
        const sc = school.get(i);
        if (!sc || !r.band) return;
        const ba = Number(r.ba);
        const park = Number(r.park);
        const lw = Number(r.lw);
        if (r.ba == null || r.park == null || r.lw == null || !Number.isFinite(ba) || !Number.isFinite(park) || !Number.isFinite(lw)) return;
        const f = basementFlags(parseBasement(r.bsmt), Number(r.kb) || 0);
        const remarks = String(r.remarks ?? "");
        rows.push({
          cell: [r.city, r.hood, r.t, r.beds, r.band].join("|"),
          mixKey: [r.t, r.beds, r.band, halfOf(r.d)].join("|"),
          price: r.price,
          date: r.d.slice(0, 10),
          school: sc.school,
          score: sc.score,
          x: [clip(ba, 1, 7), clip(park, 0, 8), Math.log(clip(lw, 15, 150)), +f.fin, +f.apt, +RENO_RE.test(remarks), +FIX_RE.test(remarks)],
        });
      });
      if (rows.length < 800) {
        console.log(`${c.city.padEnd(14)} matched ${rows.length} — not published`);
        continue;
      }

      const quarters = [...new Set(rows.map((r) => quarterOf(r.date)))].sort().slice(1);
      const controls = ["baths", "parking", "lotWidth", "fin", "apt", "reno", "fix", ...quarters.map((q) => `q:${q}`)];
      const bandsOut = SCORE_BANDS.filter((b) => b !== BASE_BAND);
      const withBands: CellRow[] = rows.map((r) => ({
        cell: r.cell,
        y: Math.log(r.price),
        x: [...bandsOut.map((b) => +(bandOf(r.score) === b)), ...r.x, ...quarters.map((q) => +(quarterOf(r.date) === q))],
      }));
      const withSlope: CellRow[] = rows.map((r) => ({
        cell: r.cell,
        y: Math.log(r.price),
        x: [r.score, ...r.x, ...quarters.map((q) => +(quarterOf(r.date) === q))],
      }));
      const fb = fitWithinCell(withBands, [...bandsOut, ...controls]);
      const fs = fitWithinCell(withSlope, ["score", ...controls]);

      const bands = Object.fromEntries(
        SCORE_BANDS.map((b) => {
          const n = rows.filter((r) => bandOf(r.score) === b).length;
          if (b === BASE_BAND || !fb || n < 50) return [b, null];
          const g = gap(fb.coef[b]);
          return [b, g ? { ...g, sales: n } : null];
        }),
      ) as SchoolCity["bands"];

      // Catchment list, mix-adjusted: each sale against the city median for its type, bedrooms,
      // size band and half-year (needs 5 sales), then the catchment's median ratio.
      const mix = new Map<string, number[]>();
      for (const r of rows) mix.set(r.mixKey, [...(mix.get(r.mixKey) ?? []), r.price]);
      const mixMed = new Map([...mix].filter(([, v]) => v.length >= 5).map(([k, v]) => [k, median(v)]));
      const bySchool = new Map<string, { score: number; prices: number[]; ratios: number[] }>();
      for (const r of rows) {
        const m = mixMed.get(r.mixKey);
        const e = bySchool.get(r.school) ?? { score: r.score, prices: [], ratios: [] };
        e.prices.push(r.price);
        if (m) e.ratios.push(r.price / m);
        bySchool.set(r.school, e);
      }
      const catchments: CatchmentRow[] = [...bySchool]
        .filter(([, e]) => e.ratios.length >= MIN_CATCHMENT)
        .map(([name, e]) => ({
          school: name,
          score: Math.round(e.score * 10) / 10,
          sales: e.prices.length,
          medianPrice: Math.round(median(e.prices) / 1000) * 1000,
          vsSimilar: Math.round((median(e.ratios) - 1) * 1000) / 10,
        }))
        .sort((a, b) => b.vsSimilar - a.vsSimilar);

      const city: SchoolCity = {
        city: c.city,
        slug: c.slug,
        board: c.board,
        sales: rows.length,
        medianPrice: Math.round(median(rows.map((r) => r.price)) / 1000) * 1000,
        perPoint: gap(fs?.coef.score ?? null),
        bands,
        catchments,
      };
      out.push(city);
      const f = (g: Gap | null | undefined) => (g ? `${g.pct.toFixed(1)}%${g.significant ? "" : "~"}` : "-");
      console.log(
        `${c.city.padEnd(14)} geocoded ${sales.length}/${res.rows.length} matched ${rows.length} | per point ${f(city.perPoint)} | ` +
          SCORE_BANDS.map((b) => `${b}:${f(bands[b])}`).join(" ") +
          ` | catchments ${catchments.length}`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const file: SchoolPricesFile = { generatedAt: new Date().toISOString(), from, to, cities: out };
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file, null, 1) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
