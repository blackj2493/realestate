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
  /** Per-source open-data licence NAME (→ geo_sources.license). Falls back to the
   *  dataset-level `license` when omitted. Set on multi-city datasets whose sources carry
   *  different licences (e.g. dev_application: Hamilton OGL vs Ottawa OGL vs Waterloo). */
  license?: string;
  /** Simplify tolerance in degrees (ArcGIS maxAllowableOffset) — keeps huge polygons
   *  under the 10 MB transfer cap; ~0.0001° ≈ 11 m, well within our postal-block precision. */
  simplifyDeg?: number;
  /** Source SRID. We always request outSR=4326, so this is 4326 for ArcGIS pulls;
   *  override for a pre-projected --file. */
  srid?: number;
  /** Per-source proximity radius (metres) for a `distance` predicate — overrides the
   *  dataset-level `predicate.meters` for THIS source only. Stamped onto each feature's
   *  attrs (`_match_radius_m`) at load; enrichGeoFlags matches within it. Use when one
   *  source needs a tighter radius than the rest (e.g. dense Toronto vs the other cities).
   *  `predicate.meters` must stay >= the largest per-source radius (it's the geoFlagsFor
   *  re-guard ceiling). */
  matchRadiusM?: number;
  /** For a POLYGON source loaded into a `point` dataset: collapse each polygon to a
   *  representative interior point (ST_PointOnSurface) at load, so e.g. York Region /
   *  Brampton development-application FOOTPRINTS become points for the distance predicate. */
  toPoint?: boolean;
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
    // Toronto-first (docs/geo-data-sources.md coverage note): HCD POLYGONS only —
    // per-property register points would misattribute at our postal-block coordinate
    // precision, districts are safe. The where-filter keeps "Under Study" areas out
    // so the flag never overstates; the TRREB SpecialDesignation payload flag still
    // covers agent-disclosed designations everywhere else.
    kind: "heritage_district",
    shortLabel: "heritage districts (Toronto)",
    family: "polygon",
    predicate: { type: "intersect" },
    enabled: true,
    autoLoad: true,
    license: "Open Government Licence – Toronto",
    sources: [
      {
        sourceKey: "toronto_hcd",
        name: "City of Toronto — Heritage Conservation Districts (City Planning)",
        endpoint:
          "https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/40",
        where: "DESIGNATION_TYPE IN ('Designated District','Under Appeal')",
        simplifyDeg: 0.0001,
      },
    ],
    flag: {
      id: "heritage_district",
      kind: "warn",
      severity: 48,
      source: "City of Toronto — Heritage Conservation Districts",
      ask: "HCD designation restricts exterior alterations and demolition — review the district plan (and any appeal status) before planning changes.",
      title: () => "Within a Toronto Heritage Conservation District",
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
    // Nearby DEVELOPMENT-APPLICATION activity — an INFO/context flag: a recent, major
    // rezoning, Official Plan amendment, subdivision or condo application within ~300 m
    // signals coming neighbourhood change (density, views, construction). Municipal open
    // data (NOT MLS/VOW), so it's not VOW-gated. Distance predicate = nearest material
    // application within the radius (the transit pattern); "info" so it's excluded from
    // the card's "checked & clear" hazard list.
    //
    // MULTI-SOURCE, like conservation_regulated: each city is one entry in sources[] with
    // its OWN `license` (→ geo_sources per source) and materiality `where`. flag.source is
    // a GENERIC label ("Municipal development applications") because a listing's flag comes
    // from whichever city's application is nearest — the enrich takes MIN(distance) across
    // all sources and doesn't track which one, exactly like conservation_regulated. That is
    // the app's established attribution pattern for a multi-source geo flag.
    //
    // ⚠️ PHASE 2 — DO NOT FORGET (explicit user directive, 2026-07-15): add a COMPANION
    // building-permit flag (kind: "major_construction") from municipal BUILDING PERMITS,
    // filtered HARD to material work only (new-build / high construction value / multi-
    // unit). Raw permits fire on nearly every block and would drown the card — that's why
    // permits are deliberately NOT in v1. See memory: dev-permit-data-availability.
    //
    // TORONTO is added as a FILE-BASED source (toronto_dev_apps below): its CKAN datastore
    // SQL API is disabled and its X/Y are MTM zone 10 NAD27 (EPSG:2019), so it's harvested to
    // GeoJSON and loaded with --srid 2019 (--all / endpoint loads skip it — see its comment).
    //
    // All launch-set cities are now wired: Hamilton/Ottawa/Waterloo (ArcGIS point), Toronto &
    // Mississauga (FILE-BASED harvesters — no stable/tabular endpoint), York Region & Brampton
    // (POLYGON → toPoint via the loader's ST_PointOnSurface option). Radius = 300 m default (the
    // floor given postal-block listing coords), overridden per-source where a city is denser
    // (Toronto/Mississauga → matchRadiusM). Two sources are file-based, so a full refresh is:
    //   loadGeoData --dataset dev_application            # ArcGIS: Hamilton/Ottawa/Waterloo/York/Brampton
    //   node harvest-toronto-dev-apps.mjs && loadGeoData … --file … --source-key toronto_dev_apps
    //   node harvest-mississauga-dev-apps.mjs && loadGeoData … --file … --source-key mississauga_dev_apps
    kind: "dev_application",
    shortLabel: "nearby development applications",
    family: "point",
    predicate: { type: "distance", meters: 300 },
    enabled: true,
    autoLoad: true,
    // Fallback only — every source below carries its own `license` (cities differ).
    license: "Municipal open data (per-source — see geo_sources)",
    sources: [
      {
        sourceKey: "hamilton_dev_apps",
        name: "City of Hamilton — Development Applications (recent, high-impact)",
        license: "City of Hamilton Open Data Licence",
        // Materiality filter, CALIBRATED 2026-07-15 against live Hamilton listings: the raw
        // 10-year feed fires on ~73% of listings (wallpaper). So keep only the high-impact
        // land-use changes — dropping the dominant Site Plan bucket (1,479 of 2,529) — and
        // restrict to the active pipeline (FILE_YEAR >= 2024). Result: ~16% of Hamilton
        // listings flagged. BUMP the year cutoff annually (or switch to a rolling window
        // once this generalizes to more cities).
        endpoint:
          "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Development_Applications/FeatureServer/2",
        where:
          "FILE_TYPE IN ('Official Plan Amendment','Zoning Amendment','Subdivision','Condominium') AND FILE_YEAR >= 2024",
      },
      {
        sourceKey: "ottawa_dev_apps",
        name: "City of Ottawa — Development Applications",
        license: "Open Government Licence – City of Ottawa",
        // High-impact types only (drop Demolition Control / Ontario Heritage Act) + active
        // pipeline. NOTE APPLICATION_TYPE_EN is padded to 25 chars → match with LIKE, not '='.
        endpoint:
          "https://maps.ottawa.ca/arcgis/rest/services/Development_Applications/MapServer/0",
        where:
          "(APPLICATION_TYPE_EN LIKE 'Official Plan Amendment%' OR APPLICATION_TYPE_EN LIKE 'Zoning By-law Amendment%' OR APPLICATION_TYPE_EN LIKE 'Plan of Subdivision%' OR APPLICATION_TYPE_EN LIKE 'Plan of Condominium%') AND APPLICATION_DATE >= DATE '2024-01-01'",
      },
      {
        sourceKey: "waterloo_dev_apps",
        name: "City of Waterloo — Major Development Files",
        license: "City of Waterloo Open Data Licence",
        // "Major Development Files" is already scoped to OPA/ZBA/subdivision/condo, so no
        // type filter is needed; keep the active pipeline (created in the last ~2 yrs).
        endpoint:
          "https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/MajorDevelopmentFiles/FeatureServer/0",
        where: "CREATE_DATE >= DATE '2024-01-01'",
      },
      {
        sourceKey: "toronto_dev_apps",
        name: "City of Toronto — Development Applications (recent, high-impact)",
        license: "Open Government Licence – Toronto",
        // FILE-BASED (no ArcGIS endpoint): Toronto's CKAN datastore SQL API is disabled and
        // X/Y are MTM zone 10 NAD27, so harvest → GeoJSON, then load with --srid 2019:
        //   node scripts/admin/harvest-toronto-dev-apps.mjs
        //   npx tsx scripts/worker/loadGeoData.ts --dataset dev_application \
        //     --file scripts/admin/dev-apps-toronto.geojson --srid 2019 --source-key toronto_dev_apps
        // (--all and the endpoint loop SKIP this source — it must be loaded via --file.)
        srid: 2019,
        // Toronto is far denser: at the shared 300 m radius it fires on ~49% of listings
        // (wallpaper). Calibrated 2026-07-16 → a 150 m radius lands ~26% (a real minority),
        // matching the other cities' discriminating band at 300 m. Building-specific condo
        // postals keep 150 m reliable downtown.
        matchRadiusM: 150,
      },
      {
        sourceKey: "york_dev_apps",
        name: "York Region — Development Applications (recent, high-impact)",
        license: "York Region Open Data Licence",
        // POLYGON footprints → toPoint. One regional layer covers all 9 York municipalities
        // (Markham/Vaughan/Richmond Hill/Aurora/Newmarket/…). Keep high-impact APPL_TYPE
        // (OPA/Zoning/Subdivision/Condominium; drop Site Plan/Consent/Minor Variance) + the
        // active pipeline (DATE_RECVD >= 2024).
        endpoint:
          "https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/DevelopmentApplicationStatusAndTeams/MapServer/0",
        where:
          "APPL_TYPE IN ('Local Official Plan Amendment','Regional Official Plan Amendment','Zoning By-law Amendment','Draft Plan of Subdivision','Registered Plan of Subdivision','Draft Plan of Condominium','Registered Plan of Condominium','Draft Vacant Land Plan of Condominium') AND DATE_RECVD >= DATE '2024-01-01'",
        simplifyDeg: 0.0002,
        toPoint: true,
      },
      {
        sourceKey: "brampton_dev_apps",
        name: "City of Brampton — OPA / Rezoning / Subdivision applications",
        license: "Creative Commons Attribution 4.0 International (CC BY 4.0) — City of Brampton",
        // POLYGON footprints → toPoint. Layer 9 "OPA ZBA Subdivision" is already the material
        // set (Official Plan Amendment + Zoning By-law Amendment + Subdivision); keep the
        // active pipeline (DATE_RECEIVED >= 2024). CC BY requires crediting "City of Brampton".
        endpoint:
          "https://services3.arcgis.com/rl7ACuZkiFsmDA2g/arcgis/rest/services/Planning_Land_Use_Development/FeatureServer/9",
        where: "DATE_RECEIVED >= DATE '2024-01-01'",
        simplifyDeg: 0.0002,
        toPoint: true,
      },
      {
        sourceKey: "mississauga_dev_apps",
        name: "City of Mississauga — Development Applications (recent, high-impact)",
        license: "City of Mississauga Terms of Use",
        // FILE-BASED: Mississauga has NO stable endpoint — its feature service is renamed
        // monthly (DevApps_June_2026_WFL1, …). The harvester resolves the CURRENT service via
        // the stable "Active Development Applications" web-map item, pulls the material point
        // layers (Approved/Rezoning/Subdivision/Condominium; drops Site Plan) → GeoJSON:
        //   node scripts/admin/harvest-mississauga-dev-apps.mjs
        //   npx tsx scripts/worker/loadGeoData.ts --dataset dev_application \
        //     --file scripts/admin/dev-apps-mississauga.geojson --source-key mississauga_dev_apps
        // (--all and the endpoint loop SKIP this source — load it via --file.)
      },
    ],
    flag: {
      id: "dev_application",
      kind: "info",
      severity: 26,
      // Generic (multi-source): the nearest match may be any of the cities above. Each
      // source's licence is recorded in geo_sources; see the multi-source note above.
      source: "Municipal development applications (open data)",
      title: (m) => `Major development application filed ~${Math.round(m)} m away`,
    },
  },
  {
    // Nearby MAJOR CONSTRUCTION — the companion to dev_application (the explicit Phase-2
    // follow-up). Where dev_application flags a PROPOSED planning change, this flags an
    // ISSUED building permit for MATERIAL work — a new build, demolition, or big addition —
    // i.e. imminent/active construction: noise, dust, changed views/traffic next door.
    //
    // Municipal open data (NOT MLS/VOW) → not VOW-gated. INFO flag (like dev_application):
    // permits are loaded for only SOME cities, so a `warn` would falsely tell every listing in
    // an unloaded city "no construction nearby (clear)". Keep it info until coverage is
    // comprehensive, then revisit warn.
    //
    // MATERIALITY (the hard part — raw permits fire on ~every block): drop the ~84% that are
    // plumbing / mechanical / interior / pool / deck / garage / sign noise; keep structure-level
    // work (new build / demolition / foundation) automatically, PLUS additions ONLY when they
    // carry a materiality signal (construction value or units added), PLUS any multi-unit
    // creation. The filter is a per-source ArcGIS `where` because each city's work-code
    // vocabulary differs. Calibrated on Waterloo (33,208 permits → 660 recent-material):
    // fire-rate 14% @100m / 25% @150m / 40% @200m → RADIUS 150 m. Permits are far DENSER than
    // development applications, so dev_application's 300 m wallpapers here (61%). BUMP the
    // ISSUE_YEAR / date cutoffs annually.
    //
    // Cities live: Waterloo + Mississauga + Kitchener (direct ArcGIS point loads, per-city `where`)
    // + Toronto (FILE-BASED: harvest-toronto-permits.mjs geocodes via Address Points — no coords &
    // redacted value in the source). NOTE Brampton's only open permit feed (Building_Permits_DEV) is
    // FROZEN at 2018 — skip until a current feed appears. Markham/Vaughan/Richmond Hill (big York
    // markets) publish NO open permits (York Region exposes dev applications only). Also LIVE:
    // Oakville + Burlington (Halton). SKIPPED: Barrie (all permits dumped in one generic type bucket
    // → no identifiable material set) + Caledon (rural/dispersed ~4% fire-rate + flaky proxied
    // endpoint). Expand by appending sources[].
    kind: "major_construction",
    shortLabel: "nearby major construction",
    family: "point",
    predicate: { type: "distance", meters: 300 }, // index superset; per-source matchRadiusM tightens
    enabled: true,
    autoLoad: true,
    license: "Municipal open data (per-source — see geo_sources)",
    sources: [
      {
        sourceKey: "waterloo_permits",
        name: "City of Waterloo — Major building permits (new build / demolition / major addition)",
        license: "City of Waterloo Open Data Licence",
        endpoint:
          "https://services.arcgis.com/ZpeBVw5o1kjit7LT/arcgis/rest/services/City_of_Waterloo_Building_Permits/FeatureServer/0",
        // Structure-level work (new / demolition / foundation on a BUILDING permit) is auto-
        // material; additions only with construction value >= $500k or >= 2 units; any >= 3-unit
        // creation. Recent (ISSUE_YEAR >= 2024) only. Reproduces the calibrated JS filter (660).
        where:
          "ISSUE_YEAR >= '2024' AND ( (WORKDESC IN ('New','Demolition','FoundationOnly') AND PERMITDESC LIKE '%Building%') OR (WORKDESC IN ('Addition','ResidentialAddition','NonResidentialAddition') AND (CONTRVALUE >= 500000 OR UNITS >= 2)) OR UNITS >= 3 )",
        matchRadiusM: 150,
      },
      {
        sourceKey: "mississauga_permits",
        name: "City of Mississauga — Major building permits (new build / demolition / major addition)",
        license: "City of Mississauga Terms of Use", // revocable-at-will — legal watch-item
        endpoint:
          "https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/Issued_Building_Permits/FeatureServer/0",
        // SCOPE new/demolition auto-material; additions only with EST_CON_VALUE >= $500k or
        // RES_UNITS >= 2; any >= 3-unit; the DEMO flag. Recent + non-revoked. Fire-rate 11.6%
        // @150m (calibrated 2026-07-17 over 15.8k Mississauga listings).
        where:
          "ISSUE_DATE >= DATE '2024-01-01' AND STATUS <> 'REVOKED' AND ( SCOPE IN ('NEW BUILDING','DEMOLITION') OR (SCOPE IN ('ADDITION AND ALTERATION','ADDITION TO EXISTING BLDG') AND (EST_CON_VALUE >= 500000 OR RES_UNITS >= 2)) OR RES_UNITS >= 3 OR DEMO = 'Y' )",
        matchRadiusM: 150,
      },
      {
        sourceKey: "kitchener_permits",
        name: "City of Kitchener — Major building permits (multi / commercial / industrial / demolition + large custom homes)",
        license: "City of Kitchener Open Data Licence",
        // Kitchener is permit-DENSE — routine new-house permits wallpaper (unfiltered fire-rate
        // 60%+). So keep multi-res / commercial / industrial / ICI / demolition automatically,
        // plus single-family houses ONLY when CONSTRUCTION_VALUE >= $1M (a big custom build, not
        // routine). Recent only. Fire-rate 25% @150m (calibrated 2026-07-17).
        endpoint:
          "https://services1.arcgis.com/qAo1OsXi67t7XgmS/arcgis/rest/services/Building_Permits/FeatureServer/0",
        where:
          "ISSUE_YEAR >= 2024 AND ( PERMIT_TYPE IN ('Residential Building (Multi)','Commercial Building','Industrial Building','Industrial/Commercial/Institutional Building Permit','Residential Demolition','Non-Residential Demolition') OR (PERMIT_TYPE IN ('Residential Building (House)','Residential Building Permit') AND CONSTRUCTION_VALUE >= 1000000) )",
        matchRadiusM: 150,
      },
      {
        sourceKey: "toronto_permits",
        name: "City of Toronto — Major building permits (new build / demolition / major addition)",
        license: "Open Government Licence – Toronto",
        // FILE-BASED (no ArcGIS endpoint): Toronto's permit feed has NO coordinates and REDACTS
        // construction value. The harvester geocodes each permit by an exact address join against
        // Toronto Address Points (~97% match) → GeoJSON (EPSG:4326); materiality is type + dwelling
        // units + gross floor area (no $value). Load via --file (the endpoint loop skips it):
        //   node scripts/admin/harvest-toronto-permits.mjs
        //   npx tsx scripts/worker/loadGeoData.ts --dataset major_construction \
        //     --file scripts/admin/permits-toronto.geojson --srid 4326 --source-key toronto_permits
        // Toronto is the DENSEST market: 150 m wallpapers (37%), so matchRadiusM 100 → ~22%
        // (calibrated 2026-07-17 over 56.8k Toronto listings; 6,073 material permits).
        srid: 4326,
        matchRadiusM: 100,
      },
      {
        sourceKey: "oakville_permits",
        name: "Town of Oakville — Major building permits (new build / demolition / major addition)",
        license: "Town of Oakville Open Data Licence",
        // Rich source (Construction_Value + Dwelling_Units_Created + GFA). Worktype new/demolition
        // auto (minus Deck / Other Secondary Structure Subtypes); additions only with value >= $500k
        // or a unit; any >= 2-unit. Recent. Fire-rate 26.5% @150m (calibrated 2026-07-17).
        endpoint:
          "https://services5.arcgis.com/QJebCdoMf4PF8fJP/arcgis/rest/services/Building_Permits/FeatureServer/0",
        where:
          "ISSUEDATE >= DATE '2024-01-01' AND Subtype NOT IN ('Deck','Other Secondary Structure') AND ( Worktype IN ('New Const.','New Construction','Demolition') OR Dwelling_Units_Created >= 2 OR (Worktype IN ('Addition','Addition to an existing building') AND (Construction_Value >= 500000 OR Dwelling_Units_Created >= 1)) )",
        matchRadiusM: 150,
      },
      {
        sourceKey: "burlington_permits",
        name: "City of Burlington — Major building permits (new build / demolition / major addition)",
        license: "City of Burlington Open Data Licence", // revocable + indemnity/flow-through — watch-item
        // WORKDESC new/addition with CONSTRUCTVALUE >= $300k (drops the $20k decks/small work),
        // demolitions, any >= 2-unit. Recent. Fire-rate 13.4% @150m (calibrated 2026-07-17).
        endpoint:
          "https://mapping.burlington.ca/arcgisweb/rest/services/COB/Permits/MapServer/1",
        where:
          "ISSUEDATE >= DATE '2024-01-01' AND ( WORKDESC = 'Demolition -Building' OR RESUNITS >= 2 OR (WORKDESC IN ('New','Addition') AND CONSTRUCTVALUE >= 300000) )",
        matchRadiusM: 150,
      },
    ],
    flag: {
      id: "major_construction",
      kind: "info",
      severity: 30,
      source: "Municipal building permits (open data)",
      ask: "Active construction nearby can mean noise, dust and changed views or traffic — check the project's scope and timeline.",
      title: (m) => `Recent major construction permit issued ~${Math.round(m)} m away`,
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
