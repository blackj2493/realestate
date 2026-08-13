"use client";

/**
 * The lead photo of a sold / leased / off-market record, redacted server-side.
 *
 * A record's photo URL is VOW Listing Information and must never reach the browser, so a
 * CSS blur over the real <img> would be no gate at all — the full-resolution URL would sit
 * in the DOM. `/api/property/{key}/photo-blur` instead returns a 24px-wide blurred stand-in
 * from which the original cannot be recovered: a few hundred bytes of colour massing that
 * reads as "a brick semi" and nothing more.
 *
 * Deliberately NOT precomputed into a column. The route generates at most once per listing
 * anyone actually views and is then cached immutably at the CDN, which costs far less than
 * blurring every record up front — and it stays correct if a listing's photos change. (The
 * route's own header makes this argument; this component just honours it.)
 *
 * Falls back to a plain lock when the record has no photo, when the key is missing, or when
 * generation fails — never a broken image frame.
 */

import React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** MLS key of the record. */
  listingKey?: string;
  /** Whether a photo is known to exist — the existence bit the server sends instead of a URL. */
  hasPhoto?: boolean;
  className?: string;
}

export default function RecordThumb({ listingKey, hasPhoto, className }: Props) {
  // Remember WHICH key failed rather than a bare boolean: a new record landing in the same
  // row slot then gets a fresh attempt without an effect resetting state after render.
  const [failedKey, setFailedKey] = React.useState<string | null>(null);
  const failed = !!listingKey && failedKey === listingKey;

  const frame = cn("flex shrink-0 items-center justify-center bg-muted text-muted-foreground", className);

  if (!listingKey || !hasPhoto || failed) {
    return (
      <span className={frame} aria-hidden="true">
        <Lock className="h-3 w-3" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/property/${listingKey}/photo-blur`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailedKey(listingKey)}
      className={cn("shrink-0 object-cover", className)}
    />
  );
}
