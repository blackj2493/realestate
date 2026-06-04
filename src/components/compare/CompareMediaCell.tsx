"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Images } from "lucide-react";
import dynamic from "next/dynamic";
import { ListingThumbnail } from "@/components/listing/ListingThumbnail";
import type { ListingDocument } from "@/lib/typesense/client";

// Overlay is heavy + only needed on click — load it lazily, never 4× up front.
const MediaGalleryOverlay = dynamic(
  () => import("@/components/Property/MediaGalleryOverlay"),
  { ssr: false }
);

export default function CompareMediaCell({ listing }: { listing: ListingDocument }) {
  const images = useMemo(() => {
    const all = listing.RawImages?.length
      ? listing.RawImages
      : [listing.primaryImageUrl, listing.thumbnailUrl].filter((u): u is string => Boolean(u));
    return Array.from(new Set(all));
  }, [listing.RawImages, listing.primaryImageUrl, listing.thumbnailUrl]);

  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  const count = images.length;
  const current = images[Math.min(idx, Math.max(0, count - 1))] ?? null;

  const step = (d: number) => setIdx((i) => (count ? (i + d + count) % count : 0));

  return (
    <div className="relative mb-2 h-40 w-full overflow-hidden rounded-md bg-slate-800 md:h-64">
      <button
        type="button"
        onClick={() => count > 0 && setOpen(true)}
        className="block h-full w-full"
        aria-label={count > 0 ? `Open ${count} photos` : "No photos"}
      >
        <ListingThumbnail
          src={current}
          alt={listing.UnparsedAddress || "Listing"}
          className="h-full w-full"
          imgClassName="object-cover"
        />
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous photo"
            className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 p-1 text-slate-200 hover:bg-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next photo"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-slate-950/70 p-1 text-slate-200 hover:bg-slate-900"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute bottom-1 right-1 inline-flex items-center gap-1 rounded bg-slate-950/70 px-1.5 py-0.5 text-[10px] font-mono text-slate-200">
            <Images className="h-3 w-3" /> {Math.min(idx, count - 1) + 1}/{count}
          </span>
        </>
      )}

      {open && (
        <MediaGalleryOverlay
          images={images}
          isOpen={open}
          initialIndex={idx}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
