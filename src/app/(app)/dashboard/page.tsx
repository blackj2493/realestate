/**
 * /dashboard — the personalized investor command center (watchlist, region
 * scorecards, market activity, sold-price pulse). This surface is dense with VOW
 * and VOW-derived data, so it is gated by a REAL server-side session check
 * (CLAUDE.md §3A: an account is required to view sold data).
 *
 * Signed-out visitors get DashboardCityView: the live Toronto market (public aggregates,
 * active IDX listings, sold ADDRESSES with the price locked) and locked personal panels,
 * instead of a redirect to /login. Nothing personal or VOW-gated is fetched on that path;
 * DashboardClient never mounts for them.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import DashboardCityView from "@/components/dashboard/DashboardCityView";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return <DashboardCityView />;
  // When Terms enforcement is on, an un-accepted user is routed to the one-time gate.
  if (!(await hasAcceptedTerms(user.id))) redirect("/welcome?next=/dashboard");
  return <DashboardClient />;
}
