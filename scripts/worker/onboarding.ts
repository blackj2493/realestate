/**
 * Onboarding sequence engine (engagement build plan WS1.2 + 1.3 + 5.1).
 *
 * A daily GHA step (piggybacking the once-a-day sync, like the alerts worker) that decides
 * "who is due which onboarding email" from each user's REAL milestone state and sends it,
 * recording the send in user_email_lifecycle so a re-run never double-sends.
 *
 * Messages (Phase 0):
 *   finish_account        — started but not finished. Two sub-cases share one message id:
 *                             (a) account exists but VOW terms not accepted (1.3) → cta /welcome
 *                             (b) applied at /apply but no account yet (5.1)      → cta /login
 *   onboarding_add_area   — unlocked, no saved area (2B) → the Woodbridge example, live
 *   onboarding_dashboard  — unlocked, has a saved area (2A) → get-more education
 *   onboarding_save_home  — unlocked ≥4d, no saved homes (#3)
 *
 * Gating (src/lib/email/sendPolicy.canSendOnboarding): marketing_opt_out (master),
 * email_prefs (stream/cadence/pause), lifecycle idempotency, and the frequency cap.
 * Idempotent like the alerts worker: the message is stamped into `sent` ONLY after the
 * send succeeds, so a failure retries on the next run.
 *
 * Invoke: npx tsx scripts/worker/onboarding.ts [--dry]
 * Env:    SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, RESEND_API_KEY,
 *         NEXT_PUBLIC_SITE_URL, NEXT_PUBLIC_TYPESENSE_SEARCH_ONLY_API_KEY (for 2B's live
 *         example data), (optional) ONBOARDING_DRY_RUN=1
 */

import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { SENDERS } from "@/lib/alerts/senders";
import { sendTransactionalEmail } from "@/lib/alerts/sendEmail";
import { SITE } from "@/lib/alerts/emailShell";
import { marketingUnsubscribeUrl } from "@/lib/alerts/unsubscribe";
import {
  renderDashboardEducationEmail,
  renderAddAreaEmail,
  renderSaveHomeEmail,
  renderFinishAccountEmail,
  type OnboardingAreaData,
} from "@/lib/alerts/onboardingEmails";
import { buildExampleAreaData } from "@/lib/alerts/onboardingData";
import { canSendOnboarding, type EmailPrefsRow, type LifecycleRow } from "@/lib/email/sendPolicy";

const DAY = 86_400_000;
// Timing gates (days). Kept modest for Phase 0; tune once activation data lands.
const FINISH_MIN_DAYS = 1;
const FINISH_MAX_DAYS = 14; // stop nagging after two weeks
const DRIP_MIN_DAYS = 2; // 2A/2B after unlock
const SAVE_HOME_MIN_DAYS = 4; // #3 after unlock
const LEAD_WINDOW_DAYS = 14; // how far back to look for abandoned /apply leads

const DRY = process.argv.includes("--dry") || process.env.ONBOARDING_DRY_RUN === "1";
const MANAGE_URL = `${SITE}/account/emails`; // the preference center (WS4.1)

type SB = ReturnType<typeof getServiceRoleClient>;

interface Rendered { subject: string; html: string; text: string }
interface Due { messageId: string; rendered: Rendered }

interface LifecycleFull extends LifecycleRow {
  email: string;
  user_id: string | null;
  first_seen_at: string | null;
}

// ── State loaders (service-role bypasses RLS) ──────────────────────────────────

async function loadPrefs(sb: SB, userId: string): Promise<EmailPrefsRow | null> {
  const { data } = await sb
    .from("email_prefs")
    .select("onboarding, cadence, pause_until")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as EmailPrefsRow | null) ?? null;
}

async function loadLifecycle(sb: SB, email: string): Promise<LifecycleFull | null> {
  const { data } = await sb
    .from("user_email_lifecycle")
    .select("email, user_id, sent, last_sent_at, first_seen_at")
    .eq("email", email)
    .maybeSingle();
  return (data as LifecycleFull | null) ?? null;
}

async function loadRegions(sb: SB, userId: string): Promise<string[]> {
  const { data } = await sb
    .from("dashboard_prefs")
    .select("config")
    .eq("user_id", userId)
    .maybeSingle();
  const regions = (data?.config as { regions?: unknown } | null)?.regions;
  return Array.isArray(regions) ? (regions.filter((r) => typeof r === "string") as string[]) : [];
}

