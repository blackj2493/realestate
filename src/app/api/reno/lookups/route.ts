import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { getCurrentUser } from "@/lib/supabase/server";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";
import { slugify } from "@/lib/listings/listingPath";

export const dynamic = "force-dynamic";

/**
 * POST /api/reno/lookups — record the home someone looked up in the renovation funnel.
 *
 * WHY THIS EXISTS. `RenoAddressField` asks the visitor to "Start typing your home
 * address…", geocodes their pick, uses it to resolve a cohort, and discards it. Everyone
 * who has ever used that tool named the home they live in and we kept only the
 * neighbourhood. This route is where that stops. See migration 129.
 *
 * SIGNED IN decides what is stored, NOT VOW terms. A user who has an account but has not
 * accepted terms is still someone we can reach; gating capture on `isConsumer` would throw
 * away the addresses of exactly the cohort the Personal engine most wants to re-activate.
 * Anonymous visitors are recorded as a community and a property type with no address — the
 * demand signal without a home address attached to nobody. Migration 129's CHECK enforces
 * it at the table, so this is a guarantee rather than a convention.
 *
 * FIRE AND FORGET. The funnel calls this after a result has already rendered and ignores
 * the response. A failure here must never cost the visitor their answer, so every path
 * returns fast and the client never branches on the outcome.
 */

const limiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

const MAX = { address: 300, city: 120, region: 160, type: 80 };

const str = (v: unknown, cap: number): string =>
  typeof v === "string" ? v.trim().slice(0, cap) : "";

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export async function POST(req: NextRequest) {
  try {
    const rl = limiter.check(clientIpFrom(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const cityRegion = str((body as Record<string, unknown>).cityRegion, MAX.region);
    const city = str((body as Record<string, unknown>).city, MAX.city);
    const propertySubType = str((body as Record<string, unknown>).propertySubType, MAX.type);

    // The community IS the row for an anonymous visitor, so a lookup with no geography at
    // all carries no signal and is not worth a row.
    if (!city && !cityRegion) return NextResponse.json({ ok: false }, { status: 400 });

    const user = await getCurrentUser();

    // The privacy split. Everything address-shaped is dropped unless a user owns the row.
    const address = user ? str((body as Record<string, unknown>).address, MAX.address) : "";
    const addressKey = address ? slugify(`${address} ${city}`) : "";

    const { error } = await getServiceRoleClient()
      .from("reno_lookups")
      .insert({
        user_id: user?.id ?? null,
        address: address || null,
        address_key: addressKey || null,
        lat: user ? num((body as Record<string, unknown>).lat) : null,
        lng: user ? num((body as Record<string, unknown>).lng) : null,
        city: city || null,
        city_region: cityRegion || null,
        property_sub_type: propertySubType || null,
        matched: (body as Record<string, unknown>).matched === true,
      });

    if (error) {
      // Logged, not surfaced: the visitor already has their renovation answer.
      console.error("[reno/lookups] insert failed:", error.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    // `stored` tells the funnel whether this person is now on the monthly recap: an address
    // was kept, which only happens for a signed-in visitor. It saves the client a second
    // round trip to re-establish what this handler already knows.
    return NextResponse.json({ ok: true, stored: !!addressKey });
  } catch (e) {
    console.error("[reno/lookups] threw:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
