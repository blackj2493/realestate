/**
 * Command Center — persona-driven 100vh investor terminal.
 * Left: deck.gl 3D map (yield-colored). Right: property ledger.
 * Queries Typesense exclusively (CLAUDE.md §3B), capped at 100 listings (§4).
 */

"use client";

import React, { useEffect, useCallback, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

import {
  TopCommandBar,
  LedgerPanel,
  ListingTerminal,
  SelectionBar,
  MapControlRail,
  MapDrawer,
  MapModeDock,
  MapStatusHUD,
} from "@/components/CommandCenter";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { getMapMetric, bandFilterClause } from "@/lib/personas/mapMetrics";
import { searchListings } from "@/lib/typesense/client";
import { schoolScoreField, schoolMapColor } from "@/lib/schools/schoolLens";
import { useCommuteIsochrone } from "@/hooks/useCommuteIsochrone";

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
// Exclude rentals (no filterable TransactionType; rentals sit ~$2.2k).
const SALES_FLOOR = "ListPrice:>=100000";

function CommandCenterContent() {
  const searchParams = useSearchParams();
  const {
    activePersona,
    filters,
    searchResult,
    setSearchResult,
    setIsLoading,
    setError,
    setTotalCount,
    location,
    setLocation,
    selectedProperty,
    setSelectedProperty,
    isTerminalOpen,
    setIsTerminalOpen,
    commute,
    school,
    mapBounds,
    setMapBounds,
    selectedIds,
    showSelectedOnly,
    totalCount,
    setMapMode,
    colorMetricId,
    colorBand,
    drawPolygon,
  } = useCommandCenterStore();

  // Fetch the commute isochrone polygon when destination/mode/minutes change.
  useCommuteIsochrone();

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

  const persona = PERSONA_CONFIG[activePersona];

  // Switching persona drops the map into that persona's default render mode
  // (e.g. Cashflow/Builders → Heatmap). The user can re-toggle freely after.
  useEffect(() => {
    setMapMode(PERSONA_CONFIG[activePersona].defaultMapMode);
  }, [activePersona, setMapMode]);

  const performSearch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const personaFilter = persona.buildFilterString(filters);

      // School-quality lens: one indexed score field drives the min-score filter,
      // the target-school proximity filter, and the sort override (best schools first).
      const schoolField = school.enabled ? schoolScoreField(school.level, school.system) : null;
      const schoolParts: string[] = [];
      if (schoolField && school.minScore > 0) schoolParts.push(`${schoolField}:>=${school.minScore}`);
      if (school.enabled && school.targetSchool) schoolParts.push(`NearbySchools:=\`${school.targetSchool.id}\``);

      // Interactive legend: a clicked band narrows the map to one value bucket
      // of the active color metric (only when that metric is field-backed).
      const bandDef = colorBand ? getMapMetric(colorBand.metricId) : null;
      const bandClause = bandDef ? bandFilterClause(bandDef, colorBand!.index) : null;

      // Draw-to-search: the lasso polygon ([lng,lat]) becomes a second location()
      // geo filter, intersecting with commute/viewport. Typesense wants "lat, lng".
      const drawClause =
        drawPolygon && drawPolygon.length >= 3
          ? `location:(${drawPolygon.map(([lng, lat]) => `${lat}, ${lng}`).join(", ")})`
          : null;

      const rawFilterBy = [SALES_FLOOR, personaFilter, ...schoolParts, bandClause, drawClause]
        .filter(Boolean)
        .join(" && ");

      // Commute zone: polygon is stored [lng, lat]; Typesense wants [lat, lng].
      const geoPolygon =
        commute.enabled && commute.polygon && commute.polygon.length >= 3
          ? commute.polygon.map(([lng, lat]) => [lat, lng] as [number, number])
          : undefined;

      const result = await searchListings({
        query: location || "*",
        rawFilterBy,
        geoPolygon,
        // Scope the query to the current map view so the 100-cap reveals deeper
        // inventory as the user zooms in (null until the user moves the map).
        filters: mapBounds ? { boundingBox: mapBounds } : undefined,
        perPage: MAX_LISTINGS,
        // When the school lens is on, rank by school score; else persona default.
        sortBy: schoolField ?? persona.sortBy,
        sortOrder: "desc",
      });

      setSearchResult(result);
      setTotalCount(result.totalFound);
    } catch (err) {
      console.error("[CommandCenter] Search error:", err);
      setError(err instanceof Error ? err.message : "Search service temporarily unavailable.");
      setSearchResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [persona, filters, location, commute.enabled, commute.polygon, school.enabled, school.level, school.system, school.minScore, school.targetSchool, colorBand, drawPolygon, mapBounds, setSearchResult, setIsLoading, setError, setTotalCount]);

  // A fresh search (new area/persona/commute) should frame the whole zone first,
  // then let the user drill in — so clear the viewport box. Filters are excluded
  // on purpose: tweaking a filter re-queries in place at the current zoom.
  useEffect(() => {
    setMapBounds(null);
  }, [location, activePersona, commute.enabled, commute.polygon, school.enabled, school.targetSchool, setMapBounds]);

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

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
      <TopCommandBar className="shrink-0" />

      <div className="flex min-h-0 flex-1">
        {/* Map — fills remaining width */}
        <div className="relative min-w-0 flex-1">
          <AlphaMap
            properties={displayed}
            colorConfig={mapColorConfig}
            heatAggregation={heatAggregation}
            onSelectProperty={setSelectedProperty}
            currentSearchQuery={`${activePersona}:${location}`}
            className="h-full w-full"
          />
          {/* Instrument Deck — control surface layered over the map */}
          <MapControlRail />
          <MapDrawer />
          <MapModeDock />
          <MapStatusHUD
            count={displayed.length}
            total={totalCount}
            colorConfig={mapColorConfig}
            metricDef={activeMetric}
            commuteActive={commute.enabled}
          />
          <SelectionBar />
        </div>

        {/* Drag handle — resize the ledger */}
        <div
          onMouseDown={startResize}
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize"
          className="group relative w-1.5 shrink-0 cursor-col-resize bg-slate-800 transition-colors hover:bg-cyan-500/60"
        >
          {/* Wider invisible hit area for easier grabbing */}
          <div className="absolute inset-y-0 -left-2 -right-2" />
        </div>

        {/* Ledger — user-resizable width */}
        <div className="flex shrink-0 flex-col bg-slate-950" style={{ width: ledgerWidth }}>
          <LedgerPanel className="flex-1 min-h-0" />
        </div>
      </div>

      {selectedProperty && (
        <ListingTerminal
          property={selectedProperty}
          isOpen={isTerminalOpen}
          onClose={() => setIsTerminalOpen(false)}
        />
      )}
    </div>
  );
}

export default function PropertiesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950">
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
