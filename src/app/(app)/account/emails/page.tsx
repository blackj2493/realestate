/**
 * /account/emails — the email preference center (engagement plan WS4.1).
 *
 * The store behind it (email_prefs, migration 106) is RLS owner-only, so a real session
 * is required; but email preferences are not VOW data, so — unlike /dashboard — this does
 * NOT require Terms acceptance (a not-yet-unlocked user must still be able to opt down/out).
 *
 * It also lists the homes this person tracks ("Track this home" → address_watches). Those
 * rows are keyed on email and RLS service-only, so they are read here with the service role,
 * filtered to the signed-in user's own email.
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { isStreamLive } from "@/lib/email/streams";
import { addressProfileHref } from "@/lib/search/searchTarget";
import EmailPrefsClient from "@/components/account/EmailPrefsClient";
import TrackedHomes, { type TrackedHome } from "@/components/account/TrackedHomes";

export const dynamic = "force-dynamic";

async function trackedHomesFor(email: string | undefined, recapLive: boolean): Promise<TrackedHome[]> {
  if (!email) return [];
  try {
    // `recap` (migration 155) is read only while the recap is live — arming it requires 155,
    // so before then the column may not exist and must not fail this page.
    const { data, error } = await getServiceRoleClient()
      .from("address_watches")
      .select(recapLive ? "id, address, city, recap" : "id, address, city")
      .eq("email", email.trim().toLowerCase())
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[account/emails] address_watches read failed:", error.message);
      return [];
    }
    return ((data ?? []) as unknown as { id: number; address: string; city: string | null; recap?: boolean | null }[]).map(
      (r) => ({
        id: r.id,
        address: r.address,
        city: r.city,
        href: addressProfileHref(r.city ? `${r.address}, ${r.city}` : r.address),
        recap: r.recap ?? null,
      })
    );
  } catch (e) {
    console.error("[account/emails] address_watches read failed:", e);
    return [];
  }
}

export default async function EmailPrefsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/emails");
  const recapLive = isStreamLive("home_value");
  const homes = await trackedHomesFor(user.email, recapLive);
  return (
    <>
      <EmailPrefsClient />
      <TrackedHomes homes={homes} recapLive={recapLive} />
    </>
  );
}
