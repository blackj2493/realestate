/**
 * Build data/toronto-child-care.json — every licensed child care centre in Toronto with its
 * spaces by age group, plus each of the 158 neighbourhoods with its children aged 0 to 4
 * and spaces per 100 children. /api/childcare/nearby reads the file; nothing reads the
 * City at request time.
 *
 *   npx tsx scripts/data/buildTorontoChildCare.ts          # print a summary
 *   npx tsx scripts/data/buildTorontoChildCare.ts --write  # also write the JSON
 *
 * SOURCES (all City of Toronto Open Data, Open Government Licence – Toronto):
 *   - Licensed Child Care Centres (updated daily): location + spaces by age group.
 *   - Neighbourhoods (158 model): boundaries.
 *   - Neighbourhood Profiles 2021 (158 model): "0 to 4 years" population.
 * Resource URLs are looked up through the CKAN package API on every run, so a renamed
 * file does not break the build. Run weekly by refresh-child-care.yml.
 *
 * GUARDS. The build fails (and writes nothing) if the feed shrinks below MIN_CENTRES, if a
 * neighbourhood has no census count, or if centres fall outside every neighbourhood. A
 * silent partial file would show "0 centres nearby" on real listings.
 */
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { displayName, inPolygons, type ChildCareCentre, type ChildCareFile, type ChildCareNeighbourhood } from "@/lib/childcare/torontoChildCare";

const OUT = "data/toronto-child-care.json";
const WRITE = process.argv.includes("--write");
const CKAN = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=";
const MIN_CENTRES = 900; // 1,104 on 2026-11-25
/** Coordinates kept to 4 decimals (~11 m): the polygons only place a listing in a neighbourhood. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

type Geo = { type: string; coordinates: unknown };
type Feature = { properties: Record<string, unknown>; geometry: Geo };

async function resourceUrl(pkg: string, match: (name: string, format: string) => boolean): Promise<string> {
  const r = await fetch(CKAN + pkg);
  if (!r.ok) throw new Error(`CKAN ${pkg}: HTTP ${r.status}`);
  const res = ((await r.json()) as { result: { resources: { name: string; format: string; url: string }[] } }).result.resources;
  const hit = res.find((x) => match(x.name, x.format));
  if (!hit) throw new Error(`CKAN ${pkg}: no matching resource in ${res.map((x) => x.name).join(", ")}`);
  return hit.url;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** First point of a Point or MultiPoint. */
function pointOf(g: Geo): [number, number] {
  const c = g.coordinates as number[] | number[][];
  return (typeof c[0] === "number" ? c : (c as number[][])[0]) as [number, number];
}

function polygonsOf(g: Geo): [number, number][][][] {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as number[][][][];
  return polys.map((poly) =>
    poly.map((ring) => {
      const out: [number, number][] = [];
      for (const [x, y] of ring) {
        const p: [number, number] = [round4(x), round4(y)];
        const last = out[out.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
      }
      return out;
    }),
  );
}

/** Census names and boundary names differ only in spacing/punctuation ("St.James" vs "St. James"). */
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

async function main() {
  const [ccUrl, nbUrl, profUrl] = await Promise.all([
    resourceUrl("licensed-child-care-centres", (n, f) => f === "GeoJSON" && /4326/.test(n)),
    resourceUrl("neighbourhoods", (n, f) => f === "GeoJSON" && /4326/.test(n) && !/historical/i.test(n)),
    resourceUrl("neighbourhood-profiles", (n) => /2021.*158/.test(n)),
  ]);

  const cc = await getJson<{ features: Feature[] }>(ccUrl);
  const nb = await getJson<{ features: Feature[] }>(nbUrl);
  const prof = XLSX.read(Buffer.from(await (await fetch(profUrl)).arrayBuffer()));
  const sheet = XLSX.utils.sheet_to_json<(string | number)[]>(prof.Sheets[prof.SheetNames[0]], { header: 1 });
  const header = sheet[0] as string[];
  const kidsRow = sheet.find((r) => String(r[0]).trim() === "0 to 4 years");
  if (!kidsRow) throw new Error("profiles: no '0 to 4 years' row");
  const kids = new Map<string, number>();
  header.forEach((h, i) => i > 0 && kids.set(key(String(h)), Number(kidsRow[i])));

  const centres: ChildCareCentre[] = cc.features.map((f) => {
    const p = f.properties;
    const [lng, lat] = pointOf(f.geometry);
    return {
      id: Number(p.LOC_ID),
      name: displayName(String(p.LOC_NAME)),
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      infant: Number(p.IGSPACE) || 0,
      toddler: Number(p.TGSPACE) || 0,
      preschool: Number(p.PGSPACE) || 0,
      kindergarten: Number(p.KGSPACE) || 0,
      schoolAge: Number(p.SGSPACE) || 0,
      cwelcc: p.cwelcc_flag === "Y",
    };
  });
  if (centres.length < MIN_CENTRES) throw new Error(`only ${centres.length} centres (< ${MIN_CENTRES}): feed looks truncated`);
  const snapshot = String(cc.features[0]?.properties.run_date ?? ""); // e.g. "25NOV26"

  const hoods: ChildCareNeighbourhood[] = nb.features.map((f) => {
    const name = String(f.properties.AREA_NAME);
    const children = kids.get(key(name));
    if (!children) throw new Error(`no 2021 census count for neighbourhood "${name}"`);
    return { name, children, centres: 0, infant: 0, youngSpaces: 0, per100: 0, polygons: polygonsOf(f.geometry) };
  });

  let unplaced = 0;
  for (const c of centres) {
    const h = hoods.find((n) => inPolygons(c.lng, c.lat, n.polygons));
    if (!h) { unplaced++; continue; }
    h.centres++;
    h.infant += c.infant;
    h.youngSpaces += c.infant + c.toddler + c.preschool;
  }
  if (unplaced > centres.length * 0.01) throw new Error(`${unplaced} centres fell outside every neighbourhood`);
  for (const h of hoods) h.per100 = Math.round((1000 * h.youngSpaces) / h.children) / 10;

  const children = hoods.reduce((s, h) => s + h.children, 0);
  const youngSpaces = centres.reduce((s, c) => s + c.infant + c.toddler + c.preschool, 0);
  const infant = centres.reduce((s, c) => s + c.infant, 0);
  const file: ChildCareFile = {
    updated: parseRunDate(snapshot) ?? new Date().toISOString().slice(0, 10),
    source: "City of Toronto, Licensed Child Care Centres and Neighbourhood Profiles 2021 (Open Government Licence – Toronto)",
    centres,
    neighbourhoods: hoods,
    city: {
      children,
      youngSpaces,
      infant,
      per100: Math.round((1000 * youngSpaces) / children) / 10,
      infantPer100: Math.round((1000 * infant) / children) / 10,
    },
  };

  console.log(
    `${centres.length} centres, ${hoods.length} neighbourhoods, ${unplaced} unplaced. ` +
      `City: ${file.city.per100} young spaces and ${file.city.infantPer100} infant spaces per 100 children 0-4. Snapshot ${file.updated}.`,
  );
  if (WRITE) {
    writeFileSync(OUT, JSON.stringify(file) + "\n");
    console.log(`wrote ${OUT}`);
  }
}

/** "25NOV26" → "2026-11-25". */
export function parseRunDate(s: string): string | null {
  const m = /^(\d{2})([A-Z]{3})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(m[2]) + 1;
  return mon ? `20${m[3]}-${String(mon).padStart(2, "0")}-${m[1]}` : null;
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
