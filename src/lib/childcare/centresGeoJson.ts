/**
 * Compact GeoJSON of Toronto licensed child care centres for the map pins (served by
 * /api/childcare/centres). Browser-safe types; the builder runs server-side only.
 */
import type { ChildCareFile } from "./torontoChildCare";

export interface ChildCareCentreProps {
  id: number;
  name: string;
  infant: number;
  toddler: number;
  preschool: number;
  cwelcc: boolean;
}

export interface ChildCareCentresGeoJson {
  type: "FeatureCollection";
  updated: string;
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: ChildCareCentreProps;
  }[];
}

/** Coordinates are [lng, lat] per GeoJSON. Kindergarten / school-age counts are left out. */
export function buildCentresGeoJson(file: ChildCareFile): ChildCareCentresGeoJson {
  return {
    type: "FeatureCollection",
    updated: file.updated,
    features: file.centres
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lng, c.lat] as [number, number] },
        properties: {
          id: c.id,
          name: c.name,
          infant: c.infant,
          toddler: c.toddler,
          preschool: c.preschool,
          cwelcc: c.cwelcc,
        },
      })),
  };
}
