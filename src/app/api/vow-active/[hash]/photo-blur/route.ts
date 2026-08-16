/**
 * GET /api/vow-active/[id]/photo-blur — unreadable thumbnail of a VOW-only ACTIVE
 * listing's lead photo, for the locked teaser an anonymous visitor sees.
 *
 * WHY THIS EXISTS SEPARATELY FROM /api/property/[id]/photo-blur
 * That route deliberately 404s ACTIVE listings, and it is right to: an active IDX
 * listing's photos are public, so a blurred stand-in would be a pointless round trip.
 * VOW-only actives invert that. They are active, but they arrived on the VOW datafeed,
 * and the licence attaches to the FEED rather than the listing's status — their photo
 * URLs are VOW Listing Information exactly as a sold listing's are. So they need the
 * same redaction the sold path gets, from a different table.
 *
 * WHY A ROUTE AND NOT A CSS BLUR (restating, because it is the whole point):
 * `filter: blur()` over the real <img> is not a gate. The full-resolution URL still sits
 * in the DOM and is still fetched, so deleting one CSS rule in devtools reveals the
 * photo — worse than showing it outright, because it LOOKS protected. The redaction has
 * to happen server-side, and what reaches the client has to be an image the original
 * cannot be recovered from.
 *
 * Returns the lead photo at BLUR_WIDTH px wide and blurred: a few hundred bytes of
 * colour field. It reads as "a bright kitchen" or "a brick semi" and nothing more.
 *
 * No-ops with 404 when VOW actives are disabled, so this route cannot become a side
 * door into the feature while the flag is off.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { getServiceRoleClient } from "@/lib/supabase/client";

/** Small enough that no upscale recovers detail; large enough to keep the colour massing. */
const BLUR_WIDTH = 24;
const BLUR_SIGMA = 4;
const FETCH_TIMEOUT_MS = 4000;

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ hash: string }> }) {
  if (String(process.env.VOW_ACTIVES_ENABLED ?? "").toLowerCase() !== "true") {
    return new NextResponse(null, { status: 404 });
  }

  // Keyed on property_hash, NOT listing_key. The MLS number of a VOW-only listing is
  // itself VOW Listing Information, and this URL is rendered into an anonymous page —
  // putting the key in it would leak the one identifier the teaser exists to withhold.
  // The hash is opaque and derives from address components the visitor already has.
  const { hash } = await ctx.params;
  if (!/^[0-9a-f]{64}$/.test(hash)) return new NextResponse(null, { status: 404 });

  try {
    const supabase = getServiceRoleClient();
    const { data } = await supabase
      .from("vow_active_listings")
      .select("media_urls")
      .eq("property_hash", hash)
      .limit(1)
      .maybeSingle();

    const urls: string[] = Array.isArray(data?.media_urls) ? (data!.media_urls as string[]) : [];
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
        // A live listing can gain photos, so this is NOT immutable like the sold blur.
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    // Never surface a reason — 404 is indistinguishable from "no photo", which is the
    // right amount of information to give an anonymous caller.
    return new NextResponse(null, { status: 404 });
  }
}
