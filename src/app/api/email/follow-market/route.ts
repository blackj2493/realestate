/**
 * GET /api/email/follow-market?e=<email>&s=<hmac>&city=<City>
 *
 * The one-tap market chip in the Weekly Data Drop (plan Unit 10). It exists because the
 * chip has TWO jobs and a plain link only does one of them:
 *
 *   1. SAVE the market to the account, so next Thursday's email is about their city — and,
 *      just as importantly, so the app itself finally has a saved area for them. 305 of 432
 *      users have none, and both in-app pickers (FirstRunRegionPicker, AcceptTermsForm)
 *      already exist and are not converting, because these readers stopped opening the
 *      dashboard. Reaching them in the inbox is the whole point.
 *   2. LAND them on that city, unfiltered. The redirect uses the CAMERA deep link
 *      (`?lat=&lng=&z=`), never `?city=` — a text filter pins the map and empties it the
 *      moment they pan past the boundary. See src/lib/dataDrop/cameras.ts.
 *
 * AUTH is the HMAC already used for one-click unsubscribe (src/lib/alerts/unsubscribe.ts) —
 * no new secret, no per-row token, and it is signed over the email so a link cannot be
 * retargeted at someone else's account.
 *
 * ON A GET THAT MUTATES. Mail scanners and link prefetchers will fire this. That is
 * acceptable here and it is NOT the same call as unsubscribe, which RFC 8058 requires to be
 * a POST because it is destructive and irreversible from the sender's side. Adding a saved
 * market is additive, idempotent, low-harm, and undone in one click on the page it lands on.
 * Keep all four of those properties true and this stays correct.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { verifyUnsubscribe } from "@/lib/alerts/unsubscribe";
import { recordActivation } from "@/lib/analytics/activation";
import { BOARD_MARKETS } from "@/lib/data/marketBoard";
import { marketMapUrl } from "@/lib/dataDrop/cameras";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

/** Cap saved regions, mirroring the 10-bubble cap in migration 025. */
const MAX_REGIONS = 10;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const sig = url.searchParams.get("s") ?? "";
  const cityRaw = (url.searchParams.get("city") ?? "").trim();

  // Validate the city by MEMBERSHIP in the offered set, never by pattern. Region labels are
  // free text elsewhere in this codebase and must not be regex-validated; membership is both
  // stricter and correct, and it guarantees the chip can only ever save something the weekly
  // can actually serve.
  const city = BOARD_MARKETS.find((m) => m.toLowerCase() === cityRaw.toLowerCase());

  // A bad link should never dead-end the reader. Send them to the public hub, which needs no
  // account and is worth reading on its own.
  if (!city) return NextResponse.redirect(`${SITE}/data`, 302);

  const landing = `${marketMapUrl(SITE, city)}&followed=${encodeURIComponent(city)}`;

  if (!email || !verifyUnsubscribe(email, sig)) {
    // Signature failure: still show them the city they asked for, just do not touch anyone's
    // account on an unverified request.
    return NextResponse.redirect(landing, 302);
  }

  try {
    const sb = getServiceRoleClient();
    const { data: profile } = await sb
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    // No account behind this address (a forwarded email, a deleted user). Nothing to save —
    // land them on the map anyway rather than erroring at them.
    if (!profile?.id) return NextResponse.redirect(landing, 302);

    const userId = profile.id as string;
    const { data: prefs } = await sb
      .from("dashboard_prefs")
      .select("config")
      .eq("user_id", userId)
      .maybeSingle();

    // MERGE, never replace. The blob also holds boards, persona and the market-activity lens;
    // writing `{ regions }` alone would silently reset the rest of someone's dashboard.
    const config = (prefs?.config ?? {}) as Record<string, unknown>;
    const existing = Array.isArray(config.regions)
      ? (config.regions as unknown[]).filter((r): r is string => typeof r === "string")
      : [];

    const already = existing.some((r) => r.toLowerCase() === city.toLowerCase());
    if (!already) {
      const next = [...existing, city].slice(-MAX_REGIONS);
      const { error } = await sb.from("dashboard_prefs").upsert(
        {
          user_id: userId,
          config: { ...config, regions: next },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) {
        console.error("[follow-market] upsert failed:", error.message);
      } else {
        // Same kind the in-app picker emits, so retention funnels see one population and the
        // `source` tells us how much of it the email is responsible for.
        await recordActivation({
          kind: "save_area",
          userId,
          email,
          context: { city, source: "data_drop" },
        });
      }
    }
  } catch (e) {
    // Never let a bookkeeping failure strand the reader on an error page.
    console.error("[follow-market] threw:", e instanceof Error ? e.message : e);
  }

  return NextResponse.redirect(landing, 302);
}
