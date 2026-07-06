/**
 * Geo "Things to Know" dataset registry — the single source of truth that drives
 * the loader (scripts/worker/loadGeoData.ts), the enrichment spatial predicates
 * (scripts/worker/enrichGeoFlags.ts), and the flag wording (geoFlags.ts).
 *
 * Adding a public-records flag = adding an entry here. Each dataset declares:
 *   - kind        : the geo_features.kind partition key
 *   - family      : geometry family (polygon | line | point) — governs how the
 *                   loader normalizes geometry
 *   - predicate   : how a listing point is tested (intersect, or within N metres)
 *   - sources[]   : one or more open-data endpoints (ArcGIS REST) or file sources
 *   - flag        : the DiligenceFlag this dataset produces (Phase-1 voice/severity)
 *
 * COMPLIANCE: every source below is PUBLIC open data licensed for commercial use
 * with attribution (mostly OGL-Ontario / OGL-Toronto / Conservation-Authority Open
 * Data Licence v1.0). Attribution is carried in DiligenceFlag.source + geo_sources.
 * Predicates are deterministic spatial SQL — no LLM (CLAUDE.md §4).
 *
 * Endpoint provenance: all endpoints were liveness-verified (geometry type, feature
 * count, CRS) before being recorded here. See docs/geo-data-sources.md.
 */

import type { DiligenceFlag } from "@/lib/property/diligence";

export type GeoGeometryFamily = "polygon" | "line" | "point";

/** intersect = point inside polygon; distance = nearest feature within `meters`. */
export type GeoPredicate = { type: "intersect" } | { type: "distance"; meters: number };

export interface GeoDatasetSource {
  /** Unique provenance key → geo_features.source_key + geo_sources.key. */
  sourceKey: string;
  name: string;
  /** ArcGIS FeatureServer/MapServer LAYER url. Omit for file-only sources (load via --file). */
  endpoint?: string;
  /** Server-side attribute filter (ArcGIS `where`). */
  where?: string;
  /** Simplify tolerance in degrees (ArcGIS maxAllowableOffset) — keeps huge polygons
   *  under the 10 MB transfer cap; ~0.0001° ≈ 11 m, well within our postal-block precision. */
  simplifyDeg?: number;
  /** Source SRID. We always request outSR=4326, so this is 4326 for ArcGIS pulls;
   *  override for a pre-projected --file. */
  srid?: number;
}

export interface GeoFlagSpec {
  id: string;
  kind: "warn" | "info";
  severity: number;
  /** Attribution shown to the user. */
  source: string;
  ask?: string;
  /** Plain-English title. `distM` is the measured distance (0 for intersect flags). */
  title: (distM: number) => string;
}

export interface GeoDataset {
  kind: string;
  family: GeoGeometryFamily;
  predicate: GeoPredicate;
  /** Human-short noun for the card's "checked & clear" list (ThingsToKnowCard). */
  shortLabel: string;
  /** Off → loader/enrichment skip it (e.g. traffic: no reliable region-wide data). */
  enabled: boolean;
  /** True when every source has an ArcGIS endpoint and `--all` can auto-load it.
   *  False = file-based (rail/transit): wire up, but load via --file after conversion. */
  autoLoad: boolean;
  license: string;
  sources: GeoDatasetSource[];
  flag: GeoFlagSpec;
}

const OGL_ON = "Open Government Licence – Ontario";
const CA_ODL = "Conservation Authority Open Data Licence v1.0";

