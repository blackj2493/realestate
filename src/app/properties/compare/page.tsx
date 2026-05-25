/**
 * /properties/compare?ids=W123,W456 — head-to-head comparison.
 *
 * The decision step of the funnel: the selection set built in the Command Center
 * (or from a listing page) is lined up column-by-column so the winner is obvious.
 * URL-driven so it's shareable and works on a cold load. Capped at 4 columns.
 */

import type { Metadata } from "next";
import CompareClient from "./CompareClient";

export const metadata: Metadata = {
  title: "Compare Properties | PureProperty",
  robots: { index: false, follow: true },
};

const MAX_COLUMNS = 4;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const idList = (ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COLUMNS);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-200">
      <CompareClient ids={idList} />
    </main>
  );
}
