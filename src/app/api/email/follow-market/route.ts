/**
 * GET /api/email/follow-market?e=<email>&s=<hmac>&city=<City>
 *
 * The one-tap market chip in the Weekly Data Drop (plan Unit 10). It exists because the
 * chip has TWO jobs and a plain link only does one of them:
 *
 *   1. SAVE the market to the account, so next Thursday's email is about their city — and,
 *      just as importantly, so the app itself finally has a saved area for them. 305 of 432
 *      users have none, and both in-app pickers (MarketPicker, AcceptTermsForm)
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
import { BOARD_MARKETS } from "@/lib/data/marketBoard";
import { marketMapUrl } from "@/lib/dataDrop/cameras";
import { followRegion } from "@/lib/dashboard/followRegion";
import { withUtm } from "@/lib/email/utm";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const sig = url.searchParams.get("s") ?? "";
  const cityRaw = (url.searchParams.get("city") ?? "").trim();

  // Which send this chip came from, for `utm_campaign`. Unsigned and cosmetic on purpose:
  // it only ever labels analytics and never gates behaviour, so a missing or junk value
  // degrades to a visible placeholder instead of rejecting a legitimate click.
  const week = (url.searchParams.get("w") ?? "").trim();

  // The chip URL itself is deliberately untagged — it is an API hop that analytics never
  // sees. Tagging happens HERE, on the 302 target, which is the page the reader lands on.
  const tagged = (href: string, content: string) =>
    withUtm(href, { source: "data_drop", campaign: week || "unknown-week", content });

  // Validate the city by MEMBERSHIP in the offered set, never by pattern. Region labels are
  // free text elsewhere in this codebase and must not be regex-validated; membership is both
  // stricter and correct, and it guarantees the chip can only ever save something the weekly
  // can actually serve.
  const city = BOARD_MARKETS.find((m) => m.toLowerCase() === cityRaw.toLowerCase());

  // A bad link should never dead-end the reader. Send them to the public hub, which needs no
  // account and is worth reading on its own.
  if (!city) return NextResponse.redirect(tagged(`${SITE}/data`, "chip-unmatched"), 302);

  const landing = tagged(
    `${marketMapUrl(SITE, city)}&followed=${encodeURIComponent(city)}`,
    `chip-${city}`
  );

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

    // The shared step every server-side regions writer takes: merge into config.regions,
    // then reconcile the city alert row so the market we just saved actually emails — the
    // one thing this chip promises. Identical call to POST /api/areas/follow, on purpose:
    // two hand-written copies of this is how `config.regions` grew five writers that each
    // did something slightly different (see areaAlertSync's header).
    const followed = await followRegion(sb, userId, city, { source: "data_drop", email });
    if (!followed.ok) console.error("[follow-market] follow failed:", followed.error);
    else if (followed.error) console.error("[follow-market] alert reconcile failed:", followed.error);

  } catch (e) {
    // Never let a bookkeeping failure strand the reader on an error page.
    console.error("[follow-market] threw:", e instanceof Error ? e.message : e);
  }

  return NextResponse.redirect(landing, 302);
}
