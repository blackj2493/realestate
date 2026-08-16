/**
 * Findings registry — dated analysis built on the live trackers.
 *
 * WHY A FINDING IS NOT A TRACKER. A tracker is a reference work: it updates nightly,
 * it has no thesis, and it accumulates links slowly because people keep needing the
 * current number. A finding is news: it argues something specific about a moment,
 * it is stamped with the date it was true, and it gets linked hard for a few weeks
 * and then goes quiet. Both are worth having and neither substitutes for the other —
 * a reporter cites the finding for the story and the tracker for the number.
 *
 * WHY NOT A BLOG. A blog implies cadence, and cadence pressure fills the space with
 * whatever was available that week. Findings ship when the data says something, and
 * the container says what it is: analysis from a data desk, not a realtor's news
 * page. It also keeps every piece inside /data, which is the part of the site built
 * to be cited and the part the compliance and novelty guards already cover.
 *
 * EVERY FINDING NAMES A TRACKER (`trackerSlug`). That is the whole architecture in
 * one field. The finding sends readers to the live data; the tracker sends readers
 * to the analysis explaining it. A finding with no tracker behind it is an opinion
 * piece, and this desk does not publish those.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PRIOR-ART GATE applies here too, and harder.
 *
 * The rule and the reason live in `trackers.ts`; read them there. It bites harder on
 * a finding because a finding is written to be pitched, and a false novelty claim
 * that reaches a reporter who knows the beat does not get corrected — it discredits
 * every other number in the piece, including the ones that were genuinely new.
 *
 * This is not hypothetical for this file's first entry. The draft of it carried the
 * sentence "No Canadian source has published it before" about the over-ask rate,
 * three weeks after the same claim was corrected in production, because it was
 * written outside the repo where nothing scanned it. Findings live in `src/app/data`
 * so `noveltyClaims.test.ts` walks them automatically.
 *
 * State the DIFFERENCE — statistic, coverage, cadence, source — and name who else
 * measures it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type FindingStatus = "live" | "draft";

export interface FindingDef {
  /** URL segment under /data/findings/<slug>. Never reuse or rename one that shipped. */
  slug: string;
  /** The page's <h1> and the headline everywhere it is referenced. */
  title: string;
  /** <title> tag — may differ from the h1 to carry the query terms. */
  seoTitle: string;
  /** The deck: one or two sentences stating the finding, with the numbers in them. */
  standfirst: string;
  /** Meta description. */
  description: string;
  /** Eyebrow kicker (masthead + OG image). */
  eyebrow: string;
  /** ISO date the analysis was published. Stamped, because a finding is a snapshot. */
  published: string;
  /** ISO date of the last substantive revision, when there has been one. */
  updated?: string;
  /**
   * The live tracker this reads from. Required — see the note above. Must be a slug
   * in TRACKERS; the finding page links to it and the tracker links back.
   */
  trackerSlug: string;
  /** What the analysis is computed over, shown in the byline. */
  basis: string;
  /** Geographic/temporal scope, shown in the byline. */
  coverage: string;
  status: FindingStatus;
}

export const FINDINGS: FindingDef[] = [
  {
    // PRIOR ART: Wahi has published a monthly GTA overbid/underbid report since July
    // 2022, and Redfin has run "share sold above final list price" in the US for
    // years. This piece does not claim the metric is new. What it claims is the cut:
    // individual sales against their own final ask, province-wide at neighbourhood
    // grain, with the premium reported alongside the rate — which is what makes the
    // convergence visible at all, since a city-level series cannot show it.
    slug: "ontario-over-asking-convergence",
    title: "Ontario's bidding wars are converging",
    seoTitle: "Ontario's Bidding Wars Are Converging — Over-Asking Rates by Neighbourhood",
    standfirst:
      "The share of Ontario houses selling above the asking price fell by more than five points in a year — but almost all of that came out of the hottest neighbourhoods. The province's most competitive markets lost 12 points. Its coldest lost less than two.",
    description:
      "Ontario's over-asking rate fell from 23.2% to 18.1% in twelve months, but the decline was concentrated in the hottest neighbourhoods: the top quarter lost 11.9 points while the coldest lost 1.6. Analysis of 118,381 closed MLS® sales across 1,156 neighbourhoods.",
    eyebrow: "PureProperty Data Desk",
    published: "2026-08-16",
    trackerSlug: "over-asking",
    basis: "118,381 closed MLS® sales, 12 months to August 2026",
    coverage: "1,156 Ontario neighbourhoods",
    status: "live",
  },
];

export function findingBySlug(slug: string): FindingDef | undefined {
  return FINDINGS.find((f) => f.slug === slug);
}

/** Newest first — the order the index renders and the order a reader expects. */
export const LIVE_FINDINGS: FindingDef[] = FINDINGS.filter((f) => f.status === "live").sort(
  (a, b) => b.published.localeCompare(a.published),
);

/** Live findings that read from a given tracker, so the tracker can link back. */
export function findingsForTracker(trackerSlug: string): FindingDef[] {
  return LIVE_FINDINGS.filter((f) => f.trackerSlug === trackerSlug);
}
