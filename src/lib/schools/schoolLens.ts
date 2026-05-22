/**
 * School-quality lens helpers (browser-safe; no fs).
 *
 * A Level×System lens resolves to exactly one indexed Typesense score field, so the
 * min-score filter, the sort, and the map shading all key off the same field.
 */
import type { SchoolLevel, SchoolSystem } from "@/lib/stores/commandCenterStore";
import type { ListingDocument } from "@/lib/typesense/client";

export type SchoolScoreField =
  | "ElemPublicScore"
  | "ElemCatholicScore"
  | "SecPublicScore"
  | "SecCatholicScore"
  | "BestElementaryScore"
  | "BestSecondaryScore";

/** Indexed score field for a lens. "either" system → the best-of rollup. */
export function schoolScoreField(level: SchoolLevel, system: SchoolSystem): SchoolScoreField {
  if (level === "elementary") {
    if (system === "public") return "ElemPublicScore";
    if (system === "catholic") return "ElemCatholicScore";
    return "BestElementaryScore";
  }
  if (system === "public") return "SecPublicScore";
  if (system === "catholic") return "SecCatholicScore";
  return "BestSecondaryScore";
}

/** Display-cargo name field for a concrete-system lens (no name field for "either"). */
export function schoolNameField(
  level: SchoolLevel,
  system: SchoolSystem
): keyof ListingDocument | null {
  if (system === "either") return null;
  if (level === "elementary") return system === "public" ? "ElemPublicSchool" : "ElemCatholicSchool";
  return system === "public" ? "SecPublicSchool" : "SecCatholicSchool";
}

export const SCHOOL_LEVEL_LABEL: Record<SchoolLevel, string> = {
  elementary: "Elementary",
  secondary: "Secondary",
};

export const SCHOOL_SYSTEM_LABEL: Record<SchoolSystem, string> = {
  public: "Public",
  catholic: "Catholic",
  either: "Either",
};
