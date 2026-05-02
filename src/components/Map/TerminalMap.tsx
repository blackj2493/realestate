"use client";

// Mapbox CSS - CRITICAL: Without this, WebGL canvas dimensions cannot be calculated
import "mapbox-gl/dist/mapbox-gl.css";

import { useState, useMemo, useCallback } from "react";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";
import { Map } from "react-map-gl/mapbox";
import { MapViewState } from "@deck.gl/core";
import { Layers, MapPin } from "lucide-react";

// Typesense ListingDocument type (matches src/lib/typesense/client.ts)
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

// Deck.gl data point format
interface MapDataPoint {
  COORDINATES: [number, number]; // [longitude, latitude]
  weight: number;
  id: string;
  price: number;
  address: string;
}

interface TerminalMapProps {
  properties: ListingRecord[];
  className?: string;
}

// GTA area initial viewport - centered directly over Toronto
const INITIAL_VIEW_STATE: MapViewState = {
  longitude: -79.3832,
  latitude: 43.6532,
  zoom: 9,
  pitch: 45, // Critical for seeing the 3D Hexagon extrusion
  bearing: 0,
};

// Dark heatmap-style color range (low density → high density)
// Dark blue → Purple → Magenta → Bright Cyan → Neon Green
const COLOR_RANGE: [number, number, number][] = [
  [26, 26, 46],     // #1a1a2e - dark navy
  [15, 52, 96],     // #0f3460 - deep blue
  [147, 52, 96],    // #e94560 - magenta/red
  [0, 215, 175],    // #00d7af - cyan
  [0, 255, 136],    // #00ff88 - neon green
];

export default function TerminalMap({ properties, className = "" }: TerminalMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);

  // ============================================================================
  // Data Transformation: Filter & Format for Deck.gl
  // ============================================================================
  
  const mapData = useMemo<MapDataPoint[]>(() => {
    if (!properties || properties.length === 0) return [];
    
    // CRITICAL: Filter properties with valid numerical latitude/longitude
    // Silently drop properties without valid coordinates to prevent Deck.gl crashes
    const validProperties = properties.filter((p) => {
      const lat = p.location?.[0];
      const lng = p.location?.[1];
      return (
        typeof lat === "number" &&
        typeof lng === "number" &&
        !isNaN(lat) &&
        !isNaN(lng) &&
        lat >= -90 && lat <= 90 &&
        lng >= -180 && lng <= 180
      );
    });

    // Transform to Deck.gl format: [lng, lat] (GeoJSON/Deck.gl uses lng, lat)
    // Weight based on ListPrice for density visualization
    return validProperties.map((p) => ({
      COORDINATES: [p.location[1], p.location[0]] as [number, number], // [lng, lat]
      weight: p.ListPrice || 1,
      id: p.id,
      price: p.ListPrice || 0,
      address: p.UnparsedAddress || "Address Unavailable",
    }));
  }, [properties]);

  // ============================================================================
  // Deck.gl Layer Configuration
  // ============================================================================

  const layers = useMemo(() => {
    if (mapData.length === 0) return [];

    return [
      new HexagonLayer({
        id: "hexagon-layer",
        data: mapData,
        getPosition: (d: MapDataPoint) => d.COORDINATES,
        getElevationWeight: (d: MapDataPoint) => d.weight,
        getColorWeight: (d: MapDataPoint) => d.weight,
        elevationScale: 50, // Height reacts to density/value
        extruded: true, // Enable 3D height
        radius: 500, // 500 meter hex bins
        coverage: 0.9,
        upperPercentile: 100,
        colorRange: COLOR_RANGE,
        elevationRange: [0, 1000], // Max height in meters
        material: {
          ambient: 0.4,
          diffuse: 0.6,
          shininess: 32,
          specularColor: [60, 64, 70],
        },
        pickable: true,
        autoHighlight: true,
        highlightColor: [0, 255, 136, 180], // Neon green highlight on hover
        onHover: (info) => {
          // Could show tooltip here if needed
          void info;
          return true;
        },
      }),
    ];
  }, [mapData]);

  // ============================================================================
  // Viewport Handler
  // ============================================================================

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewStateChange = useCallback((params: any) => {
    if (params.viewState) {
      setViewState(params.viewState);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  if (!mapboxToken || mapboxToken === "your-mapbox-token") {
    return (
      <div className={`flex items-center justify-center bg-slate-900 rounded-lg ${className}`}>
        <div className="text-center p-6">
          <MapPin className="h-12 w-12 mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 font-medium">Map not configured</p>
          <p className="text-xs text-slate-500 mt-1">Please add NEXT_PUBLIC_MAPBOX_TOKEN to .env</p>
        </div>
      </div>
    );
  }

  if (mapData.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-slate-900 rounded-lg ${className}`}>
        <div className="text-center p-6">
          <Layers className="h-12 w-12 mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 font-medium">No Data to Visualize</p>
          <p className="text-xs text-slate-500 mt-1">Adjust filters to see property density</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`}>
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={true}
        layers={layers}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      >
        <Map
          mapboxAccessToken={mapboxToken}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          reuseMaps
          attributionControl={false}
        />
      </DeckGL>

      {/* Legend / Stats Overlay */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm px-4 py-3 rounded-lg border border-slate-700 shadow-xl z-10">
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#1a1a2e]" />
            <span className="text-slate-400">Low</span>
          </div>
          <div className="w-20 h-1 rounded-full bg-gradient-to-r from-[#0f3460] via-[#e94560] to-[#00ff88]" />
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-[#00ff88]" />
            <span className="text-slate-400">High</span>
          </div>
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5 font-mono">
          {mapData.length} properties • Hex bins: 500m
        </p>
      </div>

      {/* Property Count Badge */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-300 font-mono">
          <span className="text-emerald-400 font-semibold">{mapData.length}</span> mapped
        </p>
      </div>
    </div>
  );
}
