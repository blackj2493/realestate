/**
 * Regression guard for the ETL geopoint order.
 *
 * Locks resolveLocation to [lat, lng] across all three tiers and ties the
 * WRITER (resolveLocation) to the READER (isValidLocation, the map's gate):
 * if anyone re-swaps either side, the invariant check fails.
 *
 * Run: npx tsx scripts/worker/test-resolve-location.ts
 */
import { resolveLocation, FALLBACK_LAT, FALLBACK_LNG } from "./resolveLocation";
import { isValidLocation } from "../../src/components/Map/mapLogic";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(`✗ ${name}`);
  }
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, JSON.stringify(actual) === JSON.stringify(expected));
}

console.log("\n=== resolveLocation tiers (must be [lat, lng]) ===");

// Tier 1: postal-code library
{
  const r = resolveLocation("M5V 3T6", null, null);
  const [lat, lng] = r.location;
  ok("tier1 lat is latitude (41..84)", lat >= 41 && lat <= 84);
  ok("tier1 lng is negative longitude", lng < 0 && lng >= -141);
  ok("tier1 lat≈43.6 (downtown Toronto)", Math.abs(lat - 43.65) < 0.2);
  eq("tier1 needsGeocoding", r.needsGeocoding, false);
  ok("tier1 passes map gate (writer↔reader invariant)", isValidLocation(r.location));
}

// Tier 2: API-native coordinates (postal lookup misses → uses lat/lng args)
{
  const r = resolveLocation(null, 45.0, -75.0);
  eq("tier2 returns [lat, lng] verbatim", r.location, [45.0, -75.0]);
  eq("tier2 needsGeocoding", r.needsGeocoding, false);
  ok("tier2 passes map gate", isValidLocation(r.location));
}

// Tier 3: fallback to Toronto center, flagged for correction
{
  const r = resolveLocation("ZZZ 9Z9", null, null);
  eq("tier3 fallback = [FALLBACK_LAT, FALLBACK_LNG]", r.location, [FALLBACK_LAT, FALLBACK_LNG]);
  eq("tier3 needsGeocoding", r.needsGeocoding, true);
  ok("tier3 lat first (43.65), not lng first", r.location[0] === FALLBACK_LAT && r.location[1] === FALLBACK_LNG);
}

// Direct anti-swap: a swapped [lng, lat] for the same point must FAIL the gate.
{
  const r = resolveLocation("M5V 3T6", null, null);
  const swapped: [number, number] = [r.location[1], r.location[0]];
  ok("swapped output would be rejected by map gate", isValidLocation(swapped) === false);
}

console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log(failures.join("\n"));
  process.exit(1);
}
console.log("resolveLocation order is locked to [lat, lng].");
