/**
 * GET /api/property/[id]/photo-blur — a deliberately unreadable thumbnail of a sold or
 * off-market listing's lead photo, for the locked gallery an anonymous visitor sees.
 *
 * WHY A ROUTE AND NOT A CSS BLUR: `filter: blur()` over the real <img> is not a gate. The
 * full-resolution URL still sits in the DOM and is still fetched, so deleting one CSS rule
 * in devtools reveals the photo — worse than showing it outright, because it LOOKS
 * protected. Sold photo URLs are VOW Listing Information (soldByKey.ts: "The URL itself is
 * a VOW field"), so the URL must never reach the browser at all. The redaction therefore
 * has to happen server-side, and what the client receives has to be an image from which
 * the original cannot be recovered.
 *
 * WHAT IT RETURNS: the lead photo downsampled to BLUR_WIDTH px wide and blurred — a few
 * hundred bytes of colour field. At this size there is no detail left to recover by any
 * amount of upscaling; it reads as "a bright kitchen" or "a brick semi", which is exactly
 * the honest signal we want, and nothing more. It is a redaction, not a reproduction, so
 * the §6.3(f) watermark concern behind `images.unoptimized` (never re-encode a DISPLAYED
 * MLS photo) doesn't apply — no watermark is legible at 24px either way.
 *
 * COST: cached immutably at the CDN and generated at most once per listing ever viewed, so
 * this costs far less than precomputing blurs for all 258,775 sold rows that have photos —
 * and it stays correct if a listing's photos change. If the volume ever justifies it, the
 * same bytes can be precomputed into a column without touching the client contract.
 *
 * ACTIVE listings 404 here on purpose: their photos are IDX and public, so a blurred stand-in
 * would be a pointless round trip.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { getSoldPhotoUrls } from "@/lib/property/soldPhotos";
import { resolveListingStatus } from "@/lib/property/listingStatus";

/** Small enough that no upscale recovers detail; large enough to keep the colour massing. */
const BLUR_WIDTH = 24;
const BLUR_SIGMA = 4;
/** A slow origin must not hold a request open — the UI falls back to the plain lock. */
const FETCH_TIMEOUT_MS = 4000;

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[A-Za-z]\d{6,9}$/.test(id)) return new NextResponse(null, { status: 404 });

  try {
    const supabase = getServiceRoleClient();
    const { data: listing } = await supabase
      .from("listings")
      .select("full_payload, media_urls")
      .eq("listing_key", id)
      .maybeSingle();
    if (!listing) return new NextResponse(null, { status: 404 });

    // Only sold/leased records are gated, so only they have anything to blur. Pass no
    // de-listed row: a Terminated/Expired listing resolves to "active" here, and its
    // photos are still IDX — erring toward NOT minting a blur is the safe direction.
    const status = resolveListingStatus(
      (listing.full_payload ?? {}) as Record<string, unknown>,
      null
    );
    if (status.kind === "active") return new NextResponse(null, { status: 404 });

    const urls: string[] =
      Array.isArray(listing.media_urls) && listing.media_urls.length > 0
        ? listing.media_urls
        : await getSoldPhotoUrls(id);
    if (urls.length === 0) return new NextResponse(null, { status: 404 });

    const res = await fetch(urls[0], { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return new NextResponse(null, { status: 404 });

    const blurred = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(BLUR_WIDTH, null, { fit: "inside" })
      .blur(BLUR_SIGMA)
      .webp({ quality: 45 })
      .toBuffer();

    return new NextResponse(new Uint8Array(blurred), {
      headers: {
        "Content-Type": "image/webp",
        // Derived from a photo that does not change for a closed listing.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    // Never surface a reason — a 404 is indistinguishable from "no photo", which is the
    // correct amount of information to give an anonymous caller.
    return new NextResponse(null, { status: 404 });
  }
}
