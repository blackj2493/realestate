/**
 * GET /api/email/alert-frequency?e=<email>&a=<action>&s=<hmac>
 *
 * The controls short of Unsubscribe, worked from inside the nightly digest.
 *
 * Before this, a reader who found the digest too frequent had one button in the email and
 * it was Unsubscribe; 46 of 505 profiles had pressed it. The filter nudge pointed at
 * /dashboard, which most of these readers have never opened. So the two decisions that
 * actually reduce volume — send it weekly, stop it for a month — now happen in one click,
 * with no login, exactly like the unsubscribe link beside them.
 *
 * Auth is the same HMAC-of-the-email the unsubscribe routes use, with the ACTION folded
 * into the signature so one link cannot be edited into another. GET only: these are
 * human-clicked footer links, not an RFC 8058 one-click target, and they are idempotent.
 */
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyEmailAction, type EmailAction } from "@/lib/alerts/unsubscribe";

export const dynamic = "force-dynamic";

const PAUSE_DAYS = 30;

const DONE: Record<EmailAction, { title: string; body: string }> = {
  weekly: {
    title: "You'll get this once a week.",
    body: `We'll gather the week's best and send one email instead of one a night. Nothing is lost in between — the homes stack up and arrive together.`,
  },
  daily: {
    title: "You're back to a nightly email.",
    body: "You'll get the day's picks each morning again.",
  },
  pause30: {
    title: `Paused for ${PAUSE_DAYS} days.`,
    body: "We won't email you until then. Your saved homes and areas stay exactly as they are.",
  },
};

/** Apply one action to the user's email_prefs row. Idempotent; creates the row if absent. */
async function apply(email: string, action: EmailAction): Promise<boolean> {
  const e = email.trim().toLowerCase();
  try {
    const sb = getServiceRoleClient();
    // email_prefs is keyed by user_id, so the signed email has to resolve to a profile
    // first. An address with no profile is not an error the reader can act on — it is an
    // old link for a deleted account — and it must not create an orphan row.
    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("id")
      .ilike("email", e)
      .maybeSingle();
    if (profileErr) {
      console.error("[email/alert-frequency] profile lookup failed:", profileErr.message);
      return false;
    }
    const userId = (profile as { id?: string } | null)?.id;
    if (!userId) return false;

    const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    if (action === "weekly" || action === "daily") {
      patch.alerts_frequency = action;
    } else {
      patch.pause_until = new Date(Date.now() + PAUSE_DAYS * 86_400_000).toISOString();
    }

    // Upsert on user_id, never a blind insert: most readers have no row yet (migration
    // 106's model is that a missing row means every stream is on).
    const { error } = await sb.from("email_prefs").upsert(patch, { onConflict: "user_id" });
    if (error) {
      console.error("[email/alert-frequency] upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email/alert-frequency] threw:", err);
    return false;
  }
}

function page(ok: boolean, action: EmailAction | null): string {
  const done = ok && action ? DONE[action] : null;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 20px;color:#0f172a;">
  <div style="font-size:16px;font-weight:700;">${done ? done.title : "This link couldn't be verified."}</div>
  <p style="color:#475569;font-size:14px;line-height:1.6;">${
    done
      ? done.body
      : "Please use a link from a recent email, or change this from your dashboard."
  }</p>
  <a href="https://www.pureproperty.ca/account/emails" style="color:#0891b2;text-decoration:none;font-weight:600;font-size:14px;">All email settings &rarr;</a>
</div>`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get("e") || "";
  const action = searchParams.get("a") || "";
  const sig = searchParams.get("s") || "";
  const ok = verifyEmailAction(email, action, sig) && (await apply(email, action as EmailAction));
  return new NextResponse(page(ok, ok ? (action as EmailAction) : null), {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
