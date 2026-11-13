/**
 * zonedSchools — the schools whose attendance boundary CONTAINS a home (2026-11).
 *
 * The listing page used to list every school within 2.5 km, nearest first, under a phone
 * label that said "Zoned schools". A reader comparing York Region homes against the board
 * locators found the list wrong: on 3 of 4 detached homes checked 2026-11-13, the first
 * three schools shown included one the home is not zoned for, and on all 4 the zoned
 * Catholic elementary school was missing. The index already carried the right answer in
 * `SchoolCatchments` (`<school_id>|<program>`, point-in-polygon at index time, #579); the
 * page never read it.
 *
 * Pure: parsing, ordering and the "which kinds have no boundary" answer. The API route
 * joins the ids to the schools file; the component renders.
 */

import type { SchoolProgram } from "@/lib/stores/commandCenterStore";

export type SchoolLevel = "elementary" | "secondary";
export type SchoolSystem = "public" | "catholic";

export interface ZonedToken {
  id: string;
  program: SchoolProgram;
}

const PROGRAMS: readonly SchoolProgram[] = ["regular", "french_immersion", "extended_french"];

/** Parse `<school_id>|<program>` tokens. Drops malformed ones and duplicates. */
export function parseZonedTokens(raw: unknown): ZonedToken[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ZonedToken[] = [];
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const [id, program] = t.split("|");
    if (!id || !PROGRAMS.includes(program as SchoolProgram)) continue;
    const key = `${id}|${program}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, program: program as SchoolProgram });
  }
  return out;
}

export interface ZonedSchool {
  id: string;
  name: string;
  level: SchoolLevel;
  system: SchoolSystem;
  program: SchoolProgram;
  score: number | null;
  distanceKm: number;
}

const LEVEL_ORDER: Record<SchoolLevel, number> = { elementary: 0, secondary: 1 };
const SYSTEM_ORDER: Record<SchoolSystem, number> = { public: 0, catholic: 1 };
const PROGRAM_ORDER: Record<SchoolProgram, number> = { regular: 0, french_immersion: 1, extended_french: 2 };

/** Elementary before secondary, public before Catholic, the home school before French programs. */
export function orderZoned<T extends Pick<ZonedSchool, "level" | "system" | "program" | "name">>(list: T[]): T[] {
  return [...list].sort(
    (a, b) =>
      LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] ||
      SYSTEM_ORDER[a.system] - SYSTEM_ORDER[b.system] ||
      PROGRAM_ORDER[a.program] - PROGRAM_ORDER[b.program] ||
      a.name.localeCompare(b.name)
  );
}

export const KIND_LABEL: Record<`${SchoolSystem}-${SchoolLevel}`, string> = {
  "public-elementary": "public elementary",
  "public-secondary": "public secondary",
  "catholic-elementary": "Catholic elementary",
  "catholic-secondary": "Catholic secondary",
};

/**
 * The four English-board kinds (public/Catholic × elementary/secondary) with NO regular
 * zone for this home. Either the board publishes no boundary, or its file has a gap. The
 * page names them, so a missing school reads as "we have no boundary", not "none exists".
 */
export function kindsWithoutZone(zoned: Array<Pick<ZonedSchool, "level" | "system" | "program">>): string[] {
  const have = new Set(zoned.filter((z) => z.program === "regular").map((z) => `${z.system}-${z.level}`));
  return (Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).filter((k) => !have.has(k)).map((k) => KIND_LABEL[k]);
}

export const PROGRAM_LABEL: Record<SchoolProgram, string | null> = {
  regular: null,
  french_immersion: "French Immersion",
  extended_french: "Extended French",
};
