"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Map, NavigationControl } from "react-map-gl/mapbox";
import { MapViewState, FlyToInterpolator } from "@deck.gl/core";
import { useRouter } from "next/navigation";
import { Layers, MapPin } from "lucide-react";

// Typesense ListingDocument type
interface ListingRecord {
  id: string;
  ListPrice: number;
  UnparsedAddress?: string;
  City?: string;
  PropertyType?: string;
  PropertySubType?: string;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  BuildingAreaTotal?: number;
  location: [number, number]; // [latitude, longitude]
  isDistressed: boolean;
  targetGrossYield?: number;
  hasSecondarySuitePotential: boolean;
  calculatedDOM?: number;
  thumbnailUrl?: string;
  ListOfficeName?: string;
}

interface AlphaMapProps {
  properties: ListingRecord[];
  className?: string;
  currentSearchQuery?: string; // Track search changes for auto-fit
}

// Deck.gl data point with coordinates
interface MapDataPoint extends ListingRecord {
  coordinates: [number, number];
}

// Semantic zoom threshold - switches from HexagonLayer to ScatterplotLayer
const ZOOM_THRESHOLD = 13.5;

// Initial GTA viewport
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -79.3832,
  latitude: 43.6532,
  zoom: 10,
  pitch: 45,
  bearing: 0,
};

// DOM-based color scale (cold to hot: blue → cyan → yellow → orange → red)
const DOM_COLOR_RANGE: [number, number, number][] = [
  [59, 130, 246],   // Blue (low DOM - fresh listings)
  [6, 182, 212],    // Cyan
  [34, 197, 94],    // Green
  [250, 204, 21],   // Yellow
  [249, 115, 22],   // Orange
  [239, 68, 68],    // Red (high DOM - distressed)
];

