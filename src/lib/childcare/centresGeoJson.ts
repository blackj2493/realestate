/**
 * Compact GeoJSON of licensed child care centres for the map pins (served by
 * /api/childcare/centres). Browser-safe types; the builder runs server-side only.
 *
 * Two kinds of pin, told apart by `detail`:
 *   - detail: true  — City of Toronto data: spaces by age group and the $10-a-day flag;
 *   - detail: false — Ontario ministry list (outside Toronto): name and full/half day only,
 *                     at the postal-code point (approximate).
 */
import type { ChildCareFile } from "./torontoChildCare";
import type { OntarioChildCareFile } from "./ontarioChildCare";

export interface TorontoCentreProps {
  detail: true;
  id: number;
  name: string;
  infant: number;
  toddler: number;
  preschool: number;
  cwelcc: boolean;
}

export interface OntarioCentreProps {
  detail: false;
  id: string;
  name: string;
  fullDay: boolean;
}

export type ChildCareCentreProps = TorontoCentreProps | OntarioCentreProps;

export interface ChildCareCentresGeoJson {
  type: "FeatureCollection";
  /** Toronto feed date (the Ontario list has its own, `ontarioUpdated`). */
  updated: string;
  ontarioUpdated: string | null;
  features: {
    type: "Feature";
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: ChildCareCentreProps;
  }[];
}

/** Coordinates are [lng, lat] per GeoJSON. Kindergarten / school-age counts are left out. */
export function buildCentresGeoJson(file: ChildCareFile, ontario?: OntarioChildCareFile | null): ChildCareCentresGeoJson {
  const point = (lng: number, lat: number) => ({ type: "Point" as const, coordinates: [lng, lat] as [number, number] });
  const toronto = file.centres
    // Same rule as assignChildCare: the tool is for children under school age, so a
    // centre with only kindergarten or school-age spaces is not a pin.
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && c.infant + c.toddler + c.preschool > 0)
    .map((c) => ({
      type: "Feature" as const,
      geometry: point(c.lng, c.lat),
      properties: {
        detail: true as const,
        id: c.id,
        name: c.name,
        infant: c.infant,
        toddler: c.toddler,
        preschool: c.preschool,
        cwelcc: c.cwelcc,
      },
    }));
  // The Ontario file already holds only centres for children under school age.
  const province = (ontario?.centres ?? [])
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({
      type: "Feature" as const,
      geometry: point(c.lng, c.lat),
      properties: { detail: false as const, id: c.id, name: c.name, fullDay: c.fullDay },
    }));
  return {
    type: "FeatureCollection",
    updated: file.updated,
    ontarioUpdated: ontario?.updated ?? null,
    features: [...toronto, ...province],
  };
}
