/**
 * The current year in Toronto, for page titles.
 *
 * WHY. Ontario home questions carry the year ("toronto price cuts 2026", "average days on
 * market toronto 2026"), and a title without it loses the match to dated news pages. An
 * AI-search panel (2026-11-24, 25 questions) found our pages in none of the results.
 *
 * The pages using this are rebuilt by every deploy and by revalidation, and the site deploys
 * at least daily (the data snapshot commits), so the year turns over within a day of Jan 1.
 */
export function titleYear(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: "America/Toronto" }).format(now));
}
