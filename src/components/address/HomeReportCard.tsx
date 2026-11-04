"use client";

/**
 * HomeReportCard — "Get the full report on this home" (2026-11).
 *
 * WHY. Our listing and sale history reaches back only to mid-2024 (the board feed serves
 * about 24 months), while the main competitor advertises sales back to 2003. A page cannot
 * show history we do not hold, but a person can prepare it. This card turns that gap into
 * a request: anyone weighing this home asks for a written report and we send it.
 *
 * It promises MORE than the history (owner: "everyone gives history"): what changed between
 * sales, a worth-today read against the street, and what to check before buying. Owner
 * wording rule: no "REALTOR" and no "MLS" on this card. No figure is shown on the page.
 */

import OfferRequestCard, { type OfferCopy } from "./OfferRequestCard";

export const HOME_REPORT_COPY: OfferCopy = {
  title: "Get the full report on this home",
  intro: "We put it together for you and send it by email:",
  points: [
    "every time it was listed, sold or leased, with each price change",
    "what changed between sales, such as renovations and additions",
    "what it is likely worth today, compared with recent sales on the street",
    "what to check before you buy: flood zones, rail lines, permits and the school catchment",
  ],
  footnote: "Free, sent to your inbox. No calls unless you ask for one.",
  openLabel: "Send me the report",
  sentText: (address, email) => `Request sent. The report on ${address} is on its way to ${email}.`,
  messagePlaceholder: "e.g. thinking of making an offer, or just curious what it sold for before",
};

export default function HomeReportCard({ address }: { address: string }) {
  return <OfferRequestCard address={address} intent="home_report" copy={HOME_REPORT_COPY} />;
}
