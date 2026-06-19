// buildCostcoLocations — clean Costco warehouse locations for the "Nearest Costco"
// highlight in the listing "What's nearby" section.
//
// Source: OpenStreetMap via Overpass (© OpenStreetMap contributors, ODbL — derived
// distance is a Produced Work; attribution carried in the UI). OSM pins each Costco
// site via several POIs (warehouse, gas bar, food court, pharmacy, tire centre), so
// this clusters Costco-named POIs within ~700 m into one warehouse site.
//
// Reproduce (from repo root):
//   mkdir -p data/_geo_src
//   curl -s -A "pureproperty-geo/1.0" -X POST https://overpass-api.de/api/interpreter \
//     --data-urlencode 'data=[out:json][timeout:60];(nwr["name"~"Costco",i](42.8,-81.6,45.2,-78.0););out center;' \
//     -o data/_geo_src/costco_raw.json
//   node scripts/admin/buildCostcoLocations.cjs          # -> data/costco-locations.json
const fs = require("fs");
const path = require("path");

const RAW = path.join(process.cwd(), "data", "_geo_src", "costco_raw.json");
const OUT = path.join(process.cwd(), "data", "costco-locations.json");
const CLUSTER_M = 700; // POIs within this radius belong to the same warehouse site

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const raw = JSON.parse(fs.readFileSync(RAW, "utf-8"));
const pts = (raw.elements || [])
  .map((e) => ({
    name: (e.tags && e.tags.name) || "",
    shop: (e.tags && e.tags.shop) || "",
    city: (e.tags && (e.tags["addr:city"] || "")) || "",
    lat: e.lat ?? (e.center && e.center.lat),
    lng: e.lon ?? (e.center && e.center.lng),
  }))
  // Only true Costco POIs (drops e.g. "The Parkway at Costco"), with coords.
  .filter((p) => /^costco\b/i.test(p.name) && Number.isFinite(p.lat) && Number.isFinite(p.lng));

// Greedy cluster into warehouse sites.
const clusters = [];
for (const p of pts) {
  const c = clusters.find((cl) => haversineM(cl, p) <= CLUSTER_M);
  if (c) c.members.push(p);
  else clusters.push({ lat: p.lat, lng: p.lng, members: [p] });
}

const sites = clusters.map((cl, i) => {
  // Prefer the warehouse (shop=wholesale) point for coords + name; else cluster mean.
  const warehouse = cl.members.find((m) => m.shop === "wholesale");
  const lat = warehouse ? warehouse.lat : cl.members.reduce((s, m) => s + m.lat, 0) / cl.members.length;
  const lng = warehouse ? warehouse.lng : cl.members.reduce((s, m) => s + m.lng, 0) / cl.members.length;
  const isBusiness = cl.members.some((m) => /business/i.test(m.name));
  const city = (cl.members.find((m) => m.city) || {}).city || "";
  const name = `Costco ${isBusiness ? "Business Centre" : "Wholesale"}${city ? ` — ${city}` : ""}`;
  return { id: `costco-${i}`, name, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
});

sites.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(OUT, JSON.stringify(sites, null, 0));
console.log(`Wrote ${sites.length} Costco sites → data/costco-locations.json`);
sites.forEach((s) => console.log(`  ${s.name} (${s.lat},${s.lng})`));
