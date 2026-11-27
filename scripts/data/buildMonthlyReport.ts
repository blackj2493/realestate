/**
 * Build data/reports/{YYYY-MM}.json — one edition of the monthly Ontario Housing Market Report
 * (/data/reports/{YYYY-MM}). The edition is the Toronto month the script runs in; its figures
 * run to the last full month before it.
 *
 *   npx tsx scripts/data/buildMonthlyReport.ts          # print the edition
 *   npx tsx scripts/data/buildMonthlyReport.ts --write  # also write the JSON
 *
 * Read-only (one READ ONLY transaction): region_metrics (the market board) and
 * pos_monthly_stats. Also reads data/price-change.json and src/lib/data/bankForecasts.ts, so
 * run it AFTER the monthly price-change refresh and after any bank forecast update.
 *
 * MONTHLY: .github/workflows/build-monthly-report.yml runs this with --write on the 20th, which
 * writes the JSON AND registers it in EDITIONS (src/lib/data/reportEditions.ts), pushes the
 * branch report/{YYYY-MM} and sends the PR link to Telegram. The founder reads it and merges.
 * A written edition is never rebuilt: the script refuses to overwrite an existing file, so a
 * quoted figure never changes.
 * Model: src/lib/data/monthlyReport.ts.
 */
import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { boardFromRegionRows, type RegionMetricsRow } from "@/lib/data/marketBoard";
import { getPriceChangeData } from "@/lib/data/priceChange";
import { forecastRange } from "@/lib/data/bankForecasts";
import { outlookYear } from "@/lib/data/marketOutlook";
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";
import { buildReportEdition, editionFor } from "@/lib/data/monthlyReport";
import { registerEdition } from "@/lib/data/registerEdition";
import type { PosMonthRow } from "@/lib/data/posIndex";

const WRITE = process.argv.includes("--write");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await db.connect();
  let regionRows: RegionMetricsRow[];
  let posRows: PosMonthRow[];
  try {
    await db.query("BEGIN READ ONLY");
    await db.query("SET LOCAL statement_timeout = '60s'");
    const rm = await db.query("select region, payload, computed_at from region_metrics");
    regionRows = rm.rows.map((r) => ({
      region: String(r.region),
      payload: r.payload,
      computed_at: r.computed_at ? new Date(r.computed_at).toISOString() : null,
    }));
    const regions = ["ontario", ...OUTLOOK_CITIES.map((c) => c.city.toLowerCase())];
    const pm = await db.query(
      "select region, month::text as month, sales, pos_sales, pos_s2l, other_s2l from pos_monthly_stats where region = any($1) order by month",
      [regions],
    );
    posRows = pm.rows.map((r) => ({
      region: String(r.region),
      month: String(r.month),
      sales: Number(r.sales),
      pos_sales: Number(r.pos_sales),
      pos_s2l: r.pos_s2l == null ? null : Number(r.pos_s2l),
      other_s2l: r.other_s2l == null ? null : Number(r.other_s2l),
    }));
    await db.query("ROLLBACK");
  } finally {
    await db.end();
  }

  const board = boardFromRegionRows(regionRows);
  const publishedAt = new Date().toISOString();
  const edition = buildReportEdition({
    publishedAt,
    board,
    priceChange: getPriceChangeData(),
    posRows,
    forecasts: board.dataAsOf ? forecastRange(outlookYear(board.dataAsOf)) : null,
  });
  if (!edition) throw new Error("Not enough data for an edition");

  console.log(`${edition.title}  (data as of ${edition.dataAsOf}, ${edition.span})`);
  for (const f of edition.findings) console.log(`\n[${f.audience}] ${f.title}\n  ${f.text}`);
  console.log("\ncity            price      yoy%  sales  yoy%   s2l   dom  cut%  under%");
  for (const c of edition.cities) {
    console.log(
      [c.city.padEnd(14), String(c.medianPrice ?? "—").padStart(9), String(c.priceYoYPct ?? "—").padStart(6), String(c.sales3m ?? "—").padStart(6), String(c.salesYoYPct ?? "—").padStart(6), String(c.saleToAskPct ?? "—").padStart(5), String(c.medianDom ?? "—").padStart(5), String(c.cutPct ?? "—").padStart(5), String(c.underAskPct ?? "—").padStart(6)].join(" "),
    );
  }

  if (WRITE) {
    const out = `data/reports/${editionFor(publishedAt)}.json`;
    if (existsSync(out)) throw new Error(`${out} exists. A published edition is never rebuilt.`);
    mkdirSync("data/reports", { recursive: true });
    writeFileSync(out, JSON.stringify(edition, null, 1) + "\n");
    console.log(`\nWrote ${out}`);
    const editionsFile = "src/lib/data/reportEditions.ts";
    writeFileSync(editionsFile, registerEdition(readFileSync(editionsFile, "utf8"), editionFor(publishedAt)));
    console.log(`Registered ${editionFor(publishedAt)} in ${editionsFile}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
