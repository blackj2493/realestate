/**
 * /dashboard — the personalized investor command center (watchlist, region
 * scorecards, market activity, sold-price pulse). This surface is dense with VOW
 * and VOW-derived data, so it is gated by a REAL server-side session check
 * (CLAUDE.md §3A: an account is required to view sold data).
 *
 * Signed-out visitors get the SAME dashboard with Toronto as the market (2026-11),
 * not a redirect and not a grey preview. Toronto is held in memory and never saved.
 * VOW data stays locked: the market APIs strip it for anonymous callers (getConsumer),
 * and the True DOM board does not fetch at all. Personal parts link to sign-up.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return <DashboardClient signedOut />;
  // When Terms enforcement is on, an un-accepted user is routed to the one-time gate.
  if (!(await hasAcceptedTerms(user.id))) redirect("/welcome?next=/dashboard");
  return <DashboardClient />;
}
