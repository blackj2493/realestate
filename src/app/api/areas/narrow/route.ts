/**
 * GET  /api/areas/narrow   → { asks: [{ city, suggested: { name, hint } | null }] }
 * POST /api/areas/narrow   body: { city, action: "switch"|"keep"|"undo", part? }
 *
 * The in-app half of the narrow ask (NarrowCityCard): the same question the digest asks,
 * for a signed-in reader who follows all of Toronto or Ottawa and has not answered. Unlike
 * the email it is not capped at three: the card has its own "Not now" snooze, and a reader
 * who opens the app is exactly who should see it.
 *
 * Session-authenticated; the writes go through the service role scoped to that user, the
 * same posture as the signed email route, so both share performNarrow unchanged.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { parseNarrowInput, performNarrow } from "@/lib/areas/narrowAction";
import { loadAsks, loadOpensByFeedCity } from "@/lib/areas/narrowAskStore";
import { suggestPart, wholeCityToNarrow } from "@/lib/areas/narrowAsk";
import { partNamed } from "@/lib/dashboard/cityParts";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const limiter = makeRateLimiter({ windowMs: 60_000, max: 12 });

async function sessionUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function GET() {
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ asks: [] });
  const sb = getServiceRoleClient();

  const { data: rows } = await sb
    .from("market_bubbles")
    .select("name, area_type, source")
    .eq("user_id", userId)
    .eq("area_type", "city");
  const cities = [
    ...new Set(
      (rows ?? [])
        .map((r) => wholeCityToNarrow(((r.source as { city?: string } | null)?.city ?? r.name) as string))
        .filter((c): c is string => !!c)
    ),
  ];
  if (!cities.length) return NextResponse.json({ asks: [] });

  const asks = await loadAsks(sb, [userId]);
  // No table yet (migration 154 not applied): say nothing rather than ask with no memory.
  if (asks === null) return NextResponse.json({ asks: [] });

  const out = [];
  for (const city of cities) {
    const state = asks.get(userId)?.get(city) ?? null;
    if (state?.resolved) continue;
    const part = state?.suggested_part
      ? partNamed(state.suggested_part)
      : suggestPart(city, await loadOpensByFeedCity(sb, userId));
    out.push({ city, suggested: part ? { name: part.name, hint: part.hint } : null });
  }
  return NextResponse.json({ asks: out });
}

export async function POST(req: NextRequest) {
  const rl = limiter.check(clientIpFrom(req));
  if (!rl.allowed) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  const userId = await sessionUserId();
  if (!userId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const input = parseNarrowInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const out = await performNarrow(getServiceRoleClient(), userId, input, { via: "app" });
  if (!out.ok) {
    console.error("[areas/narrow] failed:", out.error);
    return NextResponse.json({ ok: false, error: "write_failed" }, { status: 500 });
  }
  if (out.error) console.error("[areas/narrow] alert reconcile:", out.error);
  return NextResponse.json({ ok: true, mapHref: out.mapHref });
}
