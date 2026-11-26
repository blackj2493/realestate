/**
 * Pure steps of scripts/data/buildOntarioChildCare.ts, kept here so they are unit-tested:
 * pick the newest monthly XLSX from the CKAN package, read the snapshot date, and turn the
 * ministry rows into kept centres with a postal-code location.
 */
import { displayName } from "./torontoChildCare";
import { cityTitleCase, normalisePostal, parseProgramOptions, type OntarioChildCareCentre } from "./ontarioChildCare";

export interface CkanResource {
  name?: string | null;
  format?: string | null;
  url?: string | null;
  last_modified?: string | null;
  created?: string | null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** "October 2026" → 202610; anything else → null. */
export function monthlyKey(name: string | null | undefined): number | null {
  const m = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(String(name ?? ""));
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase());
  return mon < 0 ? null : Number(m[2]) * 100 + mon + 1;
}

/**
 * The newest monthly XLSX resource: only XLSX resources whose name parses as "<Month> <YYYY>"
 * count (the data dictionary and unnamed rows do not). Newest = the latest month in the name,
 * then the latest last_modified / created as a tie-break.
 */
export function pickLatestMonthlyResource(resources: CkanResource[]): CkanResource & { url: string } {
  const stamp = (r: CkanResource) => String(r.last_modified ?? r.created ?? "");
  const monthly = resources
    .filter((r) => String(r.format ?? "").toUpperCase() === "XLSX" && r.url && monthlyKey(r.name) !== null)
    .sort((a, b) => monthlyKey(b.name)! - monthlyKey(a.name)! || stamp(b).localeCompare(stamp(a)));
  if (!monthly.length) throw new Error(`no monthly XLSX resource in ${resources.map((r) => r.name || "(unnamed)").join(", ")}`);
  return monthly[0] as CkanResource & { url: string };
}

/** Excel serial (46326), a Date, or "2026-10-31" → "2026-10-31"; null when unreadable. */
export function snapshotIso(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 20000) {
    // Excel day 25569 = 1970-01-01 (the 1900 leap-year bug is before that).
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "string") {
    const d = new Date(v.trim());
    if (/^\d{4}-\d{2}-\d{2}/.test(v.trim())) return v.trim().slice(0, 10);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

export type MinistryRow = Record<string, unknown>;

export interface BuildStats {
  rows: number;
  active: number;
  agencies: number;
  toronto: number;
  schoolAgeOnly: number;
  candidates: number;
  unmatched: number;
  kept: number;
  matchRate: number;
}

const s = (v: unknown) => String(v ?? "").trim();

/**
 * Keep active "Child Care Centre" rows outside the City of Toronto CMSM that run a full day,
 * half day or extended hours, located by postal code. Unmatched postal codes are dropped and
 * counted (matchRate = matched / candidates). Duplicate licence numbers keep the first row.
 */
export function buildOntarioCentres(
  rows: MinistryRow[],
  postal: Map<string, { lat: number; lng: number }>,
): { centres: OntarioChildCareCentre[]; stats: BuildStats } {
  const stats: BuildStats = { rows: rows.length, active: 0, agencies: 0, toronto: 0, schoolAgeOnly: 0, candidates: 0, unmatched: 0, kept: 0, matchRate: 0 };
  const centres: OntarioChildCareCentre[] = [];
  const seen = new Set<string>();
  const r5 = (n: number) => Math.round(n * 1e5) / 1e5;
  for (const r of rows) {
    if (s(r["Licence Status"]).toLowerCase() !== "active") continue;
    stats.active++;
    const type = s(r["Program Type Desc"]).toLowerCase();
    if (type !== "child care centre") {
      if (type.includes("agency")) stats.agencies++;
      continue;
    }
    if (s(r["CMSM DSSAB Name"]).toLowerCase() === "city of toronto") {
      stats.toronto++;
      continue;
    }
    const opt = parseProgramOptions(s(r["Program Option"]));
    if (!opt.keep) {
      stats.schoolAgeOnly++;
      continue;
    }
    const id = s(r["Licence Number"]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    stats.candidates++;
    const pt = postal.get(normalisePostal(s(r["Postal Code"])));
    if (!pt || !Number.isFinite(pt.lat) || !Number.isFinite(pt.lng)) {
      stats.unmatched++;
      continue;
    }
    centres.push({
      id,
      name: displayName(s(r["Child Care Site Name"]) || s(r["Licensee Name"])),
      lat: r5(pt.lat),
      lng: r5(pt.lng),
      city: cityTitleCase(s(r["City"])),
      fullDay: opt.fullDay,
    });
  }
  stats.kept = centres.length;
  stats.matchRate = stats.candidates ? centres.length / stats.candidates : 0;
  return { centres, stats };
}
