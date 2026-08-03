/**
 * /account/emails — the email preference center (engagement plan WS4.1).
 *
 * The store behind it (email_prefs, migration 106) is RLS owner-only, so a real session
 * is required; but email preferences are not VOW data, so — unlike /dashboard — this does
 * NOT require Terms acceptance (a not-yet-unlocked user must still be able to opt down/out).
 */
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import EmailPrefsClient from "@/components/account/EmailPrefsClient";

export const dynamic = "force-dynamic";

export default async function EmailPrefsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/account/emails");
  return <EmailPrefsClient />;
}
