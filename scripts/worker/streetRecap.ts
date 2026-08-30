/**
 * Monthly Street Recap sender — the owner stream.
 *
 * The email that replaced "your home's value moved". It carries no valuation at all: only
 * ~21% of homes in our markets have any record in the vault, and `property_estimates`
 * covers ACTIVE listings only, so a per-home estimate would be a model output the reader
 * could disprove from their own kitchen. Real sales near a real address cannot be.
 *
 * Idempotent like the alerts, onboarding and Data Drop workers: the month is stamped into
 * `user_email_lifecycle.sent` ONLY after Resend confirms, so a failure retries next run and
 * a double dispatch mails nobody twice.
 *
 * Invoke:
 *   npx tsx scripts/worker/streetRecap.ts --dry            # resolve + report, send nothing
 *   npx tsx scripts/worker/streetRecap.ts --to=a@b.com     # TEST: one address, no gating,
 *                                                          #  no stamp; uses their real scope
 *   npx tsx scripts/worker/streetRecap.ts                  # real run
 *
 * Env: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, RESEND_API_KEY,
 *      NEXT_PUBLIC_SITE_URL
 */
import "dotenv/config";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { SENDERS } from "@/lib/alerts/senders";
import { sendTransactionalEmail } from "@/lib/alerts/sendEmail";
import { SITE } from "@/lib/alerts/emailShell";
import { marketingUnsubscribeUrl } from "@/lib/alerts/unsubscribe";
import { renderStreetRecapEmail } from "@/lib/alerts/streetRecapEmail";
import {
  buildStreetRecapPayload,
  previousMonthWindow,
  type RecapScope,
  type SoldAgg,
} from "@/lib/streetRecap/payload";
import {
  loadRecapAudience,
  loadRecapAggregates,
  collectScopes,
  scopeKey,
  type Recipient,
} from "@/lib/streetRecap/data";
import { canSendStreetRecap, type EmailPrefsRow, type LifecycleRow } from "@/lib/email/sendPolicy";

const argOf = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY = process.argv.includes("--dry");
const TEST_TO = argOf("to");
const MANAGE_URL = `${SITE}/account/emails`;

/**
 * Share of resolvable recipients that may yield no payload before the run is a FAILURE.
 *
 * A handful of thin neighbourhoods is normal and the ladder handles it. Most of the audience
 * yielding nothing means a scope join broke or an RPC silently returned empty — which
 * otherwise looks exactly like a quiet month.
 */
const MAX_SKIP_SHARE = 0.35;

type SB = ReturnType<typeof getServiceRoleClient>;

async function loadPrefs(sb: SB, userId: string | null): Promise<EmailPrefsRow | null> {
  if (!userId) return null;
  const { data } = await sb
    .from("email_prefs")
    .select("alerts, onboarding, data_drop, home_value, cadence, pause_until")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as EmailPrefsRow | null) ?? null;
}

async function loadLifecycle(sb: SB, email: string): Promise<LifecycleRow | null> {
  const { data } = await sb
    .from("user_email_lifecycle")
    .select("sent, last_sent_at, user_id, first_seen_at")
    .eq("email", email)
    .maybeSingle();
  return (data as LifecycleRow | null) ?? null;
}

/**
 * Stamp the month. Read-merge-write, never a bare upsert — `sent` holds the onboarding
 * drip's idempotency keys and the digest's collision stamp, and replacing the object would
 * delete both. `last_sent_at` is deliberately untouched for the same reason the digest
 * leaves it alone: it drives the drip's two-day gap.
 */
async function stampSent(
  sb: SB,
  email: string,
  userId: string | null,
  messageId: string,
  lc: (LifecycleRow & { user_id?: string | null; first_seen_at?: string | null }) | null,
  nowIso: string
): Promise<void> {
  const sent = { ...(lc?.sent ?? {}), [messageId]: nowIso };
  const { error } = await sb.from("user_email_lifecycle").upsert(
    {
      email,
      user_id: userId ?? lc?.user_id ?? null,
      sent,
      first_seen_at: lc?.first_seen_at ?? nowIso,
      updated_at: nowIso,
    },
    { onConflict: "email" }
  );
  if (error) console.error("[street-recap] lifecycle upsert failed", email, error.message);
}

