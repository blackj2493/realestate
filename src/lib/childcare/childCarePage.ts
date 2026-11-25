/**
 * Facts and map geometry for /data/child-care/toronto. Every sentence on the page, in the
 * FAQ and in the Dataset JSON-LD comes from buildChildCareFacts, so they state one number.
 *
 * Data: data/toronto-child-care.json (see torontoChildCare.ts). Static page: rebuilt by the
 * deploy that the weekly refresh-child-care.yml commit triggers.
 */
import raw from "@/data/toronto-child-care.json";
import type { ChildCareFile, ChildCareNeighbourhood } from "./torontoChildCare";

export { CHILD_CARE_PATH } from "./paths";
export const CHILD_CARE_SOURCE_LINE =
  "Source: City of Toronto Open Data — Licensed Child Care Centres, Neighbourhoods (158) and Neighbourhood Profiles 2021 — Open Government Licence – Toronto. Analysis by PureProperty.";

export const getChildCareData = () => raw as unknown as ChildCareFile;

/** Map shading steps: spaces per 100 children under 5. Five steps, one hue. */
export const PER100_STEPS = [10, 20, 35, 60] as const;
export const STEP_LABELS = ["under 10", "10 to 20", "20 to 35", "35 to 60", "60 or more"] as const;
export function stepOf(per100: number): number {
  const i = PER100_STEPS.findIndex((b) => per100 < b);
  return i === -1 ? PER100_STEPS.length : i;
}

export interface ChildCareFacts {
  title: string;
  summary: string;
  facts: { id: string; text: string }[];
  faqs: { q: string; a: string }[];
  lowest: ChildCareNeighbourhood[];
  ranked: ChildCareNeighbourhood[]; // fewest spaces per child first
  under10: number;
  zeroInfant: number;
  cwelccPct: number;
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-CA");
const listNames = (xs: { name: string }[]) =>
  xs.length <= 1 ? xs.map((x) => x.name).join("") : `${xs.slice(0, -1).map((x) => x.name).join(", ")} and ${xs[xs.length - 1].name}`;

export function buildChildCareFacts(f: ChildCareFile): ChildCareFacts {
  const ranked = [...f.neighbourhoods].sort((a, b) => a.per100 - b.per100 || b.children - a.children);
  const lowest = ranked.slice(0, 10);
  const most = ranked[ranked.length - 1];
  const under10 = ranked.filter((n) => n.per100 < 10).length;
  const zeroInfant = ranked.filter((n) => n.infant === 0).length;
  const cwelcc = f.centres.filter((c) => c.cwelcc).length;
  const cwelccPct = Math.round((100 * cwelcc) / f.centres.length);
  const c = f.city;
  const median = ranked[Math.floor(ranked.length / 2)].per100;

  const title = "Toronto neighbourhoods with the fewest child care spaces per child";
  const summary =
    `Toronto has ${n0(c.youngSpaces)} licensed infant, toddler and preschool spaces for ${n0(c.children)} children under 5: ` +
    `${Math.round(c.per100)} spaces for every 100 children. In ${under10} of the 158 neighbourhoods there are fewer than 10.`;
  const facts = [
    { id: "city", text: `Across Toronto there are ${Math.round(c.per100)} licensed infant, toddler and preschool spaces for every 100 children under 5. The median neighbourhood has ${Math.round(median)}.` },
    { id: "lowest", text: `The fewest spaces per child: ${listNames(lowest.slice(0, 3).map((n) => ({ name: `${n.name} (${Math.round(n.per100)})` })))}.` },
    { id: "infant", text: `Infant care (under 18 months) is the scarcest: ${n0(c.infant)} spaces in the whole city, ${c.infantPer100.toFixed(1)} for every 100 children under 5. ${zeroInfant} neighbourhoods have no licensed infant space at all.` },
    { id: "cwelcc", text: `${cwelccPct}% of the ${n0(f.centres.length)} licensed centres are in the Canada-wide $10-a-day program.` },
    { id: "most", text: `The most spaces per child: ${most.name}, with ${Math.round(most.per100)} per 100 children. A high figure can include centres that serve parents who work in the area, not only families who live there.` },
  ];
  const faqs = [
    { q: "How many licensed child care spaces are there in Toronto?", a: `${n0(c.youngSpaces)} infant, toddler and preschool spaces in ${n0(f.centres.length)} licensed centres, for ${n0(c.children)} children under 5 (2021 Census). That is ${Math.round(c.per100)} spaces for every 100 children.` },
    { q: "Which Toronto neighbourhoods have the fewest child care spaces?", a: `By spaces per 100 children under 5: ${listNames(lowest.slice(0, 5).map((n) => ({ name: `${n.name} (${Math.round(n.per100)})` })))}.` },
    { q: "How hard is it to find infant child care in Toronto?", a: `Infant spaces are the scarcest group: ${n0(c.infant)} in the whole city, or ${c.infantPer100.toFixed(1)} per 100 children under 5. ${zeroInfant} of the 158 neighbourhoods have none.` },
    { q: "Does a licensed space mean a spot is open?", a: "No. A licensed space is the number of children a centre may care for, not a vacancy. Most centres have wait lists. Call the centre, or use the City of Toronto child care search, to ask about openings." },
  ];
  return { title, summary, facts, faqs, lowest, ranked, under10, zeroInfant, cwelccPct };
}

// ---------- map geometry ----------

type Pt = [number, number];

/** Ramer-Douglas-Peucker on one ring, tolerance in degrees. Keeps the first and last point. */
export function simplify(ring: Pt[], tol: number): Pt[] {
  if (ring.length < 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [x1, y1] = ring[a];
    const [x2, y2] = ring[b];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    let best = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // A closed ring starts and ends on the same point: there the "line" is a point, so use
      // the distance to it (the line formula would give 0 and drop every vertex).
      const d =
        len === 0
          ? Math.hypot(ring[i][0] - x1, ring[i][1] - y1)
          : Math.abs(dy * ring[i][0] - dx * ring[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > best) { best = d; idx = i; }
    }
    if (best > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

export interface MapShape {
  name: string;
  d: string;
  per100: number;
  step: number;
  children: number;
  youngSpaces: number;
  infant: number;
  centres: number;
}

/** SVG paths for all neighbourhoods, equirectangular with cos(lat) scaling, width W. */
export function mapShapes(f: ChildCareFile, W = 800, tol = 0.0004): { width: number; height: number; shapes: MapShape[] } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of f.neighbourhoods) for (const p of n.polygons) for (const [x, y] of p[0]) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const k = Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  const scale = W / ((maxX - minX) * k);
  const H = Math.round((maxY - minY) * scale);
  const X = (x: number) => ((x - minX) * k * scale).toFixed(1);
  const Y = (y: number) => ((maxY - y) * scale).toFixed(1);
  const shapes = f.neighbourhoods.map((n) => ({
    name: n.name,
    d: n.polygons
      .map((poly) => poly.map((ring) => "M" + simplify(ring, tol).map(([x, y]) => `${X(x)},${Y(y)}`).join("L") + "Z").join(""))
      .join(""),
    per100: n.per100,
    step: stepOf(n.per100),
    children: n.children,
    youngSpaces: n.youngSpaces,
    infant: n.infant,
    centres: n.centres,
  }));
  return { width: W, height: H, shapes };
}
