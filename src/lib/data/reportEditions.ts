/**
 * The published editions of the monthly Ontario Housing Market Report, oldest first. Each is a
 * frozen snapshot (data/reports/{YYYY-MM}.json, scripts/data/buildMonthlyReport.ts), so the
 * page at /data/reports/{YYYY-MM} never changes after it is published.
 *
 * The script's --write adds each new edition here (src/lib/data/registerEdition.ts). Keep the
 * import lines and the one-line EDITIONS array in this shape, or that step fails.
 */
import e202611 from "@/data/reports/2026-11.json";
import type { ReportEdition } from "./monthlyReport";

export const EDITIONS: ReportEdition[] = [e202611 as unknown as ReportEdition];

export function latestEdition(): ReportEdition {
  return EDITIONS[EDITIONS.length - 1];
}

export function editionBySlug(edition: string): ReportEdition | null {
  return EDITIONS.find((e) => e.edition === edition) ?? null;
}
