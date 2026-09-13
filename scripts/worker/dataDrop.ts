/**
 * Weekly Data Drop sender (engagement plan WS2, Unit 6).
 *
 * Runs on its OWN weekly workflow, deliberately not chained to the sync: a marketing send
 * must not ride the data pipeline, or its send time becomes an accident of how long the
 * sync took — the exact bug nightly-emails.yml was split out to fix.
 *
 * Idempotent like the alerts and onboarding workers: the week is stamped into
 * user_email_lifecycle.sent ONLY after Resend confirms, so a failure retries next run and a
 * double dispatch mails nobody twice. The stamped id carries the headline kind
 * ("data_drop:2026-W36:leverage") and the gate matches on the WEEK PREFIX — see
 * canSendDataDrop.
 *
 * Invoke:
 *   npx tsx scripts/worker/dataDrop.ts --dry              # render + report, send nothing
 *   npx tsx scripts/worker/dataDrop.ts --to=a@b.com       # TEST: send to one address only,
 *                                                         #  no lifecycle stamp, no gating
 *   npx tsx scripts/worker/dataDrop.ts --to=a@b.com --scope=province   # force the 70.6% shape
 *   npx tsx scripts/worker/dataDrop.ts                    # real run, saved-market users
 *   npx tsx scripts/worker/dataDrop.ts --segment=all      # real run, everyone
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, RESEND_API_KEY,
 *      NEXT_PUBLIC_SITE_URL
 */
import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { SENDERS } from "@/lib/alerts/senders";
import { sendTransactionalEmail } from "@/lib/alerts/sendEmail";
import { createSendPacer } from "@/lib/alerts/sendPacer";
import { SITE } from "@/lib/alerts/emailShell";
import { marketingUnsubscribeUrl, signUnsubscribe } from "@/lib/alerts/unsubscribe";
import { renderDataDropEmail } from "@/lib/alerts/dataDropEmail";
import { BOARD_MARKETS } from "@/lib/data/marketBoard";
import { buildDataDropPayload, isoWeekId, type LadderTrace } from "@/lib/dataDrop/payload";
import { loadDataDropInputs, scopeRegions, MAX_DATA_AGE_HOURS } from "@/lib/dataDrop/data";
import {
  canSendDataDrop,
  lastDataDropKind,
  digestSentToday,
  type EmailPrefsRow,
  type LifecycleRow,
} from "@/lib/email/sendPolicy";

const argOf = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY = process.argv.includes("--dry");
const TEST_TO = argOf("to");
const FORCE_SCOPE = argOf("scope"); // 'province' | 'market'
const FORCE_REGION = argOf("region");
/**
 * Who the real run mails. 'saved' is the users with a saved market, who get a personalised
 * payload; 'all' adds everyone else, who get the province-wide Ontario edition.
 *
 * DEFAULT IS 'all' (owner decision 2026-09-06). It was 'saved' for the ramp, but the ramp
 * is over: the first send went to everybody, and a user with nothing saved is precisely the
 * user this stream exists for — they receive no other mail once the onboarding drip expires
 * around day 30. That was 346 of 490 considered.
 *
 * THIS DEFAULT IS LOAD-BEARING FOR THE CRON, not just for a forgetful operator. A `schedule`
 * trigger passes no inputs, so the workflow adds no --segment flag and the weekly send is
 * whatever this line says. Changing it back to 'saved' silently drops 70% of the list.
 */
const SEGMENT = argOf("segment") === "saved" ? "saved" : "all";
const MANAGE_URL = `${SITE}/account/emails`;

/** Share of recipients skipped above which the run is a FAILURE, not a quiet no-op. */
const MAX_SKIP_SHARE = 0.2;

type SB = ReturnType<typeof getServiceRoleClient>;

interface Profile {
  id: string;
  email: string | null;
  marketing_opt_out?: boolean;
  terms_accepted_at?: string | null;
}

