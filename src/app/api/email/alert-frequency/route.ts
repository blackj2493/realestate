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
 *
 * IT ALSO SERVES THE TWO RECOVERY ACTIONS. Measured over the eight days after the in-email
 * controls shipped: 14 readers unsubscribed, 2 paused, and 0 chose weekly. The links are
 * not broken — both pauses landed — they are simply at the bottom of a long email while the
 * mail client renders its own Unsubscribe button beside the sender name, which is a place
 * this codebase cannot reach. So `resub_weekly` / `resub_daily` are offered where intent is
 * highest and we previously had nothing to say: the unsubscribe confirmation page. They
 * clear `profiles.marketing_opt_out` as well as setting a cadence, which is why they are
 * separate actions — see RESUBSCRIBE_ACTIONS.
 */
import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import {
  frequencyForAction,
  isResubscribe,
  verifyEmailAction,
  type EmailAction,
} from "@/lib/alerts/unsubscribe";

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
  resub_weekly: {
    title: "You're back on — once a week.",
    body: "One email a week with the best of what came up in your areas. You can stop again at any time, from any email.",
  },
  resub_daily: {
    title: "You're back on — every night.",
    body: "You'll get the day's picks again each morning. You can stop again at any time, from any email.",
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

    // RE-CONSENT FIRST, and only for the two recovery actions. A reader arriving here from
    // the unsubscribe confirmation page is opted out, so writing a cadence without clearing
    // the master switch would store a preference that canSendAlerts then ignores — a
    // control that reports success and changes nothing, which is the failure this whole
    // series has been unpicking.
    //
    // ORDER MATTERS. If the opt-out clears and the cadence write then fails, the reader is
    // subscribed at their old frequency: more email than they asked for, but email they did
    // just ask for. The reverse order would leave them opted out with a preference nobody
    // reads, and the page would have lied. Neither is free; this one is recoverable.
    //
    // `marketing_opt_out_at` is deliberately NOT cleared — with 147's
    // `marketing_resubscribed_at` beside it the row keeps the whole consent sequence, which
    // is what CASL asks you to be able to show.
    if (isResubscribe(action)) {
      const resub: Record<string, unknown> = {
        marketing_opt_out: false,
        marketing_resubscribed_at: new Date().toISOString(),
      };
      let { error: optErr } = await sb.from("profiles").update(resub).eq("id", userId);
      if (optErr && /marketing_resubscribed_at/.test(optErr.message)) {
        // 147 not applied yet. Honour the consent the reader just gave rather than refuse
        // it over the audit column — same posture as the 146 fallback below.
        console.warn("[email/alert-frequency] migration 147 not applied — resubscribing without the stamp");
        delete resub.marketing_resubscribed_at;
        ({ error: optErr } = await sb.from("profiles").update(resub).eq("id", userId));
      }
      if (optErr) {
        console.error("[email/alert-frequency] resubscribe failed:", optErr.message);
        return false;
      }
    }

    const patch: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    const frequency = frequencyForAction(action);
    if (frequency) {
      patch.alerts_frequency = frequency;
      // Migration 146. 144's column defaults to 'daily', so the VALUE cannot say whether a
      // reader chose it or some other write filled the row in — two of the three rows in
      // production were created by a pause click. This stamp is the only thing that can,
      // and it is written for BOTH actions: "go back to a nightly email" is a decision, and
      // it is the one that has to survive the derived cadence in digestCadence.ts.
      patch.alerts_frequency_chosen_at = new Date().toISOString();
    } else {
      patch.pause_until = new Date(Date.now() + PAUSE_DAYS * 86_400_000).toISOString();
    }

    // Upsert on user_id, never a blind insert: most readers have no row yet (migration
    // 106's model is that a missing row means every stream is on).
    const { error } = await sb.from("email_prefs").upsert(patch, { onConflict: "user_id" });
    if (!error) return true;

    // Naming a column the database has not got yet fails the WHOLE write, and this one is
    // reached from a link in an email — a reader who pressed "send this weekly" would get
    // "this link couldn't be verified" for as long as 146 sat unapplied. The PREFERENCE is
    // the part that matters; the intent stamp only decides whether a default may later
    // apply. So drop the stamp and write the preference rather than lose both.
    if (/alerts_frequency_chosen_at/.test(error.message)) {
      console.warn("[email/alert-frequency] migration 146 not applied — writing without the intent stamp");
      delete patch.alerts_frequency_chosen_at;
      const retry = await sb.from("email_prefs").upsert(patch, { onConflict: "user_id" });
      if (!retry.error) return true;
      console.error("[email/alert-frequency] upsert failed:", retry.error.message);
      return false;
    }

    console.error("[email/alert-frequency] upsert failed:", error.message);
    return false;
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
