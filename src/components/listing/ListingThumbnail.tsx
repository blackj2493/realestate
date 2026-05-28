"use client";

import Image from "next/image";
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Listing thumbnail with a NEUTRAL text-only fallback — never a stock placeholder.
 *
 * Why no stock placeholder: rendering an unrelated stock image next to a real
 * listing risks consumers thinking the photo represents that property. IDX §6.3(f)
 * also bars us from "changing" data displayed from the feed, and a wrong photo
 * inflates that risk.
 *
 * Sizing: this is a `fill` Image, so the parent must be `relative` with explicit
 * height/width (or aspect ratio). Pass the size classes via `className`.
 *
 * TRREB image URLs already encode size variants (`rs:fit:240:240`, etc.) and the
 * watermark is baked into the URL path, so we render `unoptimized` — Next's
 * `/_next/image` would re-encode bytes and risk stripping the watermark.
 */
export interface ListingThumbnailProps {
  /** Selected image URL. Pass null/empty for the text fallback. */
  src?: string | null;
  /** Alt text — should be the property address. */
  alt: string;
  /** Tailwind classes for the OUTER container (sets size). Should include `relative`. */
  className?: string;
  /** Optional `sizes` hint forwarded to next/image. */
  sizes?: string;
  /** Optional className applied to the <Image> element (e.g. group-hover scale). */
  imgClassName?: string;
  /** Per next/image — set `true` for above-the-fold hero images, default lazy. */
  priority?: boolean;
}

function isUsable(url?: string | null): url is string {
  return !!url && !url.includes("example.com") && !url.includes("images.unsplash.com");
}

export function ListingThumbnail({
  src,
  alt,
  className,
  sizes,
  imgClassName,
  priority,
}: ListingThumbnailProps) {
  const [errored, setErrored] = useState(false);
  const showImage = !errored && isUsable(src);

  return (
    <div className={cn("relative overflow-hidden bg-slate-800", className)}>
      {showImage ? (
        <Image
          src={src!}
          alt={alt}
          fill
          unoptimized
          sizes={sizes}
          priority={priority}
          loading={priority ? undefined : "lazy"}
          className={cn("object-cover", imgClassName)}
          onError={() => setErrored(true)}
        />
      ) : (
        <div
          aria-label="No photo available"
          className="flex h-full w-full items-center justify-center bg-slate-800/60 text-slate-500"
        >
          <ImageOff className="h-1/3 w-1/3 opacity-50" strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
