/**
 * Command Center — persona-driven 100vh investor terminal.
 * Left: deck.gl 3D map (yield-colored). Right: property ledger.
 * Queries Typesense exclusively (CLAUDE.md §3B), capped at 100 listings (§4).
 */

"use client";

import React, { useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

import { TopCommandBar, LedgerPanel, ListingTerminal } from "@/components/CommandCenter";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import { PERSONA_CONFIG } from "@/lib/personas/personaConfig";
import { searchListings } from "@/lib/typesense/client";
import { schoolScoreField, schoolMapColor } from "@/lib/schools/schoolLens";
import { useCommuteIsochrone } from "@/hooks/useCommuteIsochrone";

// deck.gl + mapbox must load client-only
const AlphaMap = dynamic(() => import("@/components/Map/AlphaMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-slate-950">
      <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
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
  } = useCommandCenterStore();

  // Fetch the commute isochrone polygon when destination/mode/minutes change.
  useCommuteIsochrone();

  // Seed location from URL (?city= / ?search=)
  useEffect(() => {
    const cityParam = searchParams.get("city") || searchParams.get("search") || "";
    if (cityParam && cityParam !== location) setLocation(cityParam);
  }, [searchParams, location, setLocation]);

  const persona = PERSONA_CONFIG[activePersona];

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

      const rawFilterBy = [SALES_FLOOR, personaFilter, ...schoolParts].filter(Boolean).join(" && ");

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
  }, [persona, filters, location, commute.enabled, commute.polygon, school.enabled, school.level, school.system, school.minScore, school.targetSchool, mapBounds, setSearchResult, setIsLoading, setError, setTotalCount]);

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

  // When the school lens is on, shade the map by the active lens's school score.
  const mapColorConfig = school.enabled
    ? schoolMapColor(school.level, school.system)
    : persona.mapColor;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950">
      <TopCommandBar className="shrink-0" />

      <div className="flex min-h-0 flex-1">
        {/* Map — left 70% */}
        <div className="relative w-[70%] shrink-0 border-r border-slate-800">
          <AlphaMap
            properties={listings}
            colorConfig={mapColorConfig}
            defaultMapMode={persona.defaultMapMode}
            onSelectProperty={setSelectedProperty}
            currentSearchQuery={`${activePersona}:${location}`}
            className="h-full w-full"
          />
        </div>

        {/* Ledger — right 30% */}
        <div className="flex w-[30%] shrink-0 flex-col bg-slate-950">
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
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-400" />
            <p className="text-slate-400">Initializing Command Center...</p>
          </div>
        </div>
      }
    >
      <CommandCenterContent />
    </Suspense>
  );
}
