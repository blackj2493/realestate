/**
 * Paths and labels of the monthly Ontario Housing Market Report. Separate from monthlyReport.ts
 * so the sitemap, IndexNow and llms.txt do not load the report builder's database imports.
 */
export const reportPath = (edition?: string) => (edition ? `/data/reports/${edition}` : "/data/reports");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2026-11" → "November 2026". */
export const editionLabel = (e: string) => `${MONTHS[Number(e.slice(5, 7)) - 1]} ${e.slice(0, 4)}`;
export const reportTitle = (edition: string) => `Ontario Housing Market Report: ${editionLabel(edition)}`;
