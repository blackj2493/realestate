/**
 * Build data/ontario-child-care.json — every active licensed child care centre in Ontario
 * OUTSIDE the City of Toronto that serves children under school age, located by postal code.
 * /api/childcare/nearby, /api/childcare/centres and the NearestChildCareKm index field read
 * the file; nothing reads the ministry at request time.
 *
 *   npx tsx scripts/data/buildOntarioChildCare.ts          # print a summary
 *   npx tsx scripts/data/buildOntarioChildCare.ts --write  # also write the JSON
 *
 * SOURCE: Ontario Ministry of Education, "Licensed child care facilities in Ontario"
 * (data.ontario.ca, Open Government Licence – Ontario), one XLSX per month named like
 * "October 2026". The newest monthly resource is picked through the CKAN package API on
 * every run. Location: data/postal-codes.json (the list has no coordinates).
 *
 * RULES. Active "Child Care Centre" rows only (home child care agencies are not a place).
 * Rows in the City of Toronto CMSM are left out: the City data (buildTorontoChildCare.ts)
 * covers Toronto with spaces by age. Centres with only before/after-school programs are
 * left out (the tool is for children under school age). fullDay = Full Day or Extended hours.
 *
 * GUARDS. The build fails (and writes nothing) below MIN_CENTRES kept centres, below
 * MIN_MATCH_RATE postal-code matches, or when the snapshot is older than MAX_AGE_DAYS.
 * Run monthly by refresh-ontario-child-care.yml.
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { buildOntarioCentres, pickLatestMonthlyResource, snapshotIso, type CkanResource, type MinistryRow } from "@/lib/childcare/ontarioBuild";
import { normalisePostal, type OntarioChildCareFile } from "@/lib/childcare/ontarioChildCare";

const OUT = "data/ontario-child-care.json";
const WRITE = process.argv.includes("--write");
const PACKAGE = "https://data.ontario.ca/api/3/action/package_show?id=licensed-child-care-facilities-in-ontario";
const MIN_CENTRES = 2500; // ~3,170 on the October 2026 file
const MIN_MATCH_RATE = 0.95; // 99.1% on the October 2026 file
const MAX_AGE_DAYS = 120;

async function main() {
  const pkg = await fetch(PACKAGE);
  if (!pkg.ok) throw new Error(`CKAN package: HTTP ${pkg.status}`);
  const resources = ((await pkg.json()) as { result: { resources: CkanResource[] } }).result.resources;
  const res = pickLatestMonthlyResource(resources);
  console.log(`Resource: ${res.name} (${res.url})`);

  const xr = await fetch(res.url);
  if (!xr.ok) throw new Error(`${res.url}: HTTP ${xr.status}`);
  const wb = XLSX.read(Buffer.from(await xr.arrayBuffer()));
  const rows = XLSX.utils.sheet_to_json<MinistryRow>(wb.Sheets[wb.SheetNames[0]], { defval: "" });

  const updated = snapshotIso(rows[0]?.["Report Snapshot Date"]);
  if (!updated) throw new Error(`unreadable Report Snapshot Date: ${String(rows[0]?.["Report Snapshot Date"])}`);
  const ageDays = Math.floor((Date.now() - Date.parse(updated)) / 86400000);
  if (ageDays > MAX_AGE_DAYS) throw new Error(`snapshot ${updated} is ${ageDays} days old (> ${MAX_AGE_DAYS})`);

  const postal = new Map<string, { lat: number; lng: number }>();
  for (const p of JSON.parse(readFileSync("data/postal-codes.json", "utf-8")) as { postalCode: string; lat: number; lng: number }[]) {
    postal.set(normalisePostal(p.postalCode), { lat: p.lat, lng: p.lng });
  }

  const { centres, stats } = buildOntarioCentres(rows, postal);
  console.log(
    `${stats.rows} rows · ${stats.active} active · ${stats.agencies} home child care agencies · ` +
      `${stats.toronto} City of Toronto (covered by the City data) · ${stats.schoolAgeOnly} before/after school only.`,
  );
  console.log(
    `${stats.candidates} candidate centres · ${stats.unmatched} postal code not found (dropped) · ` +
      `${stats.kept} kept (${(stats.matchRate * 100).toFixed(1)}% matched) · ${centres.filter((c) => c.fullDay).length} full day. Snapshot ${updated}.`,
  );

  const byCity = new Map<string, { n: number; full: number }>();
  for (const c of centres) {
    const e = byCity.get(c.city) ?? { n: 0, full: 0 };
    e.n++;
    if (c.fullDay) e.full++;
    byCity.set(c.city, e);
  }
  console.log(`\nTop cities (of ${byCity.size}):`);
  for (const [city, e] of [...byCity].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
    console.log(`  ${city.padEnd(22)} ${String(e.n).padStart(4)}  (${e.full} full day)`);
  }

  if (stats.kept < MIN_CENTRES) throw new Error(`only ${stats.kept} centres kept (< ${MIN_CENTRES}): the file looks truncated`);
  if (stats.matchRate < MIN_MATCH_RATE) {
    throw new Error(`postal match rate ${(stats.matchRate * 100).toFixed(1)}% (< ${MIN_MATCH_RATE * 100}%): check data/postal-codes.json`);
  }

  const file: OntarioChildCareFile = {
    updated,
    source: "Ontario Ministry of Education, Licensed child care facilities in Ontario (Open Government Licence – Ontario)",
    centres: centres.sort((a, b) => a.id.localeCompare(b.id)),
  };
  if (WRITE) {
    const json = JSON.stringify(file) + "\n";
    writeFileSync(OUT, json);
    console.log(`\nwrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
