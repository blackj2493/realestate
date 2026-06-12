/**
 * POST /api/share — persist a multi-selected set of listings and mint a share link.
 *
 * Body: { listingKeys: string[], note?: string }
 * Returns: { token, url } where url = <origin>/share/<token>
 *
 * Stores ListingKeys only (the public page re-hydrates live → freshness + compliance).
 * Uses the service-role client (RLS bypassed); ≤100 keys enforced per TRREB display cap.
 */

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { makeRateLimiter, clientIpFrom } from "@/lib/rateLimit";

// 10 share-link mints/min/IP — rate-caps abuse without requiring auth (audit LOW-31).
// Auth is intentionally NOT required: anonymous share links are product-intended
// (anonymous-first model). Do not add an auth gate here without a product decision.
const limiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  listingKeys: z
    .array(z.string().trim().min(1))
    .min(1, "Select at least one property")
    .max(100, "You can share at most 100 properties"),
  note: z.string().trim().max(280).optional(),
});

function resolveOrigin(request: NextRequest): string {
  const envBase = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto ?? "https"}://${host}`;
  return request.nextUrl.origin;
}

export async function POST(request: NextRequest) {
  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message : "Invalid request body";
    return NextResponse.json({ error: message ?? "Invalid request body" }, { status: 400 });
  }

  // De-dupe while preserving order.
  const listingKeys = Array.from(new Set(parsed.listingKeys));
  const token = randomBytes(8).toString("base64url");

  try {
    const rl = limiter.check(clientIpFrom(request));
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("shared_collections")
      .insert({ token, listing_keys: listingKeys, note: parsed.note ?? null });

    if (error) {
      console.error("[Share API] insert failed:", error.message);
      return NextResponse.json({ error: "Could not create share link" }, { status: 500 });
    }

    const url = `${resolveOrigin(request)}/share/${token}`;
    return NextResponse.json({ token, url });
  } catch (err) {
    console.error("[Share API] unexpected error:", err);
    return NextResponse.json({ error: "Could not create share link" }, { status: 500 });
  }
}