// ── the registry ─────────────────────────────────────────────────────────────
export const GEO_DATASETS: GeoDataset[] = [
  {
    kind: "flood",
    shortLabel: "floodplain",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: "TRCA Open Data Licence v1.0",
    sources: [
      {
        sourceKey: "trca_floodplain",
        name: "TRCA Regulated Floodplain (Floodline)",
        endpoint:
          "https://services1.arcgis.com/d0ZCwU7eGKVeNiEE/arcgis/rest/services/Floodline_TRCA_Polygon/FeatureServer/1",
        simplifyDeg: 0.0001,
      },
    ],
    flag: {
      id: "flood",
      kind: "warn",
      severity: 70,
      source: "TRCA floodplain mapping",
      ask: "Confirm flood insurance availability and whether a TRCA development permit is required.",
      title: () => "Within a regulated floodplain",
    },
  },
  {
    // The 905 conservation authorities publish their broader REGULATION LIMIT
    // (floodplain + valley/wetland/erosion hazards), not a flood-only line — so we
    // label it honestly as a conservation-regulated area rather than "floodplain".
    kind: "conservation_regulated",
    shortLabel: "conservation-regulated areas",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: CA_ODL,
    sources: [
      {
        sourceKey: "cvc_regulated",
        name: "Credit Valley Conservation — Generic Regulation Limit 2025",
        endpoint:
          "https://geohub.cvc.ca/server/rest/services/Hosted/Generic_Regulations_Limit_2025/FeatureServer/0",
        simplifyDeg: 0.0001,
      },
      {
        sourceKey: "cloca_regulated",
        name: "Central Lake Ontario Conservation — Regulated Area",
        endpoint: "https://geo.cloca.com/swa/rest/services/CLOCA/OPENDATA/MapServer/15",
        simplifyDeg: 0.0001,
      },
      {
        sourceKey: "lsrca_regulated",
        name: "Lake Simcoe Region Conservation — Regulation Limit",
        endpoint: "https://gis.lsrca.on.ca/gis/rest/services/OpenData/MapServer/36",
        simplifyDeg: 0.0001,
      },
    ],
    flag: {
      id: "conservation_regulated",
      kind: "warn",
      severity: 42,
      source: "Conservation Authority regulation mapping",
      ask: "A conservation-authority development permit may be required before building or grading — confirm before you firm up.",
      title: () => "Within a conservation-regulated area",
    },
  },
  {
    kind: "wetland",
    shortLabel: "provincially significant wetlands",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: OGL_ON,
    sources: [
      {
        sourceKey: "lio_psw",
        name: "Ontario LIO — Provincially Significant Wetlands",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open01/MapServer/15",
        where: "WETLAND_SIGNIFICANCE='Evaluated-Provincial'",
        simplifyDeg: 0.0001,
      },
    ],
    flag: {
      id: "wetland",
      kind: "warn",
      severity: 55,
      source: "Ontario LIO — Provincially Significant Wetlands",
      ask: "PSW designation restricts development under the Planning Act — confirm permitted uses with the municipality.",
      title: () => "Within a Provincially Significant Wetland",
    },
  },
  {
    kind: "greenbelt",
    shortLabel: "the Greenbelt",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: OGL_ON,
    sources: [
      {
        // Designation layer (15) filtered to Protected Countryside — the core
        // development-restricted Greenbelt. The Outer Boundary (layer 17) also
        // included the Urban River Valley tentacles down the Don/Humber, which
        // falsely flagged downtown condos; ORM/Niagara designations are flagged
        // separately, so excluding them here avoids double-flagging.
        sourceKey: "lio_greenbelt",
        name: "Ontario LIO — Greenbelt Designation (Protected Countryside)",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer/15",
        where: "DESIGNATION='Protected Countryside'",
        simplifyDeg: 0.0002,
      },
    ],
    flag: {
      id: "greenbelt",
      kind: "warn",
      severity: 46,
      source: "Ontario LIO — Greenbelt Plan",
      ask: "Greenbelt policies restrict new urban development — confirm permitted uses before you plan a build.",
      title: () => "Within Ontario's Greenbelt Plan Area",
    },
  },
  {
    kind: "orm",
    shortLabel: "the Oak Ridges Moraine",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: OGL_ON,
    sources: [
      {
        sourceKey: "lio_orm",
        name: "Ontario LIO — Oak Ridges Moraine Planning Area",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer/29",
        simplifyDeg: 0.0002,
      },
    ],
    flag: {
      id: "orm",
      kind: "warn",
      severity: 44,
      source: "Ontario LIO — Oak Ridges Moraine Conservation Plan",
      ask: "ORM conservation policy constrains development — confirm the land-use designation for this parcel.",
      title: () => "Within the Oak Ridges Moraine Plan Area",
    },
  },
  {
    kind: "niagara",
    shortLabel: "the Niagara Escarpment",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: OGL_ON,
    sources: [
      {
        sourceKey: "lio_niagara",
        name: "Ontario LIO — Niagara Escarpment Plan Boundary",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open06/MapServer/25",
        simplifyDeg: 0.0002,
      },
    ],
    flag: {
      id: "niagara",
      kind: "warn",
      severity: 44,
      source: "Ontario LIO — Niagara Escarpment Plan",
      ask: "Development inside the NEP needs a Niagara Escarpment Commission permit — confirm before you commit.",
      title: () => "Within the Niagara Escarpment Plan Area",
    },
  },
  {
    kind: "hydro",
    shortLabel: "hydro corridors",
    family: "line",
    predicate: { type: "distance", meters: 150 },
    enabled: true,
    autoLoad: true,
    license: OGL_ON,
    sources: [
      {
        sourceKey: "lio_utility_line",
        name: "Ontario LIO — Utility Line (hydro / transmission)",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/11",
        where: "CLASS_SUBTYPE_NUM IN (1114,1340)", // Hydro Line + Unknown Transmission Line
      },
    ],
    flag: {
      id: "hydro",
      kind: "warn",
      severity: 34,
      source: "Ontario LIO — Utility Line",
      ask: "Check title for a Hydro right-of-way/easement; building near or under transmission corridors is restricted.",
      title: (m) => `${Math.round(m)} m from a hydro transmission corridor`,
    },
  },
  {
    kind: "rsc",
    shortLabel: "environmental site records",
    family: "point",
    predicate: { type: "distance", meters: 75 },
    // DISABLED pending written MECP license confirmation (verified 2026-06-14: no
    // open licence is asserted on the Access Environment service, and RSC is not
    // published on data.ontario.ca). Data still loads via --dataset rsc, but the
    // flag is not emitted. Re-enable once MECP confirms OGL terms, then re-run the
    // backfill. See docs/geo-data-sources.md.
    enabled: false,
    autoLoad: true,
    license: "Ontario Environmental Site Registry (confirm terms with MECP)",
    sources: [
      {
        sourceKey: "on_rsc",
        name: "Ontario Environmental Site Registry — Record of Site Condition",
        endpoint:
          "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/Access_Environment/Access_Environment_Map/MapServer/6",
      },
    ],
    flag: {
      id: "rsc",
      kind: "warn",
      severity: 38,
      source: "Ontario Environmental Site Registry",
      ask: "A filed Record of Site Condition flags a former contaminated/remediated site — review the RSC and remediation scope.",
      title: (m) => `Record of Site Condition filed within ${Math.round(m)} m`,
    },
  },
  {
    // File-based: ORWN ships as a shapefile/FGDB. Convert once to GeoJSON, then
    //   npx tsx scripts/worker/loadGeoData.ts --dataset rail --file data/orwn_track.geojson --srid 4269
    kind: "rail",
    shortLabel: "rail corridors",
    family: "line",
    predicate: { type: "distance", meters: 150 },
    enabled: true,
    autoLoad: false,
    license: OGL_ON,
    sources: [
      {
        sourceKey: "orwn_track",
        name: "Ontario Railway Network (ORWN) — Track",
        // Download: https://ws.gisetl.lrc.gov.on.ca/fmedatadownload/Packages/ORWNTRK.zip
        srid: 4269,
      },
    ],
    flag: {
      id: "rail",
      kind: "warn",
      severity: 40,
      source: "Ontario Railway Network (ORWN)",
      ask: "Check noise and vibration at peak hours before you commit.",
      title: (m) => `${Math.round(m)} m from a rail corridor`,
    },
  },
  {
    // File-based UPSIDE flag: GO rail + TTC subway station points. Convert the GO
    // shapefile / GTFS stops to GeoJSON, then load via --file.
    kind: "transit",
    shortLabel: "GO/subway proximity",
    family: "point",
    predicate: { type: "distance", meters: 1500 },
    enabled: true,
    autoLoad: false,
    license: `${OGL_ON} / OGL – Toronto`,
    sources: [
      {
        sourceKey: "rapid_transit_stations",
        name: "GO Transit rail + TTC subway/LRT stations",
        // GO: https://files.ontario.ca/opendata/go_train_stations_xslttransf.zip
        // TTC subway: derive from TTC GTFS stops.txt (location_type=1)
      },
    ],
    flag: {
      id: "transit",
      kind: "info",
      severity: 24,
      source: "GO Transit / TTC",
      title: (m) => `${Math.round(m)} m to a GO/subway station`,
    },
  },
  {
    // Deferred: no reliable region-wide open AADT (City of Toronto is single-day TMC,
    // York/Halton are paywalled). Kept here as documentation; off so it never loads.
    kind: "traffic",
    shortLabel: "busy-road exposure",
    family: "point",
    predicate: { type: "distance", meters: 120 },
    enabled: false,
    autoLoad: false,
    license: "various (patchy coverage — see docs)",
    sources: [],
    flag: {
      id: "traffic",
      kind: "warn",
      severity: 38,
      source: "Municipal traffic counts (AADT)",
      ask: "Visit at rush hour to gauge noise and access.",
      title: (m) => `Fronts a busy road (~${Math.round(m)} m to a high-volume count)`,
    },
  },
];

/** Datasets the enrichment/loader should act on (enabled only). */
export const ACTIVE_DATASETS = GEO_DATASETS.filter((d) => d.enabled);

/** Build one DiligenceFlag from a dataset + measured distance (0 for intersect). */
export function buildGeoFlag(ds: GeoDataset, distM: number): DiligenceFlag {
  const f = ds.flag;
  return {
    id: f.id,
    kind: f.kind,
    severity: f.severity,
    title: f.title(distM),
    source: f.source,
    ...(f.ask ? { ask: f.ask } : {}),
  };
}
