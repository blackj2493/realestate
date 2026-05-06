"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { Map, NavigationControl } from "react-map-gl/mapbox";
import { MapViewState } from "@deck.gl/core";
import { MapPin, Layers } from "lucide-react";

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

interface TerminalMapProps {
  targetProperty: ListingRecord;
  localComps: ListingRecord[];
  className?: string;
}

// Yield-based color scale
// < 4% (Negative Leverage): Cool Blue
// 4-6.5% (Break-Even to Moderate): Yellow
// > 6.5% (High Yield/Alpha): Fiery Orange
const YIELD_COLORS = {
  low: [59, 130, 246] as [number, number, number],      // Blue (< 4%)
  mid: [250, 204, 21] as [number, number, number],       // Yellow (4-6.5%)
  high: [249, 115, 22] as [number, number, number],      // Orange (> 6.5%)
};

// Target asset colors
const TARGET_COLORS = {
  fill: [255, 255, 255] as [number, number, number],    // Pure white
  border: [249, 115, 22] as [number, number, number],   // Orange border
  glow: [249, 115, 22, 40] as [number, number, number, number], // Subtle glow
};

export default function TerminalMap({ targetProperty, localComps, className = "" }: TerminalMapProps) {
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // Calculate initial viewport centered on target property
  const initialViewState = useMemo<MapViewState>(() => {
    const lng = targetProperty.location?.[1] ?? -79.3832;
    const lat = targetProperty.location?.[0] ?? 43.6532;
    return {
      longitude: lng,
      latitude: lat,
      zoom: 15.5, // Neighborhood-level zoom
      pitch: 0,   // Flat view for better marker visibility
      bearing: 0,
    };
  }, [targetProperty.location]);

  const [viewState, setViewState] = useState<MapViewState>(initialViewState);

  // Track hover state for tooltips
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    object: ListingRecord | null;
  } | null>(null);

  // ============================================================================
  // Yield-based color accessor for local comps
  // ============================================================================
  
  const getCompFillColor = useCallback((d: ListingRecord): [number, number, number] => {
    const yieldValue = d.targetGrossYield ?? 0;
    if (yieldValue < 0.04) {
      return YIELD_COLORS.low;     // Blue
    } else if (yieldValue <= 0.065) {
      return YIELD_COLORS.mid;    // Yellow
    } else {
      return YIELD_COLORS.high;   // Orange
    }
  }, []);

  // ============================================================================
  // Deck.gl Layers
  // ============================================================================
  
  const layers = useMemo(() => {
    const result = [];

    // Layer 1: Local Comps (Background) - rendered first
    if (localComps && localComps.length > 0) {
      result.push(
        new ScatterplotLayer<ListingRecord>({
          id: "local-comps-layer",
          data: localComps,
          getPosition: (d) => [d.location[1], d.location[0]], // [lng, lat]
          getRadius: 8,
          radiusUnits: "pixels",
          getFillColor: getCompFillColor,
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
          updateTriggers: {
            getFillColor: [localComps],
          },
        })
      );
    }

    // Layer 2: Target Asset Glow (Shadow beneath main marker)
    result.push(
      new ScatterplotLayer({
        id: "target-asset-glow-layer",
        data: [targetProperty],
        getPosition: (d: ListingRecord) => [d.location[1], d.location[0]],
        getRadius: 24,
        radiusUnits: "pixels",
        getFillColor: TARGET_COLORS.glow,
        stroked: false,
      })
    );

    // Layer 3: Target Asset (Foreground) - rendered last (on top)
    result.push(
      new ScatterplotLayer<ListingRecord>({
        id: "target-asset-layer",
        data: [targetProperty],
        getPosition: (d) => [d.location[1], d.location[0]], // [lng, lat]
        getRadius: 16,
        radiusUnits: "pixels",
        getFillColor: TARGET_COLORS.fill,
        stroked: true,
        getLineColor: TARGET_COLORS.border,
        lineWidthMinPixels: 4,
      })
    );

    return result;
  }, [targetProperty, localComps, getCompFillColor]);

  // ============================================================================
  // Viewport Handler
  // ============================================================================
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewStateChange = useCallback((params: any) => {
    if (!params.viewState) return;
    setViewState(params.viewState);
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

  return (
    <div className={`relative rounded-lg overflow-hidden ${className}`} style={{ minHeight: '400px', height: '100%' }}>
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
          scrollZoom={false} // Disabled to prevent accidental zoom in terminal layout
        >
          <NavigationControl position="top-right" />
        </Map>
      </DeckGL>

      {/* Hover Tooltip for Local Comps */}
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
          {hoverInfo.object.targetGrossYield !== undefined && (
            <p className="text-xs text-slate-400 mt-0.5">
              Yield: {(hoverInfo.object.targetGrossYield * 100).toFixed(1)}%
            </p>
          )}
        </div>
      )}

      {/* Legend Overlay */}
      <div className="absolute bottom-4 left-4 bg-slate-900/90 backdrop-blur-sm px-4 py-3 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-400 font-medium mb-2">Yield Color Scale</p>
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `rgb(${YIELD_COLORS.low.join(',')})` }} />
            <span className="text-slate-500">{"<4%"}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `rgb(${YIELD_COLORS.mid.join(',')})` }} />
            <span className="text-slate-500">4-6.5%</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: `rgb(${YIELD_COLORS.high.join(',')})` }} />
            <span className="text-slate-500">{">6.5%"}</span>
          </div>
        </div>
      </div>

      {/* Property Count Badge */}
      <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-slate-700 shadow-xl z-10">
        <p className="text-xs text-slate-300 font-mono">
          <span className="text-emerald-400 font-semibold">{localComps?.length || 0}</span> local comps
        </p>
      </div>

      {/* Target Asset Indicator */}
      <div className="absolute top-4 right-16 bg-orange-500/90 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-xl z-10">
        <p className="text-xs text-white font-semibold flex items-center gap-1.5">
          <MapPin className="h-3 w-3" />
          Target Asset
        </p>
      </div>
    </div>
  );
}