/**
 * Everything geographic for one recipient: the ladder, and the comparison city if there
 * honestly is one.
 *
 * THE CITY COMPARISON IS SUPPRESSED WHEN THE NAMES DISAGREE. `address_watches` holds the
 * geocoder's municipality and the feed holds TRREB's, and they are usually different words
 * for overlapping-but-not-identical areas: Strathroy against "Adelaide Metcalfe", Caledonia
 * against "Haldimand", Toronto against "Toronto C01". Printing "across Toronto C01" is
 * gibberish to a reader, and printing "across Toronto" beside a number computed from one
 * downtown district is a claim we cannot support. When the two names do not match we simply
 * do not compare — the standing-inventory block carries the email perfectly well.
 */
function geographyFor(
  r: Recipient,
  sold: Map<string, SoldAgg>,
  feedCity: Map<string, string>
): {
  candidates: { scope: RecapScope; sold: SoldAgg }[];
  city: { scope: RecapScope; sold: SoldAgg } | null;
  activesKey: string | null;
} {
  const candidates: { scope: RecapScope; sold: SoldAgg }[] = [];
  let feed: string | null = null;
  let activesKey: string | null = null;

  if (r.cityRegion) {
    const k = scopeKey("region", r.cityRegion);
    const agg = sold.get(k);
    if (agg) {
      feed = feed ?? feedCity.get(k) ?? null;
      activesKey = k;
      candidates.push({
        scope: { kind: "region", label: r.cityRegion, city: r.city ?? feed ?? "" },
        sold: agg,
      });
    }
  }
  if (r.fsa) {
    const k = scopeKey("fsa", r.fsa);
    const agg = sold.get(k);
    if (agg) {
      feed = feed ?? feedCity.get(k) ?? null;
      candidates.push({
        // The label stays the FSA for logs and keys; the renderer never prints it, because
        // "Homes in N7G" is a sorting code, not a place someone lives.
        scope: { kind: "fsa", label: r.fsa, city: r.city ?? feed ?? "" },
        sold: agg,
      });
    }
  }

  const namesAgree =
    !!feed && !!r.city && feed.trim().toLowerCase() === r.city.trim().toLowerCase();
  const cityName = namesAgree ? feed : null;
  const cityAgg = cityName ? sold.get(scopeKey("city", cityName)) : undefined;

  // The inventory block falls back to the FEED's city even when its name is unprintable.
  // Those numbers are right for this address — 35 Parliament Street really is in Toronto
  // C01 — and the block never names the place: it says "still for sale", anchored by the
  // address in the lede. Only the COMPARISON needed a name, and only the name was wrong.
  if (!activesKey && feed) activesKey = scopeKey("city", feed);

  return {
    candidates,
    city:
      cityAgg && cityName
        ? { scope: { kind: "city", label: cityName, city: cityName }, sold: cityAgg }
        : null,
    activesKey,
  };
}