async function loadPrefs(sb: SB, userId: string): Promise<EmailPrefsRow | null> {
  const { data } = await sb
    .from("email_prefs")
    .select("data_drop, cadence, pause_until")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as EmailPrefsRow | null) ?? null;
}

async function loadLifecycle(sb: SB, email: string) {
  const { data } = await sb
    .from("user_email_lifecycle")
    .select("email, user_id, sent, last_sent_at, first_seen_at")
    .eq("email", email)
    .maybeSingle();
  return (data as (LifecycleRow & { email: string; user_id: string | null; first_seen_at: string | null }) | null) ?? null;
}

async function loadRegions(sb: SB, userId: string): Promise<string[]> {
  const { data } = await sb.from("dashboard_prefs").select("config").eq("user_id", userId).maybeSingle();
  const regions = (data?.config as { regions?: unknown } | null)?.regions;
  return Array.isArray(regions) ? (regions.filter((r) => typeof r === "string") as string[]) : [];
}

/**
 * Terminal or public tracker?
 *
 * Two gates, and the first is not a heuristic: the terminal is VOW-gated, so for a user who
 * never accepted terms the map link IS a login wall. The second is soft — a reader who has
 * done nothing in 60 days is better served by a page they can just read.
 */
async function chooseCta(sb: SB, p: Profile, now: number): Promise<"terminal" | "tracker"> {
  if (!p.terms_accepted_at) return "tracker";
  const since = new Date(now - 60 * 86_400_000).toISOString();
  const { count } = await sb
    .from("activation_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", p.id)
    .gte("occurred_at", since);
  return (count ?? 0) > 0 ? "terminal" : "tracker";
}

async function stampSent(
  sb: SB,
  email: string,
  userId: string | null,
  messageId: string,
  lc: Awaited<ReturnType<typeof loadLifecycle>>,
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
  if (error) console.error("[data-drop] lifecycle upsert failed", email, error.message);
}

const traceLine = (t: LadderTrace[]) =>
  t.map((r) => `${r.rank}:${r.kind}=${r.result}`).join(" ");

