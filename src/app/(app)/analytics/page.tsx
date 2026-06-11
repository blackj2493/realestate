/**
 * /analytics — Market Trends terminal. Real per-region sold/active aggregates
 * (median price, $/sqft, sold-to-list, months of inventory, temperature) from
 * the two cached market endpoints. This surface is VOW-derived (raw_vow_sold
 * trends), so it is gated by the same server-side session check as /dashboard
 * (CLAUDE.md §3A) — and both endpoints independently return a locked shape for
 * anonymous callers as defense in depth.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import AnalyticsClient from "./AnalyticsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Market Trends — PureProperty.ca",
  description:
    "Sold-price trends, sales volume, months of inventory and market temperature for any GTA city or neighbourhood.",
};

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/analytics");
  if (!(await hasAcceptedTerms(user.id))) redirect("/welcome?next=/analytics");
  return <AnalyticsClient />;
}