async function main(): Promise<void> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  // The window is the PREVIOUS calendar month in Toronto, so the label on the email is true
  // by construction rather than by the run happening to fall early enough in the month.
  const win = previousMonthWindow(now);
  const month = win.key;
  const monthPrefix = `street_recap:${month}`;

  console.log(
    `\n🏠 Street Recap — ${win.label} ${month}${DRY ? "  (DRY RUN)" : ""}${TEST_TO ? `  (TEST → ${TEST_TO})` : ""}`
  );

  if (!process.env.RESEND_API_KEY && !DRY) {
    console.warn("[street-recap] RESEND_API_KEY unset — skipping (use --dry to test).");
    return;
  }
  const sb = getServiceRoleClient();

  // Fail-closed on the idempotency table, exactly like the other senders: without it a
  // re-run would mail the whole audience twice.
  if (!TEST_TO) {
    const probe = await sb.from("user_email_lifecycle").select("email", { head: true, count: "exact" });
    if (probe.error) {
      console.warn("[street-recap] user_email_lifecycle unavailable — skipping:", probe.error.message);
      return;
    }
  }

  console.log(`   window: ${win.from} → ${win.to} (exclusive)`);
  console.log("   resolving audience…");
  const audience = await loadRecapAudience(sb);
  const recipients = TEST_TO
    ? audience.filter((r) => r.email === TEST_TO.trim().toLowerCase())
    : audience;

  if (TEST_TO && !recipients.length) {
    console.error(
      `[street-recap] ${TEST_TO} has no address on file. They must appear in reno_lookups ` +
        `(signed-in) or address_watches before a test send can render anything real.`
    );
    process.exit(1);
  }

  const scopes = collectScopes(recipients);
  console.log(
    `   audience=${recipients.length}  regions=${scopes.regions.length} ` +
      `fsas=${scopes.fsas.length} cities=${scopes.cities.length}`
  );
  if (!recipients.length) {
    console.log("   nobody to write to yet. Nothing sent.\n✅ done");
    return;
  }

  const { sold, actives, feedCity } = await loadRecapAggregates(sb, scopes, {
    from: win.from,
    to: win.to,
  });
  console.log(`   aggregates: ${sold.size} sold cohorts, ${actives.size} inventory cohorts`);

  let considered = 0;
  let sentCount = 0;
  let gated = 0;
  let skippedNoPayload = 0;
  const scopeCounts = new Map<string, number>();

  for (const r of recipients) {
    considered++;

    const geo = geographyFor(r, sold, feedCity);

    const payload = buildStreetRecapPayload({
      address: r.address,
      candidates: geo.candidates,
      city: geo.city,
      actives: (geo.activesKey ? actives.get(geo.activesKey) : undefined) ?? null,
      dataAsOf: nowIso,
      monthLabel: win.label,
    });
    if (!payload) {
      skippedNoPayload++;
      continue;
    }
    scopeCounts.set(payload.scope.kind, (scopeCounts.get(payload.scope.kind) ?? 0) + 1);

    const lc = await loadLifecycle(sb, r.email);
    if (!TEST_TO) {
      const prefs = await loadPrefs(sb, r.userId);
      if (!canSendStreetRecap({ monthKeyPrefix: monthPrefix, now, prefs, lifecycle: lc })) {
        gated++;
        continue;
      }
    }

    if (DRY) {
      console.log(
        `   DRY ${r.email} → ${payload.scope.kind}/${payload.scope.label} ` +
          `(${payload.local.sales} sales, ${payload.local.medianDom ?? "—"}d) [${r.source}]`
      );
      sentCount++;
      continue;
    }

    const uUrl = marketingUnsubscribeUrl(r.email, SITE);
    const rendered = renderStreetRecapEmail(
      { payload, lat: r.lat, lng: r.lng, unsubscribeUrl: uUrl, manageUrl: MANAGE_URL },
      now
    );
    const res = await sendTransactionalEmail({
      kind: "street_recap",
      from: SENDERS.streetRecap.from,
      replyTo: SENDERS.streetRecap.replyTo,
      to: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "List-Unsubscribe": `<${uUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (res.sent) {
      if (!TEST_TO) await stampSent(sb, r.email, r.userId, monthPrefix, lc as never, nowIso);
      sentCount++;
      console.log(`   ✅ ${r.email} → ${payload.scope.label}`);
    }
  }

  const spread = [...scopeCounts.entries()].map(([k, n]) => `${k}=${n}`).join(" ");
  console.log(
    `\n   considered=${considered} sent=${sentCount} gated=${gated} ` +
      `skipped(no payload)=${skippedNoPayload}`
  );
  console.log(`   scope spread: ${spread || "none"}`);

  // A quiet month and a broken join look identical from the outside; only the share tells
  // them apart. Most of the audience resolving to nothing is a failure, not a slow market.
  const share = considered ? skippedNoPayload / considered : 0;
  if (!TEST_TO && considered >= 10 && share > MAX_SKIP_SHARE) {
    console.error(
      `\n❌ ${(share * 100).toFixed(0)}% of recipients yielded no payload ` +
        `(max ${(MAX_SKIP_SHARE * 100).toFixed(0)}%). Check the scope joins and the RPCs.`
    );
    process.exit(1);
  }

  console.log("✅ done");
}

main().catch((e) => {
  console.error("[street-recap] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
