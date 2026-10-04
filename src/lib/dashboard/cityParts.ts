/**
 * The parts a city too big to follow whole is offered as.
 *
 * WHY. An area is what the nightly email is about, so it has to be small enough to read.
 * Toronto is ~10,000 homes for sale, filed as 35 opaque district codes; Richmond Hill, a
 * city people happily follow whole, is ~1,000. A whole-Toronto follower got a firehose and
 * unsubscribed at 35.5% (measured 2026-10-04). The codes themselves are no fix: nobody
 * knows "C02", and 37% of readers who browse Toronto open homes in five or more districts.
 *
 * So Toronto is offered as seven parts named the way Torontonians talk, each roughly the
 * size of a suburb (600-2,500 homes). Each part is a whole number of districts, because the
 * district is the smallest unit the feed's City field and every filter can use. Grouping was
 * checked against the former municipalities (owner-approved 2026-10-04):
 *   - C11 (Leaside, Thorncliffe Park) is East York, not Midtown.
 *   - W04 mixes York (Weston, Mount Dennis) with North York (Yorkdale); it stays with York.
 *   - C03/C04 mix York and North York streets but read as Midtown to buyers.
 * TREB has no C05.
 *
 * A part name is a region like any other: it is a CITY_GROUPS key (area.ts) so the map,
 * dashboard and nightly email expand it, and a region_aliases row set (seed-region-aliases)
 * so the SQL market stats do. This file is the one source for both.
 *
 * Names use only letters, spaces and "and": region names pass REGION_RE in the market APIs,
 * which rejects "&". None collides with a live City or CityRegion value (checked 2026-10-04).
 */

export interface CityPart {
  /** Saved region value AND the label shown everywhere. */
  name: string;
  /** Feed City values this part covers. */
  members: readonly string[];
  /** A few recognisable neighbourhoods, shown under the chip. Display only. */
  hint: string;
  /** Opening map camera: the median of the part's for-sale listings, 2026-10-04. */
  lat: number;
  lng: number;
  zoom: number;
}

const to = (...codes: string[]) => codes.map((c) => `Toronto ${c}`);

export const TORONTO_PARTS: readonly CityPart[] = [
  {
    name: "Downtown Toronto",
    members: to("C01", "C08"),
    hint: "Waterfront · Church-Yonge · Kensington",
    lat: 43.6505, lng: -79.3881, zoom: 13.5,
  },
  {
    name: "Midtown Toronto",
    members: to("C02", "C03", "C04", "C09", "C10"),
    hint: "Annex · Forest Hill · Yonge-Eglinton · Rosedale",
    lat: 43.6954, lng: -79.4022, zoom: 13,
  },
  {
    name: "North York",
    members: to("C06", "C07", "C12", "C13", "C14", "C15", "W05"),
    hint: "Willowdale · Don Mills · Bayview Village",
    lat: 43.7657, lng: -79.4088, zoom: 12,
  },
  {
    name: "Scarborough",
    members: to("E04", "E05", "E06", "E07", "E08", "E09", "E10", "E11"),
    hint: "Agincourt · Malvern · West Hill",
    lat: 43.7686, lng: -79.2569, zoom: 12,
  },
  {
    name: "East End and East York",
    members: to("E01", "E02", "E03", "C11"),
    hint: "Leslieville · The Beaches · Leaside",
    lat: 43.6824, lng: -79.328, zoom: 13,
  },
  {
    name: "West End and York",
    members: to("W01", "W02", "W03", "W04"),
    hint: "High Park · The Junction · Weston",
    lat: 43.6713, lng: -79.4632, zoom: 13,
  },
  {
    name: "Etobicoke",
    members: to("W06", "W07", "W08", "W09", "W10"),
    hint: "Mimico · Islington · The Kingsway",
    lat: 43.6413, lng: -79.5299, zoom: 12,
  },
];

/** Parent city → its parts. Ottawa joins here once its grouping is approved. */
export const CITY_PARTS: Readonly<Record<string, readonly CityPart[]>> = {
  Toronto: TORONTO_PARTS,
};

/** The parts a chip should open instead of saving, or null for a city followed whole. */
export function partsOf(city: string): readonly CityPart[] | null {
  return CITY_PARTS[city] ?? null;
}

const ALL_PARTS: readonly CityPart[] = Object.values(CITY_PARTS).flat();

/** A part by its saved name (case-insensitive). */
export function partNamed(name: string): CityPart | null {
  const key = (name ?? "").trim().toLowerCase();
  return ALL_PARTS.find((p) => p.name.toLowerCase() === key) ?? null;
}

/** The part a raw feed City value ("Toronto C12") sits in, or null. */
export function partForCity(city: string | null | undefined): CityPart | null {
  const key = (city ?? "").trim().toLowerCase();
  if (!key) return null;
  return ALL_PARTS.find((p) => p.members.some((m) => m.toLowerCase() === key)) ?? null;
}
