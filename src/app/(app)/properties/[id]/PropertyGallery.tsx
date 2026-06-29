"use client";

import { useState } from "react";
import ImageBentoGrid from "@/components/Property/ImageBentoGrid";
import MediaGalleryOverlay from "@/components/Property/MediaGalleryOverlay";

export default function PropertyGallery({ images, tourUrl }: { images: string[]; tourUrl?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <ImageBentoGrid
        images={images}
        onClick={() => images.length > 0 && setOpen(true)}
        className="h-[220px] sm:h-[320px] lg:h-[420px]"
        tourUrl={tourUrl}
      />
      <MediaGalleryOverlay images={images} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