async function hasWatchlist(sb: SB, userId: string): Promise<boolean> {
  const { count } = await sb
    .from("watchlist")
    .select("listing_key", { count: "exact", head: true })
    .eq("user_id", userId);
  return (count ?? 0) > 0;
}

// Record a successful send: merge sent[messageId] + stamp last_sent_at. Upsert on email
// so the pre-account lead and the later account share one lifecycle row.
async function stampSent(
  sb: SB,
  email: string,
  userId: string | null,
  messageId: string,
  lc: LifecycleFull | null,
  nowIso: string
): Promise<void> {
  const sent = { ...(lc?.sent ?? {}), [messageId]: nowIso };
  const { error } = await sb.from("user_email_lifecycle").upsert(
    {
      email,
      user_id: userId ?? lc?.user_id ?? null,
      sent,
      last_sent_at: nowIso,
      first_seen_at: lc?.first_seen_at ?? nowIso,
      updated_at: nowIso,
    },
    { onConflict: "email" }
  );
  if (error) console.error("[onboarding] lifecycle upsert failed", email, error.message);
}

async function deliver(email: string, from: string, replyTo: string | undefined, r: Rendered, uUrl: string): Promise<boolean> {
  if (DRY) {
    console.log(`[onboarding] DRY would send "${r.subject}" → ${email}`);
    return true;
  }
  const res = await sendTransactionalEmail({
    kind: "onboarding",
    from,
    replyTo,
    to: email,
    subject: r.subject,
    html: r.html,
    text: r.text,
    headers: {
      "List-Unsubscribe": `<${uUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  return res.sent;
}

async function main(): Promise<void> {
  if (!process.env.RESEND_API_KEY && !DRY) {
    console.warn("[onboarding] RESEND_API_KEY unset — skipping (set ONBOARDING_DRY_RUN=1 to test).");
    return;
  }
  const sb = getServiceRoleClient();

  // Fail-closed: the idempotency table (migration 105) MUST exist before we send
  // anything, or a re-run would re-send every email (no `sent` bookkeeping to persist).
  // If it's absent (deploy landed before the migration was applied), skip the whole run.
  const probe = await sb.from("user_email_lifecycle").select("email", { head: true, count: "exact" });
  if (probe.error) {
    console.warn(
      "[onboarding] user_email_lifecycle unavailable — skipping (apply migration 105 first):",
      probe.error.message
    );
    return;
  }

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const from = SENDERS.welcome.from;
  const replyTo = SENDERS.welcome.replyTo;

  // 2B's example area is the same for everyone — fetch once, lazily (only if a 2B fires).
  let exampleArea: OnboardingAreaData | null | undefined;
  const getExample = async () => {
    if (exampleArea === undefined) exampleArea = await buildExampleAreaData();
    return exampleArea;
  };

  let sent = 0;
  let considered = 0;

  // ── Account population: load all profiles (paged, like the alerts worker) ──────
  const PAGE = 1000;
  const accountEmails = new Set<string>();
  for (let offset = 0; ; offset += PAGE) {
    const { data: profiles, error } = await sb
      .from("profiles")
      .select("id, email, created_at, terms_accepted_at, marketing_opt_out")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("[onboarding] profiles read failed:", error.message);
      break;
    }
    if (!profiles || profiles.length === 0) break;

    for (const p of profiles) {
      const email = (p.email as string | null)?.trim().toLowerCase();
      if (email) accountEmails.add(email);
      if (!email || !p.created_at) continue;
      considered++;

      const createdMs = Date.parse(p.created_at as string);
      const optOut = (p as { marketing_opt_out?: boolean }).marketing_opt_out === true;
      const prefs = await loadPrefs(sb, p.id as string);
      const lc = await loadLifecycle(sb, email);
      const uUrl = marketingUnsubscribeUrl(email, SITE);

      let due: Due | null = null;

      if (!p.terms_accepted_at) {
        // 1.3 — has an account but never accepted VOW terms.
        const days = (now - createdMs) / DAY;
        if (days >= FINISH_MIN_DAYS && days <= FINISH_MAX_DAYS) {
          const messageId = "finish_account";
          if (canSendOnboarding({ messageId, now, marketingOptOut: optOut, prefs, lifecycle: lc })) {
            due = {
              messageId,
              rendered: renderFinishAccountEmail({ ctaUrl: `${SITE}/welcome`, unsubscribeUrl: uUrl }),
            };
          }
        }
      } else {
        const unlockedDays = (now - Date.parse(p.terms_accepted_at as string)) / DAY;
        if (unlockedDays >= DRIP_MIN_DAYS) {
          const regions = await loadRegions(sb, p.id as string);
          if (regions.length === 0) {
            const messageId = "onboarding_add_area";
            if (canSendOnboarding({ messageId, now, marketingOptOut: optOut, prefs, lifecycle: lc })) {
              due = {
                messageId,
                rendered: renderAddAreaEmail({ example: await getExample(), unsubscribeUrl: uUrl, manageUrl: MANAGE_URL }),
              };
            }
          } else {
            const messageId = "onboarding_dashboard";
            if (canSendOnboarding({ messageId, now, marketingOptOut: optOut, prefs, lifecycle: lc })) {
              due = {
                messageId,
                rendered: renderDashboardEducationEmail({ areaName: regions[0], unsubscribeUrl: uUrl, manageUrl: MANAGE_URL }),
              };
            }
          }
        }
        // #3 — only if nothing higher in the sequence fired this run.
        if (!due && unlockedDays >= SAVE_HOME_MIN_DAYS) {
          const messageId = "onboarding_save_home";
          if (
            canSendOnboarding({ messageId, now, marketingOptOut: optOut, prefs, lifecycle: lc }) &&
            !(await hasWatchlist(sb, p.id as string))
          ) {
            due = { messageId, rendered: renderSaveHomeEmail({ unsubscribeUrl: uUrl, manageUrl: MANAGE_URL }) };
          }
        }
      }

      if (due) {
        const ok = await deliver(email, from, replyTo, due.rendered, uUrl);
        if (ok) {
          await stampSent(sb, email, p.id as string, due.messageId, lc, nowIso);
          sent++;
        }
      }
    }

    if (profiles.length < PAGE) break;
  }

  // ── Abandoned signups (5.1): applied at /apply but never created an account ─────
  const leadCutoff = new Date(now - LEAD_WINDOW_DAYS * DAY).toISOString();
  const { data: leads, error: leadErr } = await sb
    .from("terminal_applications")
    .select("email, created_at")
    .gte("created_at", leadCutoff)
    .order("created_at", { ascending: false });
  if (leadErr) {
    console.warn("[onboarding] leads read failed:", leadErr.message);
  } else {
    const seenLead = new Set<string>();
    for (const lead of leads ?? []) {
      const email = (lead.email as string | null)?.trim().toLowerCase();
      if (!email || seenLead.has(email) || accountEmails.has(email)) continue; // account exists → not abandoned
      seenLead.add(email);
      considered++;

      const days = (now - Date.parse(lead.created_at as string)) / DAY;
      if (days < FINISH_MIN_DAYS || days > FINISH_MAX_DAYS) continue;

      const lc = await loadLifecycle(sb, email);
      const messageId = "finish_account";
      if (!canSendOnboarding({ messageId, now, prefs: null, lifecycle: lc })) continue;

      const uUrl = marketingUnsubscribeUrl(email, SITE);
      const rendered = renderFinishAccountEmail({
        ctaUrl: `${SITE}/login?email=${encodeURIComponent(email)}`,
        unsubscribeUrl: uUrl,
      });
      const ok = await deliver(email, from, replyTo, rendered, uUrl);
      if (ok) {
        await stampSent(sb, email, null, messageId, lc, nowIso);
        sent++;
      }
    }
  }

  console.log(`[onboarding] Done. considered=${considered}, sent=${sent}${DRY ? " (dry run)" : ""}.`);
}

// Only run the CLI when executed directly (matches alerts.ts / sync.ts).
const isMainModule = typeof process !== "undefined" && process.argv[1]?.includes("onboarding.ts");
if (isMainModule) {
  main().catch((e) => {
    console.error("[onboarding] Fatal:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

export { main };
