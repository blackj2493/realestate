// buildTransitGeoJSON — build the `transit` point GeoJSON = GO rail stations + TTC
// subway stations, for the Phase 2 geo "Things to Know" transit flag.
//
// The data ships as shapefiles/GTFS (not ArcGIS-queryable), so this is run ad-hoc
// from a scratch dir. TTC GTFS does NOT populate location_type, so subway stations
// are derived via the route_type=1 join: routes(type=1) → trips → stop_times →
// stops, deduped to one point per station name (mean of platform coords).
//
// Setup (see docs/geo-data-sources.md), from data/_geo_src/:
//   curl -o go.zip  https://files.ontario.ca/opendata/go_train_stations_xslttransf.zip
//   unzip go.zip -d go_stations
//   npx -y mapshaper go_stations/GO_Train_Stations.shp -proj wgs84 -o format=geojson go_stations.geojson
//   curl -o ttc.zip "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7795b45e-e65a-4465-81fc-c36b9dfff169/resource/cfb6b2b8-6191-41e3-bda1-b175c51148cb/download/opendata_ttc_schedules.zip"
//   unzip ttc.zip routes.txt trips.txt stop_times.txt stops.txt -d ttc_gtfs
//   node ../../scripts/admin/buildTransitGeoJSON.cjs        # writes ../transit_stations.geojson
// Then: npx tsx scripts/worker/loadGeoData.ts --dataset transit --file data/transit_stations.geojson --srid 4326
const fs = require("fs");
const readline = require("readline");

function parseCsv(line) {
  const out = [];
  let cur = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += ch;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') q = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function readCsv(path) {
  const lines = fs.readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const c = parseCsv(lines[i]);
    const o = {};
    header.forEach((h, j) => (o[h] = c[j]));
    rows.push(o);
  }
  return rows;
}

(async () => {
  const go = JSON.parse(fs.readFileSync("go_stations.geojson", "utf8"));
  const goFeatures = go.features
    .filter((f) => f.geometry && f.geometry.type === "Point")
    .map((f) => ({ type: "Feature", properties: { name: f.properties.STA_NAM || "GO Station", kind: "GO" }, geometry: f.geometry }));

  const subwayRoutes = new Set(readCsv("ttc_gtfs/routes.txt").filter((r) => r.route_type === "1").map((r) => r.route_id));
  const subwayTrips = new Set(readCsv("ttc_gtfs/trips.txt").filter((t) => subwayRoutes.has(t.route_id)).map((t) => t.trip_id));
  console.log(`subway routes=${subwayRoutes.size} trips=${subwayTrips.size}`);

  const subwayStopIds = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream("ttc_gtfs/stop_times.txt"), crlfDelay: Infinity });
  let header = null,
    iTrip = 0,
    iStop = 3;
  for await (const line of rl) {
    if (!header) {
      header = line.split(",");
      iTrip = header.indexOf("trip_id");
      iStop = header.indexOf("stop_id");
      continue;
    }
    const c = line.split(",");
    if (subwayTrips.has(c[iTrip])) subwayStopIds.add(c[iStop]);
  }

  const byName = new Map();
  for (const s of readCsv("ttc_gtfs/stops.txt")) {
    if (!subwayStopIds.has(s.stop_id)) continue;
    const lat = parseFloat(s.stop_lat),
      lon = parseFloat(s.stop_lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = (s.stop_name || "TTC Station").replace(/\s+/g, " ").trim();
    const g = byName.get(name) || { lat: 0, lon: 0, n: 0 };
    g.lat += lat;
    g.lon += lon;
    g.n += 1;
    byName.set(name, g);
  }
  const ttcFeatures = [...byName.entries()].map(([name, g]) => ({
    type: "Feature",
    properties: { name, kind: "subway" },
    geometry: { type: "Point", coordinates: [g.lon / g.n, g.lat / g.n] },
  }));

  const merged = { type: "FeatureCollection", features: [...goFeatures, ...ttcFeatures] };
  fs.writeFileSync("../transit_stations.geojson", JSON.stringify(merged));
  console.log(`GO: ${goFeatures.length} · TTC subway: ${ttcFeatures.length} · total: ${merged.features.length}`);
})();
