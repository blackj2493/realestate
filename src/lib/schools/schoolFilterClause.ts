/**
 * The Typesense clause behind "school" — a catchment when we hold one, a radius when we do
 * not, and copy that says which.
 *
 * WHY BOTH. Filtering by attendance boundary is the behaviour a reader expects: pick a
 * school, see the homes assigned to it. But boundaries are published by school boards, and
 * not every board publishes every program — TCDSB has no French Immersion layer at all (its
 * zones are derived from feeder attributes), TDSB publishes no FI polygon (ours are
 * reconstructed from the address lookup), and several boards publish nothing. A filter that
 * silently returns zero results for those schools would be a worse answer than a radius.
 *
 * So the rule is: use the boundary when one exists for that school AND that program;
 * otherwise fall back to the 2.5 km `NearbySchools` radius — and SAY SO in the chip, because
 * the two answer different questions and a reader comparing the list against the drawn zone
 * deserves to know which one they are looking at.
 *
 * The bug that produced this: 27 Coach Liteway sits inside St Cyril's 57.6 km² French
 * Immersion zone and 2.75 km from the school. A search for St Cyril excluded it by 250 m,
 * while the map drew the boundary it sits inside.
 */

import type { SchoolProgram } from "@/lib/stores/commandCenterStore";
import { catchmentToken } from "./catchmentMembership";

/** What the school-search API returns and the store holds. */
export interface TargetSchool {
  id: string;
  name: string;
  /**
   * Programs this school publishes a catchment for. Absent on a target chosen before this
   * shipped (or by a client that has not refreshed), which is read as "none" — the radius
   * fallback, i.e. exactly today's behaviour.
   */
  programs?: SchoolProgram[];
}

export type SchoolFilterMode = "catchment" | "radius";

export interface SchoolFilterClause {
  /** The Typesense filter fragment. */
  clause: string;
  mode: SchoolFilterMode;
  /** Chip text, so the reader can tell a boundary answer from a proximity one. */
  label: string;
}

/** Backticks are stripped: no legitimate school id or program contains one. */
const safe = (s: string) => s.replace(/`/g, "");

export const PROGRAM_LABEL: Record<SchoolProgram, string> = {
  regular: "catchment",
  french_immersion: "French Immersion catchment",
  extended_french: "Extended French catchment",
};

/**
 * Build the clause for a chosen school.
 *
 * `program` is the axis the reader already picked in the panel. A school with no catchment
 * for that program falls back to distance rather than returning nothing, and the label
 * changes so the difference is visible rather than inferred from a short list.
 */
export function buildSchoolFilterClause(
  target: TargetSchool,
  program: SchoolProgram
): SchoolFilterClause {
  const hasCatchment = (target.programs ?? []).includes(program);

  if (hasCatchment) {
    return {
      clause: `SchoolCatchments:=\`${safe(catchmentToken(target.id, program))}\``,
      mode: "catchment",
      label: `In ${target.name}'s ${PROGRAM_LABEL[program]}`,
    };
  }

  return {
    clause: `NearbySchools:=\`${safe(target.id)}\``,
    mode: "radius",
    // Names the radius rather than the school, because that is what the reader is getting.
    // "Near X" reads as an attendance claim; "Within 2.5 km of X" cannot be misread.
    label: `Within 2.5 km of ${target.name}`,
  };
}
