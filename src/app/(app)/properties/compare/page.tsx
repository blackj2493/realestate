/**
 * /properties/compare?ids=W123,W456 — head-to-head comparison.
 *
 * The decision step of the funnel: the selection set built in the Command Center
 * (or from a listing page) is lined up column-by-column so the winner is obvious.
 * URL-driven so it's shareable and works on a cold load. Capped at 8 columns
 * (mirrors MAX_SELECTED in commandCenterStore) — the table scrolls horizontally
 * past ~5, which is where the Value plot becomes the better "see it all" view.
 */

import type { Metadata } from "next";
import CompareClient from "./CompareClient";
import { getCompareData } from "@/lib/property/getCompareData";
import { getCurrentUser } from "@/lib/supabase/server";
import type { ListingDocument } from "@/lib/typesense/client";

export const metadata: Metadata = {
  title: "Compare Properties | PureProperty",
  robots: { index: false, follow: true },
};

const MAX_COLUMNS = 8;

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

  // Fetch listings + their precomputed estimates server-side so the valuation rows
  // and corrected $/sqft render instantly (no live AVM round-trip).
  const { listings, estimates } = await getCompareData(idList);

  // VOW gate: AVM estimates + stitched True DOM are VOW-derived. For anonymous users
  // never send them to the client — drop the estimates and strip TrueDom (True DOM
  // falls back to raw IDX DOM); CompareClient renders locked cells + a sign-in banner.
  const isAuthed = !!(await getCurrentUser());
  const gatedEstimates = isAuthed ? estimates : {};
  const gatedListings: ListingDocument[] = isAuthed
    ? listings
    : listings.map((l) => ({ ...l, TrueDom: undefined }));

  return (
    <main className="min-h-app bg-slate-950 text-slate-200">
      <CompareClient listings={gatedListings} estimates={gatedEstimates} isAuthed={isAuthed} />
    </main>
  );
}
