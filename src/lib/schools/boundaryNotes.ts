/**
 * Known gaps between a board's published boundary file and the board's own decisions.
 *
 * We draw only what the board publishes, and we do not hand-draw a correction: a line
 * traced from a decision-letter PDF puts a house near the edge in the wrong school while
 * looking official, and the next harvest would overwrite it anyway. Where we know the
 * file is behind, the map says so on the zone instead.
 *
 * Keyed by board + school_name exactly as `geo_features.attrs` stores them. A note is
 * shown for every program of that school. Remove an entry once the board's file catches up.
 *
 * TDSB (reported 2026-10-20): the Yonge-Eglinton review (board decision 2021-06-28) gave
 * John Fisher an English boundary carved from Eglinton's; the 2025-26 file has John Fisher
 * as French Immersion only. Bannockburn reopened in 2024 as FI-only with a zone built from
 * Bedford Park, John Wanless and Blythwood; the file draws it elsewhere.
 */

const TDSB_LOCATOR = "Check the TDSB school locator before you rely on it.";

const NOTES: Record<string, Record<string, string>> = {
  "Toronto DSB": {
    "John Fisher Junior Public School": `TDSB changed this boundary, and its published file does not show the English zone yet. ${TDSB_LOCATOR}`,
    "Eglinton Junior Public School": `TDSB moved part of this zone to John Fisher, and its published file does not show the change yet. ${TDSB_LOCATOR}`,
    "Bannockburn Public School": `TDSB set this French Immersion zone when the school reopened in 2024, and its published file may not match. ${TDSB_LOCATOR}`,
  },
};

/** The note for a zone, or null. Both names match exactly ("Toronto Catholic DSB" is a
 *  different board, so a prefix match would be wrong). */
export function boundaryNote(board?: string | null, schoolName?: string | null): string | null {
  if (!board || !schoolName) return null;
  return NOTES[board]?.[schoolName] ?? null;
}
