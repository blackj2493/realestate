/**
 * Zoning provenance + attribution registry.
 *
 * Zoning is MUNICIPAL OPEN DATA (not the MLS/listing feed), so anywhere it's shown it MUST
 * carry the source's required attribution string and an "approximate — not a legal survey"
 * disclaimer, and be visually distinct from MLS-derived data. A listing's `zoning_source`
 * field holds a key here; the UI resolves it to the municipality, by-law, and attribution.
 *
 * Scope = the Phase-1 COMMERCIAL-CLEAR sources only (data available AND commercial reuse
 * licensed) — see scripts/admin/zoning-sources.json (`_meta.phase1Scope`). Extend as more
 * sources clear licensing.
 */

export interface ZoningSource {
  /** Stored in the listing's `zoning_source` field. */
  key: string;
  /** e.g. "City of Toronto". */
  municipality: string;
  /** e.g. "Zoning By-law 569-2013". */
  bylaw: string;
  /** Human license name, e.g. "Open Government Licence – Toronto". */
  license: string;
  /** The exact attribution string the license requires to be displayed. */
  attribution: string;
}

/** Shown alongside every zoning value, regardless of source. */
export const ZONING_DISCLAIMER =
  "Zoning is from municipal open data and is approximate — not a legal survey. Confirm with the municipality before relying on it.";

const mk = (key: string, municipality: string, bylaw: string, license: string): ZoningSource => ({
  key,
  municipality,
  bylaw,
  license,
  attribution: `Contains information licensed under the ${license}.`,
});
// County-wide Open Government Licences (one licence covers every member township).
const simcoe = (key: string, municipality: string, bylaw = "Comprehensive Zoning By-law") =>
  mk(key, municipality, bylaw, "Open Government Licence – Simcoe County");
const frontenac = (key: string, municipality: string, bylaw = "Comprehensive Zoning By-law") =>
  mk(key, municipality, bylaw, "Open Government Licence – County of Frontenac");

export const ZONING_SOURCES: Record<string, ZoningSource> = {
  // ── Individually-licensed cities ─────────────────────────────────────────
  toronto: mk("toronto", "City of Toronto", "Zoning By-law 569-2013", "Open Government Licence – Toronto"),
  hamilton: mk("hamilton", "City of Hamilton", "Zoning By-law 05-200", "City of Hamilton Open Data Licence"),
  london: mk("london", "City of London", "Zoning By-law Z.-1", "City of London Open Data Terms of Use"),
  oakville: mk("oakville", "Town of Oakville", "Zoning By-law 2014-014", "Open Government Licence – Town of Oakville"),
  barrie: mk("barrie", "City of Barrie", "Comprehensive Zoning By-law", "Open Government Licence – Barrie"),
  burlington: mk("burlington", "City of Burlington", "Zoning By-law 2020", "City of Burlington Open Data Terms of Use"),
  oshawa: mk("oshawa", "City of Oshawa", "Zoning By-law 60-94", "Open Government Licence v2.0 – Oshawa"),
  kingston: mk("kingston", "City of Kingston", "Zoning By-law 2022-62", "Open Data Licence – City of Kingston"),
  milton: mk("milton", "Town of Milton", "Zoning By-law 016-2014", "Open Government Licence – Milton"),
  "niagara-falls": mk("niagara-falls", "City of Niagara Falls", "Zoning By-law 79-200", "Open Government Licence 2.0 – Niagara Falls"),

  // ── Simcoe County OGL (one licence, 11 townships) ────────────────────────
  springwater: simcoe("springwater", "Township of Springwater"),
  innisfil: simcoe("innisfil", "Town of Innisfil"),
  "oro-medonte": simcoe("oro-medonte", "Township of Oro-Medonte"),
  tiny: simcoe("tiny", "Township of Tiny"),
  clearview: simcoe("clearview", "Township of Clearview", "Zoning By-law 06-54"),
  "wasaga-beach": simcoe("wasaga-beach", "Town of Wasaga Beach"),
  severn: simcoe("severn", "Township of Severn"),
  midland: simcoe("midland", "Town of Midland"),
  ramara: simcoe("ramara", "Township of Ramara"),
  "new-tecumseth": simcoe("new-tecumseth", "Town of New Tecumseth", "Zoning By-law 2021"),
  "bradford-west-gwillimbury": simcoe("bradford-west-gwillimbury", "Town of Bradford West Gwillimbury"),

  // ── Frontenac County OGL (one licence, 4 townships) ──────────────────────
  "north-frontenac": frontenac("north-frontenac", "Township of North Frontenac"),
  "central-frontenac": frontenac("central-frontenac", "Township of Central Frontenac", "Zoning By-law 2022"),
  "south-frontenac": frontenac("south-frontenac", "Township of South Frontenac"),
  "frontenac-islands": frontenac("frontenac-islands", "Township of Frontenac Islands"),
};

/** Resolve a listing's `zoning_source` key to its provenance record (null if absent/unknown). */
export function zoningSource(key?: string | null): ZoningSource | null {
  if (!key) return null;
  return ZONING_SOURCES[key] ?? null;
}

/** Compact provenance label for the UI, e.g. "City of Toronto · Zoning By-law 569-2013". */
export function zoningLabel(source: ZoningSource): string {
  return `${source.municipality} · ${source.bylaw}`;
}