export default function AlphaMap({ properties, className = "", currentSearchQuery = "" }: AlphaMapProps) {
  const router = useRouter();
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: ListingRecord | null;
  } | null>(null);

  // Interaction tracking refs
  const isInteracting = useRef(false);
  const lastSearchQuery = useRef(currentSearchQuery);
  const mapInitialized = useRef(false);

  // ============================================================================
  // Coordinate Validation - Canada bounding box
  // ============================================================================
  const CANADA_BOUNDS = { minLat: 41, maxLat: 84, minLng: -141, maxLng: -53 };
  
  const isValidCanadaCoord = (lat: number, lng: number): boolean => {
    return lat >= CANADA_BOUNDS.minLat && lat <= CANADA_BOUNDS.maxLat &&
           lng >= CANADA_BOUNDS.minLng && lng <= CANADA_BOUNDS.maxLng;
  };

  // ============================================================================
  // Data Transformation with useMemo for sub-50ms rendering
  // ============================================================================

  const validProperties = useMemo(() => {
    if (!properties || properties.length === 0) return [];

    const filtered = properties.filter((p) => {
      const lat = p.location?.[0];
      const lng = p.location?.[1];
      
      // First check basic validity
      const isBasicValid = (
        typeof lat === "number" &&
        typeof lng === "number" &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      );
      
      if (!isBasicValid) return false;
      
      // CRITICAL: Also validate it's in Canada to prevent Ecuador-like issues
      // Fallback to Toronto center if coordinates are outside Canada
      return isValidCanadaCoord(lat, lng);
    });
    
    // DEBUG: Log first few property coordinates
    if (filtered.length > 0) {
      const samples = filtered.slice(0, 3).map(p => ({
        id: p.id?.substring(0, 8),
        location: p.location,
        lat: p.location?.[0],
        lng: p.location?.[1]
      }));
      console.log('[AlphaMap] Sample valid (Canada) properties:', samples);
    }
    
    return filtered;
  }, [properties]);

  // Convert to [longitude, latitude] format for Deck.gl
  const mapData = useMemo(() => {
    return validProperties.map((p) => ({
      ...p,
      coordinates: [p.location[1], p.location[0]] as [number, number],
    }));
  }, [validProperties]);

  // ============================================================================
  // Smart Auto-fit Effect (isolated from user pan/zoom)
  // ============================================================================

  useEffect(() => {
    // Skip if user is currently interacting with the map
    if (isInteracting.current) {
      return;
    }

    // Skip if no valid properties
    if (validProperties.length === 0) {
      return;
    }

    // Check if search query changed or map hasn't been initialized yet
    const searchQueryChanged = lastSearchQuery.current !== currentSearchQuery;
    const shouldAutoFit = !mapInitialized.current || searchQueryChanged;

    if (!shouldAutoFit) {
      return;
    }

    // Calculate bounding box of all properties
    let minLng = Infinity, maxLng = -Infinity;
    let minLat = Infinity, maxLat = -Infinity;
    let validCount = 0;

    for (const p of validProperties) {
      const lng = p.location[1];
      const lat = p.location[0];
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      validCount++;
    }

    if (validCount === 0) {
      return;
    }

    // Calculate center and zoom level
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;
    const lngRange = maxLng - minLng;
    const latRange = maxLat - minLat;

    // Calculate appropriate zoom level based on data spread
    const maxRange = Math.max(lngRange, latRange);
    let zoom = 10;
    if (maxRange > 0) {
      // Higher zoom for smaller areas, lower for larger
      zoom = Math.max(8, Math.min(15, 12 - Math.log10(maxRange * 100)));
    }

    // Update state with smooth transition
    console.log('[AlphaMap] Auto-fitting to', validCount, 'properties at zoom', zoom.toFixed(2));
    setViewState({
      longitude: centerLng,
      latitude: centerLat,
      zoom,
      pitch: 45,
      bearing: 0,
      transitionDuration: 1000,
      transitionInterpolator: new FlyToInterpolator(),
    });

    // Mark as initialized and update search query ref
    mapInitialized.current = true;
    lastSearchQuery.current = currentSearchQuery;
  }, [validProperties, currentSearchQuery]);

  // ============================================================================
  // Yield-based color accessor (for ScatterplotLayer micro view)
  // ============================================================================

  const getYieldColor = useCallback((d: ListingRecord): [number, number, number] => {
    const dom = d.calculatedDOM ?? 0;
    
    // Normalize DOM to 0-1 range (assuming max DOM of 365 days)
    const normalized = Math.min(dom / 365, 1);
    const colorIndex = Math.floor(normalized * (DOM_COLOR_RANGE.length - 1));
    
    return DOM_COLOR_RANGE[colorIndex];
  }, []);

  // ============================================================================
  // Layer Configuration based on zoom level
  // ============================================================================

  const layers = useMemo(() => {
    if (mapData.length === 0) return [];

    const currentZoom = viewState.zoom;

    if (currentZoom < ZOOM_THRESHOLD) {
      // MACRO VIEW: HexagonLayer for aggregated density visualization
      return [
        new HexagonLayer({
          id: "hexagon-layer",
          data: mapData,
          getPosition: (d) => d.coordinates,
          getElevationWeight: (d) => d.targetGrossYield ?? d.ListPrice / 1000000,
          getColorWeight: (d) => d.calculatedDOM ?? 0,
          elevationScale: 100,
          extruded: true,
          radius: 500,
          coverage: 0.9,
          upperPercentile: 100,
          colorRange: DOM_COLOR_RANGE,
          elevationRange: [0, 1000],
          material: {
            ambient: 0.4,
            diffuse: 0.6,
            shininess: 32,
            specularColor: [60, 64, 70],
          },
          pickable: true,
          autoHighlight: true,
          highlightColor: [0, 255, 136, 180],
        }),
      ];
    } else {
      // MICRO VIEW: ScatterplotLayer for individual property pins
      return [
        new ScatterplotLayer<MapDataPoint>({
          id: "scatter-layer",
          data: mapData,
          getPosition: (d) => d.coordinates,
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: (d) => getYieldColor(d),
          pickable: true,
          autoHighlight: true,
          highlightColor: [255, 255, 255, 100],
          onHover: (info) => {
            if (info.object) {
              setHoverInfo({
                x: info.x,
                y: info.y,
                object: info.object,
              });
            } else {
              setHoverInfo(null);
            }
          },
          onClick: (info) => {
            if (info.object) {
              router.push(`/properties/${info.object.id}`);
            }
          },
          updateTriggers: {
            getFillColor: [validProperties],
          },
        }),
      ];
    }
  }, [mapData, viewState.zoom, getYieldColor, validProperties, router]);

  // ============================================================================
  // Viewport Handler with Interaction Tracking
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewStateChange = useCallback((params: any) => {
    if (!params.viewState) return;
    
    // Update view state
    setViewState(params.viewState);
    
    // Track if user is interacting
    if (params.interactionState) {
      isInteracting.current = params.interactionState.isDragging || 
                             params.interactionState.isPanning || 
                             params.interactionState.isZooming;
    }
  }, []);

  // Clear interaction flag when user stops interacting
  const handleDragEnd = useCallback(() => {
    // Small delay to ensure we're truly done interacting
    setTimeout(() => {
      isInteracting.current = false;
    }, 100);
  }, []);

  const handleTransitionEnd = useCallback(() => {
    isInteracting.current = false;
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (!mapboxToken || mapboxToken === "your-mapbox-token") {
    return (
      <div className={`flex items-center justify-center bg-slate-950 rounded-lg ${className}`}>
        <div className="text-center p-6">
          <MapPin className="h-12 w-12 mx-auto mb-3 text-slate-700" />
          <p className="text-slate-400 font-medium">Map not configured</p>
          <p className="text-xs text-slate-600 mt-1">Please add NEXT_PUBLIC_MAPBOX_TOKEN to .env</p>
        </div>
      </div>
    );
  }

  if (validProperties.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-slate-950 rounded-lg ${className}`}>
        <div className="text-center p-6">
          <Layers className="h-12 w-12 mx-auto mb-3 text-slate-700" />
          <p className="text-slate-400 font-medium">No Properties to Visualize</p>
          <p className="text-xs text-slate-500 mt-1">Adjust filters to see property density</p>
        </div>
      </div>
    );
  }

  const isMacroView = viewState.zoom < ZOOM_THRESHOLD;

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`} style={{ minHeight: '500px', height: '100%' }}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        onDragEnd={handleDragEnd}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map
          mapboxAccessToken={mapboxToken}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          reuseMaps
          attributionControl={false}
        >
          <NavigationControl position="top-right" />
        </Map>
      </DeckGL>

      {/* Hover Tooltip */}
      {hoverInfo && hoverInfo.object && (
        <div
          className="absolute pointer-events-none z-20 bg-slate-900/95 backdrop-blur-sm px-3 py-2 rounded-lg border border-slate-700 shadow-xl"
          style={{
            left: hoverInfo.x + 10,
            top: hoverInfo.y + 10,
          }}
        >
          <p className="text-xs text-slate-300 font-medium">
            {hoverInfo.object.UnparsedAddress || 'Unknown Address'}
          </p>
          <p className="text-sm text-emerald-400 font-mono mt-1">
            ${hoverInfo.object.ListPrice?.toLocaleString() || 'N/A'}
          </p>
          {hoverInfo.object.calculatedDOM !== undefined && (
            <p className="text-xs text-slate-400 mt-0.5">
              Days on Market: {hoverInfo.object.calculatedDOM}d
            </p>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm px-4 py-3 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-400 font-medium mb-2">
          {isMacroView ? "Market Density (Hexbins)" : "Days on Market"}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgb(${DOM_COLOR_RANGE[0].join(',')})` }} />
            <span className="text-slate-500">Fresh</span>
          </div>
          <div className="w-16 h-1 rounded-full bg-gradient-to-r from-blue-500 via-green-500 to-red-500" />
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: `rgb(${DOM_COLOR_RANGE[DOM_COLOR_RANGE.length - 1].join(',')})` }} />
            <span className="text-slate-500">Distressed</span>
          </div>
        </div>
      </div>

      {/* Property Count Badge */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-300 font-mono">
          <span className="text-emerald-400 font-semibold">{validProperties.length}</span> properties
        </p>
      </div>

      {/* View Mode Indicator */}
      <div className="absolute top-4 right-16 bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-400 font-mono">
          {isMacroView ? "Hexagon View" : "Pin View"}
        </p>
      </div>
    </div>
  );
}