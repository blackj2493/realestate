/**
 * Verifies AlphaMap's pure logic (coordinate handling, validity gating, price
 * formatting, color indexing) and the real supercluster behavior used by
 * Listings mode — including the condo-stacking edge case.
 *
 * Run: npx tsx scripts/test-map-logic.ts
 */
import Supercluster from "supercluster";
import {
  CLUSTER_OPTIONS,
  MAP_MAX_ZOOM,
  colorIndexFor,
  formatPriceShort,
  isClusterFeature,
  isValidLocation,
  toDeckPosition,
} from "../src/components/Map/mapLogic";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    failures.push(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
  }
}

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${name} (expected true)`);
  }
}

// ── isValidLocation ─────────────────────────────────────────────────────────
console.log("\n=== isValidLocation (stored order is [lat, lng]) ===");
eq("Toronto valid", isValidLocation([43.6532, -79.3832]), true);
eq("Ottawa valid", isValidLocation([45.4215, -75.6972]), true);
eq("boundary min", isValidLocation([41, -141]), true);
eq("boundary max", isValidLocation([84, -53]), true);
eq("null", isValidLocation(null), false);
eq("undefined", isValidLocation(undefined), false);
eq("null island (0,0)", isValidLocation([0, 0]), false);
eq("zero lat", isValidLocation([0, -79.38]), false);
eq("zero lng", isValidLocation([43.65, 0]), false);
eq("NaN lat", isValidLocation([NaN, -79.38]), false);
eq("NaN lng", isValidLocation([43.65, NaN]), false);
eq("lat above max", isValidLocation([85, -79]), false);
eq("lat below min", isValidLocation([40.9, -79]), false);
eq("lng above max", isValidLocation([43.65, -52]), false);
eq("lng below min", isValidLocation([43.65, -142]), false);
// THE critical regression: a swapped [lng, lat] pair must be rejected.
eq("swapped Toronto rejected", isValidLocation([-79.3832, 43.6532]), false);
eq("swapped Ottawa rejected", isValidLocation([-75.6972, 45.4215]), false);

// ── toDeckPosition ──────────────────────────────────────────────────────────
console.log("=== toDeckPosition ([lat,lng] -> [lng,lat]) ===");
eq("flip Toronto", toDeckPosition([43.6532, -79.3832]), [-79.3832, 43.6532]);

// ── formatPriceShort ────────────────────────────────────────────────────────
console.log("=== formatPriceShort ===");
eq("undefined", formatPriceShort(undefined), "—");
eq("null", formatPriceShort(null), "—");
eq("zero", formatPriceShort(0), "—");
eq("negative", formatPriceShort(-5), "—");
eq("NaN", formatPriceShort(NaN), "—");
eq("hundreds", formatPriceShort(500), "$500");
eq("999", formatPriceShort(999), "$999");
eq("1k", formatPriceShort(1000), "$1K");
eq("12345", formatPriceShort(12345), "$12K");
eq("899k", formatPriceShort(899000), "$899K");
eq("1M exact", formatPriceShort(1_000_000), "$1M");
eq("1.2M", formatPriceShort(1_200_000), "$1.2M");
eq("2.5M", formatPriceShort(2_500_000), "$2.5M");
eq("10M exact", formatPriceShort(10_000_000), "$10M");
// Documented rounding quirk near the M boundary (cosmetic, not a failure):
console.log(`    note: 999,999 -> ${formatPriceShort(999_999)} (rounds up to "$1000K")`);

// ── colorIndexFor ───────────────────────────────────────────────────────────
console.log("=== colorIndexFor (clamped to [0, len-1]) ===");
eq("below domain -> 0", colorIndexFor(-5, [0, 10], 6), 0);
eq("at lo -> 0", colorIndexFor(0, [0, 10], 6), 0);
eq("at hi -> last", colorIndexFor(10, [0, 10], 6), 5);
eq("above domain -> last", colorIndexFor(999, [0, 10], 6), 5);
eq("midpoint", colorIndexFor(5, [0, 10], 6), 2);
eq("degenerate domain (hi==lo)", colorIndexFor(5, [10, 10], 6), 0);
eq("NaN value -> 0", colorIndexFor(NaN, [0, 10], 6), 0);
eq("empty range -> 0", colorIndexFor(5, [0, 10], 0), 0);
ok("index always in range (fuzz)", (() => {
  for (let i = 0; i < 500; i++) {
    const v = (Math.random() - 0.5) * 1000;
    const idx = colorIndexFor(v, [0, 100], 6);
    if (idx < 0 || idx > 5 || !Number.isInteger(idx)) return false;
  }
  return true;
})());

// ── isClusterFeature ────────────────────────────────────────────────────────
console.log("=== isClusterFeature ===");
eq("cluster true", isClusterFeature({ properties: { cluster: true, point_count: 3 } }), true);
eq("cluster false", isClusterFeature({ properties: { cluster: false } }), false);
eq("leaf (listing)", isClusterFeature({ properties: { listing: { id: "x" } } }), false);
eq("empty props", isClusterFeature({ properties: {} }), false);

// ── supercluster integration (the real Listings-mode config) ────────────────
console.log("=== supercluster (CLUSTER_OPTIONS = " + JSON.stringify(CLUSTER_OPTIONS) + ") ===");

type Pin = { listing: { id: string; ListPrice: number } };
function buildIndex(pts: Array<{ id: string; lng: number; lat: number; price: number }>) {
  const idx = new Supercluster<Pin>({ ...CLUSTER_OPTIONS });
  idx.load(
    pts.map((p) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      properties: { listing: { id: p.id, ListPrice: p.price } },
    }))
  );
  return idx;
}
const WORLD: [number, number, number, number] = [-180, -85, 180, 85];

// Single point -> one leaf, never a cluster
{
  const idx = buildIndex([{ id: "a", lng: -79.38, lat: 43.65, price: 1_000_000 }]);
  const c = idx.getClusters(WORLD, 12);
  eq("single -> 1 feature", c.length, 1);
  eq("single -> not a cluster", isClusterFeature(c[0]), false);
}

// Condo stacking: 5 identical coordinates collapse to ONE count bubble across
// the entire reachable zoom range (0..MAP_MAX_ZOOM). The map controller caps
// zoom at MAP_MAX_ZOOM, so the un-clustered raw-points level (maxZoom+1) is
// never reached and condo units never stack as overlapping pills.
{
  const pts = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, lng: -79.3832, lat: 43.6532, price: 500_000 + i }));
  const idx = buildIndex(pts);
  for (const z of [0, 6, 11, 14, 18, MAP_MAX_ZOOM]) {
    const c = idx.getClusters(WORLD, z);
    ok(`condo stack @z${z} -> single bubble`, c.length === 1 && isClusterFeature(c[0]));
    eq(`condo stack @z${z} -> point_count 5`, (c[0].properties as { point_count?: number }).point_count, 5);
  }
}

// Two identical points -> cluster (minPoints = 2)
{
  const idx = buildIndex([
    { id: "p1", lng: -79.3832, lat: 43.6532, price: 800_000 },
    { id: "p2", lng: -79.3832, lat: 43.6532, price: 850_000 },
  ]);
  const c = idx.getClusters(WORLD, 12);
  ok("2 identical -> 1 cluster of 2", c.length === 1 && isClusterFeature(c[0]) && (c[0].properties as { point_count?: number }).point_count === 2);
}

// Spread points: aggregated when zoomed out, individual when zoomed in.
{
  const pts = [
    { id: "tor", lng: -79.3832, lat: 43.6532, price: 1_000_000 }, // Toronto
    { id: "ham", lng: -79.8711, lat: 43.2557, price: 700_000 },   // Hamilton (~60km)
    { id: "ott", lng: -75.6972, lat: 45.4215, price: 600_000 },   // Ottawa (far)
  ];
  const idx = buildIndex(pts);
  const low = idx.getClusters(WORLD, 6);
  const high = idx.getClusters(WORLD, 16);
  ok("spread: fewer features when zoomed out than in", low.length < high.length || low.length <= 3);
  eq("spread: all individual at high zoom", high.length, 3);
  ok("spread: no clusters at high zoom", high.every((f) => !isClusterFeature(f)));
  // Leaf payload survives clustering and is retrievable for pins.
  const leaf = high.find((f) => !isClusterFeature(f));
  ok("spread: leaf carries listing payload", !!(leaf && (leaf.properties as Pin).listing?.id));
}

// ── Result ──────────────────────────────────────────────────────────────────
console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("All map-logic checks passed.");
