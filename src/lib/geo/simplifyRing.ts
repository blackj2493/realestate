/**
 * simplifyRing — turn an arbitrary polygon ring into a Typesense-safe one.
 *
 * WHY: Typesense's `location:(…)` polygon filter 400s on self-intersecting
 * rings ("Polygon is invalid: Edge A crosses edge B"), and the terminal then
 * silently renders 0 matches. Mapbox isochrone contours are jagged, and naive
 * even-step decimation (the original /api/isochrone approach) routinely
 * CREATES crossing edges. This module simplifies with Ramer–Douglas–Peucker,
 * verifies the result is a simple ring, and falls back to the convex hull —
 * which is simple by construction — if the shape can't be untangled.
 *
 * All functions treat a ring as an OPEN vertex list (no duplicated closing
 * vertex); order ([lng,lat] vs [lat,lng]) is irrelevant to the math. Planar
 * geometry is fine at city scale.
 */

export type RingPoint = [number, number];

/** Squared perpendicular distance from `p` to the segment `a`–`b`. */
function perpDistSq(p: RingPoint, a: RingPoint, b: RingPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const ex = p[0] - a[0];
    const ey = p[1] - a[1];
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq));
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  const ex = p[0] - px;
  const ey = p[1] - py;
  return ex * ex + ey * ey;
}

/** Ramer–Douglas–Peucker over an open polyline; endpoints are always kept. */
export function rdp(points: RingPoint[], tolerance: number): RingPoint[] {
  if (points.length <= 2) return points.slice();
  const tolSq = tolerance * tolerance;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxD = -1;
    let maxI = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDistSq(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tolSq && maxI > 0) {
      keep[maxI] = true;
      stack.push([lo, maxI], [maxI, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function orient(a: RingPoint, b: RingPoint, c: RingPoint): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: RingPoint, b: RingPoint, p: RingPoint): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] &&
    p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] &&
    p[1] <= Math.max(a[1], b[1])
  );
}

/** Whether segments p1–p2 and q1–q2 intersect at any point (incl. touching). */
function segmentsIntersect(p1: RingPoint, p2: RingPoint, q1: RingPoint, q2: RingPoint): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) {
    return true;
  }
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, p2, q2)) return true;
  if (o3 === 0 && onSegment(q1, q2, p1)) return true;
  if (o4 === 0 && onSegment(q1, q2, p2)) return true;
  return false;
}

/** True when the open ring has no two non-adjacent edges that intersect. */
export function isSimpleRing(ring: RingPoint[]): boolean {
  const n = ring.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    for (let j = i + 1; j < n; j++) {
      // Adjacent edges legitimately share a vertex — skip them.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const j2 = (j + 1) % n;
      if (segmentsIntersect(ring[i], ring[i2], ring[j], ring[j2])) return false;
    }
  }
  return true;
}

/** Convex hull (Andrew's monotone chain) — an open ring, simple by construction. */
export function convexHull(points: RingPoint[]): RingPoint[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length <= 3) return pts;
  const lower: RingPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && orient(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: RingPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && orient(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Strip a duplicated closing vertex and consecutive duplicates. */
export function openRing(ring: RingPoint[]): RingPoint[] {
  const out: RingPoint[] = [];
  for (const p of ring) {
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
    out.pop();
  }
  return out;
}

/**
 * Produce a SIMPLE open ring with at most `maxVertices` vertices from a raw
 * (possibly closed, possibly self-intersecting) ring. Simplification tolerance
 * escalates until the ring is both small enough and simple; the convex hull is
 * the guaranteed fallback.
 */
export function toSimpleRing(raw: RingPoint[], maxVertices: number): RingPoint[] {
  const ring = openRing(raw);
  if (ring.length < 3) return ring;
  if (ring.length <= maxVertices && isSimpleRing(ring)) return ring;

  let tolerance = 0.0004; // ~40 m in degrees at Toronto latitudes
  for (let i = 0; i < 10; i++) {
    const simplified = openRing(rdp(ring, tolerance));
    if (simplified.length >= 3 && simplified.length <= maxVertices && isSimpleRing(simplified)) {
      return simplified;
    }
    tolerance *= 1.8;
  }
  return convexHull(ring);
}