async function main(): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const weekId = isoWeekId(now);
  const weekPrefix = `data_drop:${weekId}`;

  console.log(`\n📊 Weekly Data Drop — ${weekId}${DRY ? "  (DRY RUN)" : ""}${TEST_TO ? `  (TEST → ${TEST_TO})` : ""}`);

  if (!process.env.RESEND_API_KEY && !DRY) {
    console.warn("[data-drop] RESEND_API_KEY unset — skipping (use --dry to test).");
    return;
  }
  const sb = getServiceRoleClient();

  // Fail-closed on the idempotency table, exactly like the onboarding worker: without it a
  // re-run would mail the whole base a second time.
  if (!TEST_TO) {
    const probe = await sb.from("user_email_lifecycle").select("email", { head: true, count: "exact" });
    if (probe.error) {
      console.warn("[data-drop] user_email_lifecycle unavailable — skipping:", probe.error.message);
      return;
    }
  }

  console.log("   loading boards…");
  const inputs = await loadDataDropInputs(now);
  console.log(
    `   markets=${inputs.rows.length}  competition cities=${inputs.competitionByCity.size}  ` +
      `snapshots indexed=${inputs.snapshots.size}  dataAsOf=${inputs.dataAsOf} (${inputs.ageHours?.toFixed(1)}h)`
  );

  // ── THE FRESHNESS GATE ─────────────────────────────────────────────────────
  // A frozen precompute is the dominant failure shape here: the number stops moving, nothing
  // errors, and the weekly restates it to the whole base. Refuse rather than send stale.
  if (inputs.ageHours == null || inputs.ageHours > MAX_DATA_AGE_HOURS) {
    console.error(
      `❌ [data-drop] board data is ${inputs.ageHours?.toFixed(1) ?? "?"}h old ` +
        `(max ${MAX_DATA_AGE_HOURS}h). REFUSING to send.`
    );
    process.exit(1);
  }

  const chipMarkets = BOARD_MARKETS;

  // ── TEST MODE: one address, no gating, no stamping. ────────────────────────
  if (TEST_TO) {
    const regions =
      FORCE_SCOPE === "province"
        ? []
        : FORCE_REGION
          ? scopeRegions([FORCE_REGION])
          : scopeRegions(["Milton", "Oakville", "Burlington"]);

    const built = buildDataDropPayload({
      regions,
      rows: inputs.rows,
      competitionByCity: inputs.competitionByCity,
      province: inputs.province,
      snapshots: inputs.snapshots,
      dataAsOf: inputs.dataAsOf,
      now,
    });
    if (!built) {
      console.error("❌ no payload could be built — nothing to send.");
      process.exit(1);
    }
    console.log(`   scope=${built.payload.scope} region=${built.payload.region}`);
    console.log(`   ladder: ${traceLine(built.trace)}`);

    const rendered = renderDataDropEmail(
      {
        payload: built.payload,
        chipMarkets,
        unsubscribeUrl: marketingUnsubscribeUrl(TEST_TO, SITE),
        manageUrl: MANAGE_URL,
        ctaTarget: "terminal",
        email: TEST_TO,
        signature: signUnsubscribe(TEST_TO),
      },
      now
    );
    console.log(`   subject: ${rendered.subject}`);
    console.log(`   preheader: ${rendered.preheader}`);
    if (DRY) {
      console.log("\n───── TEXT PART ─────\n");
      console.log(rendered.text);
      console.log("\n───── (dry run — nothing sent) ─────\n");
      return;
    }
    const res = await sendTransactionalEmail({
      kind: "data_drop:test",
      from: SENDERS.dataDrop.from,
      replyTo: SENDERS.dataDrop.replyTo,
      to: TEST_TO,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "List-Unsubscribe": `<${marketingUnsubscribeUrl(TEST_TO, SITE)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    console.log(res.sent ? `✅ sent to ${TEST_TO} (id ${res.id})` : `❌ send failed: ${res.error}`);
    if (!res.sent) process.exit(1);
    return;
  }

  // ── REAL RUN ───────────────────────────────────────────────────────────────
  const PAGE = 1000;
  let considered = 0;
  let sent = 0;
  let failed = 0;
  let skippedNoPayload = 0;
  let gated = 0;
  // Paced. This is the only worker that mails the WHOLE list in one pass, so it is the one
  // most exposed to Resend's 10 req/s per-team limit: an unpaced loop over 391 recipients
  // gets ~100 through and the rest rejected (see sendPacer.ts and #499). Nothing is
  // destroyed when that happens — the lifecycle row is stamped only on a confirmed send, so
  // a rejected recipient simply has no stamp and is picked up next run — but a first send
  // that reaches a quarter of the list is not a first send worth making.
  const pacer = createSendPacer();
  /** Skipped because the nightly digest already reached them today. */
  let deferredSameDay = 0;
  let outOfSegment = 0;
  const kindCounts = new Map<string, number>();

  for (let offset = 0; ; offset += PAGE) {
    const { data: profiles, error } = await sb
      .from("profiles")
      .select("id, email, marketing_opt_out, terms_accepted_at")
      .order("id")
      .range(offset, offset + PAGE - 1);
    if (error) {
      console.error("[data-drop] profiles read failed:", error.message);
      break;
    }
    if (!profiles || profiles.length === 0) break;

    for (const raw of profiles as Profile[]) {
      const email = raw.email?.trim().toLowerCase();
      if (!email) continue;
      considered++;

      const prefs = await loadPrefs(sb, raw.id);
      const lc = await loadLifecycle(sb, email);
      if (
        !canSendDataDrop({
          weekKeyPrefix: weekPrefix,
          now,
          marketingOptOut: raw.marketing_opt_out === true,
          prefs,
          lifecycle: lc,
        })
      ) {
        // Separate the two reasons in the receipt. A consent gate is permanent and
        // expected; a same-day deferral is temporary and, if it ever dominates a run, means
        // the weekly is quietly losing to the digest and the send hour needs moving.
        if (digestSentToday(lc?.sent, now)) deferredSameDay++;
        else gated++;
        continue;
      }

      const regions = scopeRegions(await loadRegions(sb, raw.id));
      if (SEGMENT === "saved" && regions.length === 0) {
        outOfSegment++;
        continue;
      }
      const built = buildDataDropPayload({
        // Per-reader rotation: demote whatever this person led with last time.
        avoidKind: lastDataDropKind(lc?.sent),
        regions,
        rows: inputs.rows,
        competitionByCity: inputs.competitionByCity,
        province: inputs.province,
        snapshots: inputs.snapshots,
        dataAsOf: inputs.dataAsOf,
        now,
      });
      // A null payload is a SKIP, not an error. A skipped week costs nothing; a week that
      // ships a dash costs the open rate of the next twelve.
      if (!built) {
        skippedNoPayload++;
        continue;
      }

      const messageId = `${weekPrefix}:${built.payload.headline.kind}`;
      kindCounts.set(built.payload.headline.kind, (kindCounts.get(built.payload.headline.kind) ?? 0) + 1);

      if (DRY) {
        console.log(
          `   DRY ${email} → ${built.payload.scope}/${built.payload.region} ` +
            `[${built.payload.headline.kind}] ${traceLine(built.trace)}`
        );
        sent++;
        continue;
      }

      const uUrl = marketingUnsubscribeUrl(email, SITE);
      const rendered = renderDataDropEmail(
        {
          payload: built.payload,
          chipMarkets,
          unsubscribeUrl: uUrl,
          manageUrl: MANAGE_URL,
          ctaTarget: await chooseCta(sb, raw, now),
          email,
          signature: signUnsubscribe(email),
        },
        now
      );
      const out = await pacer.send({
        kind: "data_drop",
        from: SENDERS.dataDrop.from,
        replyTo: SENDERS.dataDrop.replyTo,
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers: {
          "List-Unsubscribe": `<${uUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      if (out.status === "sent") {
        await stampSent(sb, email, raw.id, messageId, lc, nowIso);
        sent++;
        continue;
      }
      failed++;
      console.error(`   NOT SENT to ${email}: ${out.error}`);
      // Out of quota: every remaining send tonight fails the same way. Stop rather than
      // collect hundreds of identical errors; the unstamped rest go out on the next run.
      if (out.status === "quota") break;
    }
    if (pacer.stopped) break;
    if (profiles.length < PAGE) break;
  }

  const spread = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(" ");
  console.log(
    `\n   segment=${SEGMENT} considered=${considered} sent=${sent} NOT-SENT=${failed} gated=${gated} ` +
      `deferred-same-day=${deferredSameDay} ` +
      `out-of-segment=${outOfSegment} skipped(no payload)=${skippedNoPayload}`
  );
  console.log(`   headline kinds: ${spread || "(none)"}`);

  // A high skip rate means the payload builder stopped finding headlines. That is a silent
  // quality collapse, so make it loud.
  const eligible = sent + skippedNoPayload;
  if (eligible > 0 && skippedNoPayload / eligible > MAX_SKIP_SHARE) {
    console.error(
      `❌ [data-drop] ${((skippedNoPayload / eligible) * 100).toFixed(1)}% of eligible recipients ` +
        `had no payload (max ${MAX_SKIP_SHARE * 100}%).`
    );
    process.exit(1);
  }

  // A rejected send is not a quiet no-op: those people got nothing this week. They keep no
  // lifecycle stamp, so the next run retries them — but the run must go RED, because this
  // job is unattended on a Thursday cron and nobody reads a green log.
  if (failed > 0) {
    const pc = pacer.stats();
    console.error(
      `❌ [data-drop] ${failed} recipient(s) were REJECTED by the provider ` +
        `(retried=${pc.retries}, quotaHit=${pc.quotaHit}). No lifecycle stamp was written for ` +
        `them, so the next run picks them up.`
    );
    process.exit(1);
  }
  console.log("✅ done\n");
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
