/**
 * Command Center — persona-driven 100vh investor terminal.
 * Left: deck.gl 3D map (yield-colored). Right: property ledger.
 * Queries Typesense exclusively (CLAUDE.md §3B), capped at 100 listings (§4).
 */

"use client";

import React, { useEffect, useCallback, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2, List, Map as MapIcon } from "lucide-react";

import {
  TopCommandBar,
  LedgerPanel,
  MapControlRail,
  MapDrawer,
  MapModeDock,
  MapStatusHUD,
  MapTimeline,
  MapCommandPalette,
  MobileMapTools,
  ActiveLensBar,
} from "@/components/CommandCenter";
import QuickLookPanel from "@/components/CommandCenter/QuickLookPanel";
import SaveBubbleButton from "@/components/CommandCenter/SaveBubbleButton";
import VowGateOverlay from "@/components/auth/VowGateOverlay";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useOpenListing } from "@/hooks/useOpenListing";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { getMapMetric, bandFilterClause } from "@/lib/personas/mapMetrics";
import { searchListings } from "@/lib/typesense/client";
import type { ListingDocument, SearchResult } from "@/lib/typesense/client";
import { FACET_FIELDS, readStepper } from "@/lib/filters/filterRegistry";
import { isInvestorLayerActive, priceConfig } from "@/lib/filters/fundamentals";
import { buildTerminalCoreClauses } from "@/lib/filters/terminalQuery";
import { schoolScoreField, schoolMapColor } from "@/lib/schools/schoolLens";
import { useCommuteIsochrone } from "@/hooks/useCommuteIsochrone";
import { useBubbleHydration } from "@/hooks/useBubbleHydration";
import { boundsAroundPoint, fetchSoldComps } from "@/lib/sold/fetchSoldComps";
import { queryPlan } from "@/lib/sold/layers";
import { mergeLayers } from "@/lib/sold/mergeLayers";
import { PROPERTY_TYPE_OPTIONS } from "@/lib/dashboard/propertyTypes";
import { paramsToChips, hasStructuredParams } from "@/lib/search/chipUrl";
import { syncChips } from "@/lib/search/chipApply";
import { getConfig } from "@/lib/dashboard/config";
import { hydrateTerminalPersona } from "@/lib/personas/personaStore";

/**
 * Reverse map: raw PropertySubType spelling → dashboard key used by the sold route.
 * Built from PROPERTY_TYPE_OPTIONS.variants so it stays in sync with one source.
 * Used to convert universalFilters.homeType (raw spellings from RESIDENTIAL_TYPE_OPTIONS)
 * into the dashboard keys that variantsForKeys() in the sold route understands.
 */
const SUBTYPE_TO_DASHBOARD_KEY: ReadonlyMap<string, string> = new Map(
  PROPERTY_TYPE_OPTIONS.flatMap((opt) => opt.variants.map((v) => [v, opt.key] as [string, string]))
);

// deck.gl + mapbox must load client-only
const AlphaMap = dynamic(() => import("@/components/Map/AlphaMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
    </div>
  ),
});

// Compliance: never retrieve/render more than 100 listings per UI query.
const MAX_LISTINGS = 100;
// Neutral sort for the basic-browse modes (rent / commercial), where the persona
// metric sorts (cap rate, yield) don't apply.
const BASIC_SORT = "ListPrice";

// Heavy fields the terminal map/ledger never RENDER — trimmed from the bulk query so each
// search stays light. Audited 2026-06 against every terminal consumer (map color, ledger
// columns, deal score, persona ranking, AlphaBadge, comps anchor, Quick Look): the school
// SCORE fields ARE used (kept), but school NAMES/distances, NearbySchools (filter-only,
// applied server-side), PropertyHash, and amenity NAMES are not. RawImages/RawRooms are
// detail/compare-only. This is the superset of searchListings' default (RawImages,RawRooms)
// and is passed ONLY here — other callers (SEO school pages, detail, compare) keep the
// conservative default so nothing they display is trimmed.
const TERMINAL_EXCLUDE_FIELDS = [
  "RawImages",
  "RawRooms",
  "NearbySchools",
  "ElemPublicSchool",
  "ElemPublicDistanceKm",
  "ElemCatholicSchool",
  "ElemCatholicDistanceKm",
  "SecPublicSchool",
  "SecPublicDistanceKm",
  "SecCatholicSchool",
  "SecCatholicDistanceKm",
  "PropertyHash",
  "NearestGroceryName",
  "NearestRecCentreName",
].join(",");

