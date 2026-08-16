"use client";

/**
 * The lead photo of a sold / leased / off-market record — real for a consumer, redacted
 * for everyone else.
 *
 * SIGNED-IN CONSUMER: the server hands down `photoUrl` (address-status attaches it inside
 * its getConsumer()-confirmed branch) and the actual photo renders. A consumer is entitled
 * to VOW Listing Information, and /properties/[id] already shows them the full gallery for
 * the same home — this row showing a blur instead was the two surfaces disagreeing.
 *
 * ANONYMOUS: no URL is sent at all, only the `hasPhoto` existence bit. A CSS blur over the
 * real <img> would be no gate — the full-resolution URL would sit in the DOM — so
 * `/api/property/{key}/photo-blur` returns a 24px-wide blurred stand-in from which the
 * original cannot be recovered: a few hundred bytes of colour massing that reads as "a
 * brick semi" and nothing more.
 *
 * The blur is deliberately NOT precomputed into a column. The route generates at most once
 * per listing anyone actually views and is then cached immutably at the CDN, which costs
 * far less than blurring every record up front — and it stays correct if a listing's photos
 * change. That immutable cache is also why the route itself stays anon-only rather than
 * growing an auth branch: one URL must not serve two different bodies.
 *
 * Falls back to a plain lock when the record has no photo, when the key is missing, or when
 * either image fails to load — never a broken image frame.
 */

import React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** MLS key of the record. */
  listingKey?: string;
  /** Whether a photo is known to exist — the existence bit the server sends instead of a URL. */
  hasPhoto?: boolean;
  /** The real lead photo — present only on a consumer's payload. Never optimized: MLS photos
   *  carry a burned-in brokerage watermark and re-encoding a DISPLAYED photo is a §6.3(f)
   *  problem as well as a cost. */
  photoUrl?: string;
  className?: string;
}

/**
 * Which image a record row renders, or null for the plain lock.
 *
 * A consumer's real photo wins; otherwise the anonymous blur, and only when the server said
 * a photo exists. `photoUrl` alone is enough — it IS proof of a photo, and the two bits come
 * from different reads (the gated archive can carry a photo the rolling sold_listings doc
 * lacks), so requiring both would drop a photo the server just handed us. Exported for test:
 * the signed-in-shows-blur bug lived entirely in this choice.
 */
export function recordThumbSrc(listingKey?: string, hasPhoto?: boolean, photoUrl?: string): string | null {
  if (photoUrl) return photoUrl;
  if (!listingKey || !hasPhoto) return null;
  return `/api/property/${encodeURIComponent(listingKey)}/photo-blur`;
}

export default function RecordThumb({ listingKey, hasPhoto, photoUrl, className }: Props) {
  const src = recordThumbSrc(listingKey, hasPhoto, photoUrl);

  // Remember WHICH src failed rather than a bare boolean: a new record landing in the same
  // row slot then gets a fresh attempt without an effect resetting state after render.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);

  const frame = cn("flex shrink-0 items-center justify-center bg-muted text-muted-foreground", className);

  if (!src || failedSrc === src) {
    return (
      <span className={frame} aria-hidden="true">
        <Lock className="h-3 w-3" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={cn("shrink-0 object-cover", className)}
    />
  );
}
