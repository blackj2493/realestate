/**
 * Build data/basement-value.json — what a finished basement, a basement apartment and a
 * separate entrance added to house sale prices in each covered city, plus what basement
 * units rent for. /data/basement-value renders the file; nothing reads the DB at request
 * time, so the pages are static.
 *
 *   npx tsx scripts/data/buildBasementValue.ts          # print the results
 *   npx tsx scripts/data/buildBasementValue.ts --write  # also write the JSON
 *
 * Read-only: one READ ONLY transaction over raw_vow_sold. The model lives in
 * src/lib/data/basementValueModel.ts. Run monthly by refresh-basement-value.yml.
 *
 * WINDOW. Sales: the last 24 full months of contracts. Rents: the last 12 full months.
 * Freehold houses only (detached, semi, townhouse, link), $300K–$4M.
 *
 * TORONTO / OTTAWA. The feed has no single City value for either: Toronto is "Toronto C01" …
 * "Toronto W10", and Ottawa is ~51 area names (OTTAWA_AREAS). Every other city is its own
 * City value, except London (3 districts). The city list is STUDY_CITIES.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { STUDY_CITIES, studyCityFilter } from "@/lib/data/studyCities";
import {
  FIX_RE,
  RENO_RE,
  basementFlags,
  fitBasementModel,
  median,
  parseBasement,
  type SaleRow,
} from "@/lib/data/basementValueModel";
import type { BasementCity, BasementValueFile } from "@/lib/data/basementValue";

const OUT = "data/basement-value.json";
const WRITE = process.argv.includes("--write");

/** A city is published only with this many sales in each basement group. */
const MIN_GROUP = 150;
/** A rent median needs this many leases. */
const MIN_LEASES = 30;


const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const url = process.env.DATABASE_URL || process.env.DIRECT_DB_URL;
  if (!url) throw new Error("DATABASE_URL (Session pooler) is required.");
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = ymd(monthStart); // exclusive: the current, unfinished month is left out
  const saleStart = ymd(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 24, 1)));
  const rentStart = ymd(new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() - 12, 1)));

  const cities: BasementCity[] = [];
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '170s'");
    for (const { city, slug } of STUDY_CITIES) {
      const f = studyCityFilter(city, 3);
      const sales = await client.query(
        `select city, raw_payload->>'CityRegion' hood, property_sub_type t, coalesce(bedrooms_above_grade,0)::int beds,
                living_area_range band, close_price::float8 price, purchase_contract_date::text d,
                raw_payload->'Basement' bsmt, raw_payload->>'KitchensBelowGrade' kb,
                raw_payload->>'BathroomsTotalInteger' ba, raw_payload->>'ParkingTotal' park, raw_payload->>'LotWidth' lw,
                raw_payload->>'PublicRemarks' remarks
           from raw_vow_sold
          where transaction_type = 'For Sale' and close_price between 300000 and 4000000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            and property_sub_type in ('Detached','Semi-Detached','Att/Row/Townhouse','Link')
            and ${f.sql}`,
        [saleStart, end, ...f.params],
      );
      const rows: SaleRow[] = [];
      for (const r of sales.rows) {
        const baths = Number(r.ba);
        const parking = Number(r.park);
        const lotWidth = Number(r.lw);
        if (!Number.isFinite(baths) || !Number.isFinite(parking) || !Number.isFinite(lotWidth) || r.ba == null || r.park == null || r.lw == null) continue;
        const flags = basementFlags(parseBasement(r.bsmt), Number(r.kb) || 0);
        const remarks = String(r.remarks ?? "");
        rows.push({
          // The community name is per city (Toronto's districts share none), so the cell
          // carries the feed City too.
          cell: [r.city, r.hood ?? "", r.t, r.beds, r.band ?? ""].join("|"),
          price: r.price,
          date: r.d.slice(0, 10),
          ...flags,
          reno: RENO_RE.test(remarks),
          fix: FIX_RE.test(remarks),
          baths,
          parking,
          lotWidth,
        });
      }

      const fl = studyCityFilter(city, 3);
      const leases = await client.query(
        `select close_price::float8 rent, coalesce(nullif(raw_payload->>'BedroomsTotal','')::int, bedrooms_above_grade, 0) beds
           from raw_vow_sold
          where transaction_type = 'For Lease' and close_price between 800 and 6000
            and purchase_contract_date >= $1 and purchase_contract_date < $2
            -- "Bsmt"/"Basement" in the unit only. "Lower" is often a whole duplex floor:
            -- Toronto 2-bed "lower" units leased for a median $2,200 vs $1,800 for basement
            -- units (2025-11..2026-10), so including them would overstate basement rent.
            and raw_payload->>'UnparsedAddress' ~* '(bsmt|basement)'
            and ${fl.sql}`,
        [rentStart, end, ...fl.params],
      );
      const rentFor = (beds: number) => {
        const list = leases.rows.filter((l) => Number(l.beds) === beds).map((l) => Number(l.rent));
        return list.length >= MIN_LEASES ? { median: Math.round(median(list)! / 10) * 10, leases: list.length } : null;
      };

      const groups = {
        apt: rows.filter((r) => r.apt).length,
        fin: rows.filter((r) => r.fin).length,
        ref: rows.filter((r) => !r.apt && !r.fin && !r.part).length,
      };
      const enough = groups.apt >= MIN_GROUP && groups.fin >= MIN_GROUP && groups.ref >= MIN_GROUP;
      const a = enough ? fitBasementModel(rows, false) : null;
      const b = enough ? fitBasementModel(rows, true) : null;
      const medPrice = median(rows.map((r) => r.price));
      cities.push({
        city,
        slug,
        sales: rows.length,
        medianPrice: medPrice == null ? null : Math.round(medPrice / 1000) * 1000,
        groups,
        modelA: a,
        modelB: b,
        rent: { oneBed: rentFor(1), twoBed: rentFor(2) },
      });
      const e = a?.effects;
      console.log(
        `${city.padEnd(14)} n=${String(rows.length).padStart(6)} apt=${groups.apt} fin=${groups.fin} ref=${groups.ref}` +
          (e
            ? ` | fin ${e.fin.pct.toFixed(1)}% [${e.fin.lo.toFixed(1)},${e.fin.hi.toFixed(1)}] apt ${e.apt.pct.toFixed(1)}% [${e.apt.lo.toFixed(1)},${e.apt.hi.toFixed(1)}] sep ${e.sep.pct.toFixed(1)}%` +
              ` | B: fin ${b?.effects.fin.pct.toFixed(1)} apt ${b?.effects.apt.pct.toFixed(1)} bath ${b?.effects.baths.pct.toFixed(1)}`
            : " | not enough data") +
          ` | rent 1b ${rentFor(1)?.median ?? "-"} (${rentFor(1)?.leases ?? 0}) 2b ${rentFor(2)?.median ?? "-"} (${rentFor(2)?.leases ?? 0})`,
      );
    }
    await client.query("ROLLBACK");
  } finally {
    await client.end();
  }

  const file: BasementValueFile = {
    generatedAt: new Date().toISOString(),
    salesFrom: saleStart,
    salesTo: end,
    rentsFrom: rentStart,
    rentsTo: end,
    cities,
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
