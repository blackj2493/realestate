"use client";

import { useState } from "react";
import ImageBentoGrid from "@/components/Property/ImageBentoGrid";
import MediaGalleryOverlay from "@/components/Property/MediaGalleryOverlay";
import { LockedGallery } from "@/components/Property/LockedGallery";

const FRAME = "h-[260px] sm:h-[380px] lg:h-[460px]";

/**
 * The gallery frame, in one of three states.
 *
 * `photoTeaser` is present only for sold/leased/off-market records and survives VOW
 * gating, so it — not `images.length` — is what distinguishes "locked, N photos behind it"
 * from "there are genuinely none". An anonymous visitor gets empty `images` for those
 * records either way (gateVowDerived), which is why the count has to travel separately.
 */
export default function PropertyGallery({
  images,
  tourUrl,
  listingKey,
  photoTeaser,
  statusLabel,
}: {
  images: string[];
  tourUrl?: string;
  listingKey: string;
  photoTeaser?: { count: number } | null;
  statusLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  // Gated (or genuinely empty) sold record — LockedGallery picks which of those it is.
  if (images.length === 0 && photoTeaser) {
    return (
      <LockedGallery
        listingKey={listingKey}
        count={photoTeaser.count}
        label={statusLabel}
        className={FRAME}
      />
    );
  }

  return (
    <>
      <ImageBentoGrid
        images={images}
        onClick={() => images.length > 0 && setOpen(true)}
        className={FRAME}
        tourUrl={tourUrl}
      />
      <MediaGalleryOverlay images={images} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
