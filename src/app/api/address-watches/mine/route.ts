import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/client";

export const dynamic = "force-dynamic";

/**
 * The signed-in person's own address watches, managed from /account/emails.
 *
 * OWNERSHIP IS THE SESSION'S EMAIL. address_watches is keyed on email (no user_id) and is RLS
 * service-only, so every write here filters on the row id AND the verified session email: a
 * row that is not theirs matches nothing and returns 404. The POST route lowercases emails on
 * the way in, so the comparison is lowercased too.
 *
 *   PATCH { id, stop: true }       stop tracking this home (status → unsubscribed)
 *   PATCH { id, recap: boolean }   the monthly Street Recap for this home (migration 155)
 */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ success: false, error: "Sign in required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; stop?: unknown; recap?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ success: false, error: "Invalid id" }, { status: 400 });
  }

  let patch: { status: "unsubscribed" } | { recap: boolean };
  if (body?.stop === true) patch = { status: "unsubscribed" };
  else if (typeof body?.recap === "boolean") patch = { recap: body.recap };
  else return NextResponse.json({ success: false, error: "Nothing to change" }, { status: 400 });

  const { data, error } = await getServiceRoleClient()
    .from("address_watches")
    .update(patch)
    .eq("id", id)
    .eq("email", email)
    .select("id");
  if (error) {
    console.error("[address-watches/mine] update failed:", error.message);
    return NextResponse.json({ success: false, error: "Could not save" }, { status: 500 });
  }
  if (!data?.length) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
