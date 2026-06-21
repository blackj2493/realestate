import { NextRequest, NextResponse } from "next/server";
import { revalidateTag, revalidatePath } from "next/cache";
import { listingCacheTag } from "@/lib/property/listingCacheTag";

export const dynamic = "force-dynamic";

// Same shape the sync route enforces: one board letter + 6-9 digits (e.g. X12639568).
const LISTING_KEY_RE = /^[A-Z]\d{6,9}$/;

/**
 * POST /api/revalidate — on-demand cache busting for a single listing.
 *
 * Body: { listingKey: string }
 * Header: x-revalidate-secret: <REVALIDATE_SECRET>
 *
 * Called by the ETL delta sync (and any out-of-Next worker) after it upserts a
 * changed listing, so the cached listing detail + page refresh immediately instead
 * of waiting out the 24h window. Fails CLOSED: if REVALIDATE_SECRET is unset or the
 * header doesn't match, the request is rejected — this must never be an open endpoint.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let listingKey: unknown;
  try {
    ({ listingKey } = await request.json());
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof listingKey !== "string" || !LISTING_KEY_RE.test(listingKey)) {
    return NextResponse.json({ ok: false, error: "Invalid listingKey" }, { status: 400 });
  }

  // Next 16: { expire: 0 } = immediate expiration, the documented form for external
  // triggers (webhooks / the out-of-Next ETL) that need data to refresh right away —
  // not the stale-while-revalidate "max" profile.
  revalidateTag(listingCacheTag(listingKey), { expire: 0 });
  revalidatePath(`/properties/${listingKey}`);

  return NextResponse.json({ ok: true, listingKey });
}
