"use client";

import { Map, useControl } from "react-map-gl/mapbox";
import { MapboxOverlay, type MapboxOverlayProps } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import "mapbox-gl/dist/mapbox-gl.css";

// Sample GTA coordinates [lng, lat] for the glowing deck.gl data points.
const POINTS: [number, number][] = [
  [-79.3832, 43.6532],
  [-79.42, 43.66],
  [-79.36, 43.65],
  [-79.45, 43.7],
  [-79.34, 43.72],
  [-79.5, 43.74],
  [-79.4, 43.78],
  [-79.3, 43.77],
  [-79.51, 43.84],
  [-79.44, 43.88],
  [-79.34, 43.86],
  [-79.64, 43.59],
  [-79.55, 43.65],
  [-79.25, 43.77],
  [-79.47, 43.59],
  [-79.38, 43.59],
];

function DeckOverlay(props: MapboxOverlayProps) {
  const overlay = useControl(() => new MapboxOverlay(props));
  overlay.setProps(props);
  return null;
}

export default function HeroMapCanvas() {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token || token === "your-mapbox-token") return null;

  const layers = [
    new ScatterplotLayer<[number, number]>({
      id: "glow-halo",
      data: POINTS,
      getPosition: (d) => d,
      getRadius: 26,
      radiusUnits: "pixels",
      getFillColor: [16, 185, 129, 35],
      stroked: false,
    }),
    new ScatterplotLayer<[number, number]>({
      id: "glow-core",
      data: POINTS,
      getPosition: (d) => d,
      getRadius: 5,
      radiusUnits: "pixels",
      getFillColor: [52, 211, 153, 200],
      stroked: false,
    }),
  ];

  return (
    <div className="absolute inset-0 h-full w-full">
      <Map
        mapboxAccessToken={token}
        initialViewState={{
          longitude: -79.4,
          latitude: 43.7,
          zoom: 10.6,
          pitch: 0,
          bearing: 0,
        }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: "100%", height: "100%" }}
        reuseMaps
        attributionControl={false}
        interactive={false}
      >
        <DeckOverlay layers={layers} interleaved={false} />
      </Map>
    </div>
  );
}
