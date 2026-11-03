/**
 * /dashboard — the personalized investor command center (watchlist, region
 * scorecards, market activity, sold-price pulse). This surface is dense with VOW
 * and VOW-derived data, so it is gated by a REAL server-side session check
 * (CLAUDE.md §3A: an account is required to view sold data).
 *
 * Signed-out visitors get a LOCKED preview (DashboardTeaser: section names, grey shapes,
 * one sign-in overlay) instead of a redirect to /login (2026-11). Nothing personal or
 * VOW-derived is fetched on that path; DashboardClient never mounts for them.
 */

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import DashboardTeaser from "@/components/dashboard/DashboardTeaser";
import DashboardClient from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return <DashboardTeaser />;
  // When Terms enforcement is on, an un-accepted user is routed to the one-time gate.
  if (!(await hasAcceptedTerms(user.id))) redirect("/welcome?next=/dashboard");
  return <DashboardClient />;
}