function CommandCenterContent() {
  const searchParams = useSearchParams();
  const {
    activePersona,
    setActivePersona,
    filters,
    universalFilters,
    searchResult,
    setSearchResult,
    setIsLoading,
    setError,
    setTotalCount,
    location,
    setLocation,
    selectedProperty,
    setIsTerminalOpen,
    commute,
    school,
    amenity,
    mapBounds,
    setMapBounds,
    selectedIds,
    showSelectedOnly,
    totalCount,
    setMapMode,
    colorMetricId,
    colorBand,
    drawPolygon,
    transactionMode,
    propertyClass,
    activeLayers,
    soldWindowDays,
    setSoldLocked,
    soldLocked,
    setSoldCount,
    searchPin,
    exitComps,
    setUniversalFilter,
    setFilter,
    setSchool,
    addFilter,
    removeAddedFilter,
    setFlyTo,
    setSearchPin,
  } = useCommandCenterStore();

  // Property-open routing: mobile (≤767) → full report; desktop → Quick Look drawer.
  const openListing = useOpenListing();
  const isMobile = useIsMobile(767);

  // Fetch the commute isochrone polygon when destination/mode/minutes change.
  useCommuteIsochrone();

  // If the user landed via /properties?bubble=<id>, restore that saved state.
  useBubbleHydration();

  // Drag-resizable ledger width (persisted). Map fills the remaining space.
  const LEDGER_MIN = 400;
  const LEDGER_MAX = 1000;
  const [ledgerWidth, setLedgerWidth] = useState(620);
  useEffect(() => {
    const saved = Number(localStorage.getItem("ledgerWidth"));
    if (saved >= LEDGER_MIN && saved <= LEDGER_MAX) setLedgerWidth(saved);
  }, []);
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) =>
      setLedgerWidth(Math.min(LEDGER_MAX, Math.max(LEDGER_MIN, window.innerWidth - ev.clientX)));
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setLedgerWidth((w) => {
        localStorage.setItem("ledgerWidth", String(Math.round(w)));
        return w;
      });
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  // Seed location from URL (?city= / ?search=)
  useEffect(() => {
    const cityParam = searchParams.get("city") || searchParams.get("search") || "";
    if (cityParam && cityParam !== location) setLocation(cityParam);
  }, [searchParams, location, setLocation]);

  // Persona unification (fix #6): open the terminal on the ONE shared lens instead of
  // a private in-memory state that always cold-started on Flippers. Resolve once on
  // mount — explicit ?lens= > the persona saved in the dashboard config (or adopted
  // from the account) > the Homebuyer default — and let setActivePersona write any
  // change back through so the terminal, dashboard and listing pages stay in sync.
  const personaHydratedRef = useRef(false);
  useEffect(() => {
    if (personaHydratedRef.current) return;
    personaHydratedRef.current = true;
    void hydrateTerminalPersona(searchParams.get("lens"), setActivePersona);
  }, [searchParams, setActivePersona]);

  // Center deep link (?lat=&lng=[&z=][&pin=]) — e.g. the address-profile "open the
  // map here" link. Rides the flyTo path (which also reports the framed viewport,
  // so results render with no manual pan) and drops the search pin so the subject
  // address is visible among the listings. Deliberately carries NO ?city=: bounds
  // scope the query, so feed-vs-geocoder naming (Nepean vs Barrhaven) can't hide
  // nearby inventory. Guarded to fire once per distinct center.
  const centeredRef = useRef<string | null>(null);
  useEffect(() => {
    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return;
    const key = `${lat},${lng},${searchParams.get("z") ?? ""},${searchParams.get("pin") ?? ""}`;
    if (centeredRef.current === key) return;
    centeredRef.current = key;
    const zRaw = Number(searchParams.get("z"));
    const zoom = Number.isFinite(zRaw) ? Math.min(18, Math.max(8, zRaw)) : 14;
    setFlyTo({ lat, lng, zoom });
    const label = (searchParams.get("pin") ?? "").trim();
    if (label) setSearchPin({ lat, lng, label });
  }, [searchParams, setFlyTo, setSearchPin]);

  // Hydrate the FULL filter set from a deep link (?beds=&maxPrice=&type=…). A search
  // typed anywhere — the global header on any app page — serializes its parsed chips
  // into the URL (chipUrl); here we reconstruct those chips and run the SAME applier
  // the terminal's own NL bar uses (syncChips), so a deep link yields byte-identical
  // state to typing the query in place. Plain `?city=` links carry no structured key,
  // so the seed effect above handles them and this no-ops. Guarded to hydrate once per
  // distinct param string (re-navigating with new params re-hydrates; renders don't).
  const hydratedParamsRef = useRef<string | null>(null);
  useEffect(() => {
    const key = searchParams.toString();
    if (hydratedParamsRef.current === key) return;
    if (!hasStructuredParams(searchParams)) return;
    hydratedParamsRef.current = key;
    syncChips(paramsToChips(searchParams), {
      setUniversalFilter,
      setFilter,
      setLocation,
      setSchool,
      addFilter,
      removeAddedFilter,
      priceBounds: priceConfig(transactionMode),
    });
  }, [
    searchParams,
    setUniversalFilter,
    setFilter,
    setLocation,
    setSchool,
    addFilter,
    removeAddedFilter,
    transactionMode,
  ]);

  const persona = PERSONA_CONFIG[activePersona];

  // First-load scope detector (fix #4). A "bare cold start" has none of: a typed/
  // seeded place, a draw area, an active commute zone, a dropped pin, or a deep-link
  // center/city/filter. Everything else is a form of explicit scope that keeps its
  // existing behavior. ONLY the bare case holds the first query for the map's
  // viewport box (see performSearch + the AlphaMap scopeToViewport prop) so the list
  // matches the map instead of spilling province-wide.
  const latParam = Number(searchParams.get("lat"));
  const lngParam = Number(searchParams.get("lng"));
  const hasCenterParam =
    Number.isFinite(latParam) &&
    Number.isFinite(lngParam) &&
    Math.abs(latParam) <= 90 &&
    Math.abs(lngParam) <= 180 &&
    !(latParam === 0 && lngParam === 0);
  const hasCityParam = Boolean(searchParams.get("city") || searchParams.get("search"));
  const wantViewportScope =
    !location &&
    !drawPolygon &&
    !commute.enabled &&
    !searchPin &&
    !hasCenterParam &&
    !hasCityParam &&
    !hasStructuredParams(searchParams);

  // Signed-in initial viewport (fix #4): with no URL scope and no typed place, open
  // the terminal on the user's first saved market (dashboard config in localStorage)
  // instead of the generic Toronto default. Seeding `location` reuses the existing
  // place-query + auto-fit path (the cheapest reliable, fully-synchronous variant);
  // a saved-bubble-geometry fly-to is a noted follow-up. Runs once, and only while
  // the terminal is still bare (a URL place/center/filter owns the scope instead).
  const savedMarketSeededRef = useRef(false);
  useEffect(() => {
    if (savedMarketSeededRef.current) return;
    if (location || hasCityParam || hasCenterParam || hasStructuredParams(searchParams)) return;
    savedMarketSeededRef.current = true;
    const savedRegions = getConfig().regions;
    if (savedRegions.length > 0) setLocation(savedRegions[0]);
  }, [location, hasCityParam, hasCenterParam, searchParams, setLocation]);

  // Switching persona drops the map into that persona's default render mode
  // (e.g. Cashflow/Builders → Heatmap). The user can re-toggle freely after.
  useEffect(() => {
    setMapMode(PERSONA_CONFIG[activePersona].defaultMapMode);
  }, [activePersona, setMapMode]);

  // Runs the public-Typesense active-listings query (For Sale / For Rent) and
  // RETURNS the result — all the commute/school/draw/band/sort logic lives here,
  // but it never touches state, so the fan-out below can run it in parallel.
  const runActiveSearch = useCallback(async (): Promise<SearchResult> => {
    const investorLayer = isInvestorLayerActive(transactionMode, propertyClass);
    const coreClauses = buildTerminalCoreClauses({ transactionMode, propertyClass, universalFilters, filters });
    const schoolField = school.enabled ? schoolScoreField(school.level, school.system) : null;
    const schoolParts: string[] = [];
    if (schoolField && school.minScore > 0) schoolParts.push(`${schoolField}:>=${school.minScore}`);
    if (school.enabled && school.targetSchool) schoolParts.push(`NearbySchools:=\`${school.targetSchool.id}\``);
    // Walkability: nearest grocery / recreation within maxKm. "either" = OR across both.
    const amenityParts: string[] = [];
    if (amenity.enabled) {
      const g = `NearestGroceryKm:<=${amenity.maxKm}`;
      const r = `NearestRecCentreKm:<=${amenity.maxKm}`;
      if (amenity.kind === "grocery") amenityParts.push(g);
      else if (amenity.kind === "recreation") amenityParts.push(r);
      else amenityParts.push(`(${g} || ${r})`);
    }
    const bandDef = colorBand ? getMapMetric(colorBand.metricId) : null;
    const bandClause = bandDef ? bandFilterClause(bandDef, colorBand!.index) : null;
    const drawClause =
      drawPolygon && drawPolygon.length >= 3
        ? `location:(${drawPolygon.map(([lng, lat]) => `${lat}, ${lng}`).join(", ")})`
        : null;
    const rawFilterBy = [...coreClauses, ...schoolParts, ...amenityParts, bandClause, drawClause].filter(Boolean).join(" && ");
    const geoPolygon =
      commute.enabled && commute.polygon && commute.polygon.length >= 3
        ? commute.polygon.map(([lng, lat]) => [lat, lng] as [number, number])
        : undefined;
    // Lens-aware default sort (fix #4): the Homebuyer lens leads with FRESHNESS
    // (newest listed first, EntryTimestamp desc); the investor lenses keep their
    // deal-signal sort (cap rate / True DOM / lot width). The School lens still
    // overrides both, and the basic browse modes (rent / commercial) stay on price.
    const lensSort = activePersona === "smart" ? "EntryTimestamp" : persona.sortBy;
    return await searchListings({
      query: location || "*",
      rawFilterBy,
      geoPolygon,
      filters: mapBounds ? { boundingBox: mapBounds } : undefined,
      perPage: MAX_LISTINGS,
      facetBy: FACET_FIELDS.join(","),
      excludeFields: TERMINAL_EXCLUDE_FIELDS,
      sortBy: schoolField ?? (investorLayer ? lensSort : BASIC_SORT),
      sortOrder: "desc",
    });
  }, [activePersona, transactionMode, propertyClass, universalFilters, filters, persona, school.enabled, school.level, school.system, school.minScore, school.targetSchool, amenity.enabled, amenity.kind, amenity.maxKm, colorBand, drawPolygon, commute.enabled, commute.polygon, location, mapBounds]);

  const performSearch = useCallback(async () => {
    // First-load viewport hold (fix #4): on a bare cold start with no explicit
    // scope, do NOT fire the province-wide unbounded query. Keep the skeleton up and
    // wait for AlphaMap to report its settled viewport (setMapBounds) — that flips
    // mapBounds (a dep here) and re-runs this with a bounding box, so the very first
    // result set matches the map. Any explicit scope (place / filter / draw / pin /
    // deep-link) makes wantViewportScope false and this branch never trips.
    if (wantViewportScope && !mapBounds) {
      setIsLoading(true);
      return;
    }
    setIsLoading(true);
    setError(null);
    const plan = queryPlan(activeLayers);
    try {
      // Derive basic filters for comp layers from universalFilters — mirrors how
      // buildTerminalCoreClauses extracts beds/baths/homeType for the active query.
      // Persona/investor analytics filters are intentionally excluded (comps have no
      // forward metrics like cap rate or yield).
      // Beds/Baths are stepper values ({ n, exact } once the popover is touched,
      // a bare number otherwise) — readStepper normalizes both, exactly like
      // buildTerminalCoreClauses does for the active query. Reading them as raw
      // numbers silently dropped the filter on comps (the object failed `> 0`).
      const beds = readStepper(universalFilters.beds ?? 0);
      const baths = readStepper(universalFilters.baths ?? 0);
      const homeTypeRaw = (universalFilters.homeType as string[] | undefined) ?? [];
      // Map raw PropertySubType spellings → dashboard keys the sold route accepts.
      // variantsForKeys() in the route uses these keys to expand back to all spellings.
      const mappedKeys = homeTypeRaw
        .map((spelling) => SUBTYPE_TO_DASHBOARD_KEY.get(spelling))
        .filter((k): k is string => k !== undefined);
      const compFilters: {
        minPrice?: number; maxPrice?: number;
        minBeds?: number; bedsExact?: boolean;
        minBaths?: number; bathsExact?: boolean;
        types?: string[];
      } = {};
      // Price band: only send a bound when it deviates from the slider's full range
      // (transaction-scoped, same config the active query uses) so default = no clause.
      const priceVal = universalFilters.price as [number, number] | undefined;
      if (priceVal) {
        const { min: pMin, max: pMax } = priceConfig(transactionMode);
        if (priceVal[0] > pMin) compFilters.minPrice = priceVal[0];
        if (priceVal[1] < pMax) compFilters.maxPrice = priceVal[1];
      }
      if (beds.n > 0) {
        compFilters.minBeds = beds.n;
        if (beds.exact) compFilters.bedsExact = true;
      }
      if (baths.n > 0) {
        compFilters.minBaths = baths.n;
        if (baths.exact) compFilters.bathsExact = true;
      }
      if (mappedKeys.length > 0) compFilters.types = [...new Set(mappedKeys)];

      // Comps-on-demand: when a subject anchor is set (the address you clicked "Comps"
      // on), define comps by the SUBJECT — same property type + a ±30% price band — not
      // by the terminal filters. This turns "every recent sold in view" into genuine
      // comparables: a 3-bed townhouse shows townhouses, not condos & mansions.
      if (searchPin?.comps) {
        compFilters.minBeds = undefined;
        compFilters.bedsExact = undefined;
        compFilters.minBaths = undefined;
        compFilters.bathsExact = undefined;
        compFilters.types = searchPin.types?.length ? searchPin.types : undefined;
        compFilters.minPrice = searchPin.minPrice || undefined;
        compFilters.maxPrice = searchPin.maxPrice || undefined;
      }

      // Comps must not depend on camera timing: while the fly-to is still in
      // transit the viewport hasn't reported yet (mapBounds null) and the old
      // region/empty fallback returned nothing until a manual pan. With a pin
      // anchor, query a ~zoom-14 box around it — the same few-km area the fly is
      // about to frame; the live viewport takes over on the next bounds report.
      const compBounds = mapBounds ?? (searchPin ? boundsAroundPoint(searchPin.lat, searchPin.lng) : null);

      // Fan out: comps (gated VOW route, sold and/or leased) + active (public Typesense),
      // whichever layers are lit, in parallel; then merge into one recency-sorted list.
      const [compRes, activeRes] = await Promise.all([
        plan.comps.length
          ? fetchSoldComps({ mapBounds: compBounds, location, windowDays: soldWindowDays, limit: MAX_LISTINGS, kinds: plan.comps, filters: compFilters })
          : Promise.resolve({ docs: [] as ListingDocument[], count: 0, locked: false }),
        plan.active ? runActiveSearch() : Promise.resolve(null),
      ]);

      setSoldLocked(plan.comps.length > 0 && compRes.locked);
      setSoldCount(compRes.count);

      const sources: ListingDocument[][] = [];
      if (compRes.docs.length) sources.push(compRes.docs);
      if (activeRes) sources.push(activeRes.listings);
      const merged = mergeLayers(sources).slice(0, MAX_LISTINGS);

      const total = (activeRes?.totalFound ?? 0) + compRes.count;
      setSearchResult({ listings: merged, totalFound: total, page: 1, perPage: MAX_LISTINGS, processingTimeMs: activeRes?.processingTimeMs ?? 0 });
      setTotalCount(total);
    } catch (err) {
      console.error("[CommandCenter] Search error:", err);
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [wantViewportScope, activeLayers, runActiveSearch, mapBounds, location, soldWindowDays, universalFilters, transactionMode, searchPin, setSoldLocked, setSoldCount, setSearchResult, setIsLoading, setError, setTotalCount]);

  // Drop any stale comps/search pin when the user navigates to a NEW area (location
  // change only — NOT on layer toggles, so the pin set alongside the Sold toggle in
  // comps-on-demand survives). The pin's own ✕ and the search-bar clear remove it too.
  useEffect(() => {
    exitComps();
  }, [location, exitComps]);

  // A fresh search (new area/persona/commute) should frame the whole zone first,
  // then let the user drill in — so clear the viewport box. Filters are excluded
  // on purpose: tweaking a filter re-queries in place at the current zoom.
  useEffect(() => {
    setMapBounds(null);
  }, [location, activePersona, transactionMode, propertyClass, activeLayers, commute.enabled, commute.polygon, school.enabled, school.targetSchool, amenity.enabled, amenity.kind, amenity.maxKm, setMapBounds]);

  // Debounced re-search on persona/filter/location change
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(performSearch, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [performSearch]);

  const listings = searchResult?.listings ?? [];
  // "View Selected" collapses both panes to the chosen subset (already loaded — no re-query).
  const displayed = showSelectedOnly ? listings.filter((l) => selectedIds.has(l.id)) : listings;

  // Color precedence: an explicit "Color By" metric wins; else the School lens
  // shades by score; else the persona's default metric. The explicit metric also
  // dictates heat-column aggregation (count for Density, mean otherwise).
  const activeMetric = getMapMetric(colorMetricId);
  const mapColorConfig =
    activeMetric ?? (school.enabled ? schoolMapColor(school.level, school.system) : persona.mapColor);
  const heatAggregation = activeMetric?.heatAggregation ?? "mean";

  // Only blanket the panes with the VOW gate when the view is comp-only — if an active
  // (For Sale / For Rent) layer is also lit, its listings aren't gated and must stay visible.
  const compOnly = !activeLayers.has("forSale") && !activeLayers.has("forRent");
  const showSoldLock = soldLocked && compOnly;
  const soldLockMsg = `${totalCount.toLocaleString()} gated market record${totalCount === 1 ? "" : "s"} — sign in to view`;

  // Mobile-only list/map switch. The map is the default view on mobile; the list
  // (full-width card ledger) is one tap away. Desktop shows both panes, so the
  // control is md:hidden. The effect below nudges the map to resize whenever it's
  // shown — on first mount (map is the default) and when revealed from the list.
  const [mobileView, setMobileView] = useState<"list" | "map">("map");
  useEffect(() => {
    if (mobileView !== "map") return;
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, [mobileView]);

  return (
    <div className="flex h-app flex-col overflow-hidden bg-slate-950">
      <TopCommandBar className="shrink-0" />

      <div className="flex min-h-0 flex-1">
        {/* Map — fills remaining width. Hidden on mobile (<md): the terminal's
            desktop split crushed the ledger into ~390px (audit C4), so mobile
            shows the full-width card ledger instead. A map/list toggle is a
            follow-up. */}
        {/* The map BASEMAP + deck.gl overlays are tuned dark (kept dark in both
            themes). The control DECK (rail / mode-dock / HUD) is wrapped in a `dark`
            scope so it stays dark-on-dark, but AlphaMap's listing popups + hover
            tooltips sit OUTSIDE that scope, so they follow the theme — light content
            cards over the dark map. */}
        <div className={cn("min-w-0 flex-1 flex-col bg-slate-950 md:flex", mobileView === "map" ? "flex" : "hidden")}>
          {/* The §6.3(i)/(k) reliability + bona-fide notice is NOT shown on the
              mobile MAP view (owner decision 2026-07-06 — it crowded the map UI).
              It still renders on this page via the LedgerPanel footer (desktop
              always; phones in list view). Compliance audit R9/R11 flagged this
              notice as mandatory on IDX pages — do not remove that ledger-footer
              instance too. */}
          {/* Phone-only, IN-FLOW active-mode chips (one-tap exits). Lives above the
              map on purpose: absolute banners over the map kept colliding with the
              legend HUD, burying the exit affordance (the "stuck in a mode" bug). */}
          <ActiveLensBar />
          <div className="relative min-h-0 flex-1">
            <AlphaMap
              properties={displayed}
              colorConfig={mapColorConfig}
              heatAggregation={heatAggregation}
              onSelectProperty={openListing}
              currentSearchQuery={`${activePersona}:${location}`}
              scopeToViewport={wantViewportScope}
              className="h-full w-full"
            />
            {/* Instrument Deck — dark control surface layered over the dark map. The
                `dark` scope (display:contents = no layout box) keeps the rail / drawer /
                mode-dock / HUD dark-styled even when the terminal is in light mode. */}
            <div className="dark" style={{ display: "contents" }}>
              <MapControlRail />
              <MapDrawer />
              <MapModeDock />
              <MapTimeline />
              <MapStatusHUD
                count={displayed.length}
                total={totalCount}
                colorConfig={mapColorConfig}
                metricDef={activeMetric}
                commuteActive={commute.enabled}
              />
              {/* Mobile-only entry point to the rail tools (Schools, Compare, etc.),
                  which are otherwise desktop-only via MapControlRail/MapDrawer. */}
              <MobileMapTools />
              {/* Save the current custom area as a Market Bubble. Self-hides when no
                  draw / commute / school filter is active. */}
              <div className="pointer-events-auto absolute right-3 top-3 z-30">
                <SaveBubbleButton />
              </div>
            </div>
            {showSoldLock && <VowGateOverlay message={soldLockMsg} />}
          </div>
        </div>

        {/* Drag handle — resize the ledger (desktop only) */}
        <div
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          className="group relative hidden w-1.5 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-cyan-500/60 md:block"
        >
          {/* Wider invisible hit area for easier grabbing */}
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* Ledger — full-width on mobile (hidden when the map view is active),
            user-resizable width on desktop where both panes always show. */}
        <div
          className={cn(
            "relative w-full shrink-0 flex-col bg-slate-950 md:flex md:w-[var(--ledger-w)]",
            mobileView === "map" ? "hidden" : "flex"
          )}
          style={{ "--ledger-w": `${ledgerWidth}px` } as React.CSSProperties}
        >
          <LedgerPanel className="flex-1 min-h-0" />
          {showSoldLock && <VowGateOverlay message={soldLockMsg} />}
        </div>
      </div>

      {/* Mobile-only list/map toggle — one tap between the default map and the
          full-width list ledger. Desktop shows both panes, so it's md:hidden. */}
      <div
        className="fixed left-1/2 z-40 flex -translate-x-1/2 overflow-hidden rounded-full border border-slate-700 bg-slate-900/95 shadow-lg backdrop-blur md:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {(["list", "map"] as const).map((v) => {
          const Icon = v === "list" ? List : MapIcon;
          return (
            <button
              key={v}
              type="button"
              onClick={() => setMobileView(v)}
              aria-pressed={mobileView === v}
              className={cn(
                "flex items-center gap-1.5 px-5 py-2 text-sm font-semibold capitalize transition-colors",
                mobileView === v ? "bg-cyan-500 text-slate-950" : "text-slate-300"
              )}
            >
              <Icon className="h-4 w-4" />
              {v}
            </button>
          );
        })}
      </div>

      {/* Desktop-only interim Quick Look (zero-fetch preview). On mobile, clicks
          route straight to /properties/[id] (useOpenListing), so this never mounts;
          the !isMobile guard also unmounts it cleanly on a resize down to phone. */}
      {selectedProperty && !isMobile && (
        <QuickLookPanel
          key={selectedProperty.id}
          property={selectedProperty}
          onClose={() => setIsTerminalOpen(false)}
        />
      )}

      <MapCommandPalette />
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-app items-center justify-center bg-slate-950">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-cyan-400" />
            <p className="text-slate-400">Initializing Command Center...</p>
          </div>
        </div>
      }
    >
      <CommandCenterContent />
    </Suspense>
  );
}
