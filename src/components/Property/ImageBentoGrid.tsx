"use client";

import Image from "next/image";
import { CameraOff, Images, Play } from "lucide-react";

interface ImageBentoGridProps {
  images: string[];
  onClick?: () => void;
  className?: string;
  /** Unbranded virtual-tour URL — surfaces as a badge on the hero (opens in a new tab). */
  tourUrl?: string;
}

/** "▶ Virtual Tour" badge overlaid on the hero — high-intent, so it rides the photo
 *  (where the eye already is) instead of being buried in the data sheet. */
function TourBadge({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-3 top-3 z-20 flex min-h-[40px] items-center gap-2 rounded-md border border-cyan-400/50 bg-slate-950/80 px-3 py-2 font-mono text-xs tracking-wide text-cyan-200 backdrop-blur-sm transition-colors hover:bg-slate-900/90"
    >
      <Play className="h-4 w-4 fill-current" />
      VIRTUAL TOUR
    </a>
  );
}

// Fallback placeholder when no images
function EmptyState() {
  return (
    <div className="w-full h-full bg-slate-900 flex flex-col items-center justify-center">
      <CameraOff className="w-8 h-8 text-slate-600 mb-2" />
      <span className="font-mono text-slate-500 text-xs">NO MEDIA</span>
    </div>
  );
}

export default function ImageBentoGrid({ images, onClick, className = "", tourUrl }: ImageBentoGridProps) {
  // No images - show placeholder
  if (!images || images.length === 0) {
    return (
      <div className={`relative rounded-md overflow-hidden ${className}`}>
        <EmptyState />
      </div>
    );
  }

  return (
    <>
      {/* Mobile (<md): single full-bleed hero with a tappable "VIEW ALL PHOTOS" pill.
          The fixed 2-col bento is gesture-dead and too tall on a phone, so on mobile we
          show one hero image plus an explicit affordance that opens the gallery overlay. */}
      <div
        className={`relative md:hidden rounded-md overflow-hidden cursor-pointer group ${className}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
      >
        <Image
          src={images[0]}
          alt="Property main view"
          fill
          className="object-cover rounded-md"
          sizes="100vw"
          priority
        />

        {tourUrl && <TourBadge url={tourUrl} />}

        {/* "VIEW ALL PHOTOS (N)" pill — ≥44px tap target */}
        <div className="absolute bottom-3 right-3 flex items-center gap-2 min-h-[44px] px-4 py-2 bg-black/70 backdrop-blur-sm rounded-md">
          <Images className="w-4 h-4 text-white" />
          <span className="font-mono text-white text-xs tracking-wide">
            VIEW ALL PHOTOS ({images.length})
          </span>
        </div>
      </div>

      {/* Desktop (≥md): 2-row bento. Hero fills the entire left column (row-span-2);
          right column holds two pairs of stacked thumbnails (rows 1 and 2), 4 thumbs
          total + "+N more" on the 4th. Visually unchanged from before. */}
      <div
        className={`relative hidden md:grid md:grid-cols-2 md:grid-rows-2 gap-2 rounded-md overflow-hidden cursor-pointer group ${className}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClick?.();
          }
        }}
      >
      {/* Hero — left column, full height.
          sizes: full-width on mobile (single-column stack); ~35% of viewport on
          desktop where the listing page uses a 70/30 split and the bento occupies
          the 70% left pane (~50% of that pane width = ~35vw). */}
      <div
        className="relative col-span-1 row-span-2 min-h-[180px] sm:min-h-[300px]"
        onClick={(e) => {
          e.stopPropagation();
          onClick?.();
        }}
      >
        <Image
          src={images[0]}
          alt="Property main view"
          fill
          className="object-cover rounded-md"
          sizes="(max-width: 768px) 100vw, 35vw"
          priority
        />
        {tourUrl && <TourBadge url={tourUrl} />}
      </div>

      {/* Right column, row 1 — top pair of thumbnails stacked vertically */}
      <div className="flex flex-col gap-2">
        {images[1] && (
          <div
            className="relative flex-1 min-h-[70px]"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <Image
              src={images[1]}
              alt="Property view 2"
              fill
              className="object-cover rounded-md"
              sizes="(max-width: 768px) 50vw, 18vw"
            />
          </div>
        )}
        {images[2] && (
          <div
            className="relative flex-1 min-h-[70px]"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <Image
              src={images[2]}
              alt="Property view 3"
              fill
              className="object-cover rounded-md"
              sizes="(max-width: 768px) 50vw, 18vw"
            />
          </div>
        )}
      </div>

      {/* Right column, row 2 — bottom pair of thumbnails stacked vertically */}
      <div className="flex flex-col gap-2">
        {images[3] && (
          <div
            className="relative flex-1 min-h-[70px]"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <Image
              src={images[3]}
              alt="Property view 4"
              fill
              className="object-cover rounded-md"
              sizes="(max-width: 768px) 50vw, 18vw"
            />
          </div>
        )}
        {images[4] && (
          <div
            className="relative flex-1 min-h-[70px]"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
          >
            <Image
              src={images[4]}
              alt="Property view 5"
              fill
              className="object-cover rounded-md"
              sizes="(max-width: 768px) 50vw, 18vw"
            />

            {/* Overflow indicator on the 5th thumbnail */}
            {images.length > 5 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                <span className="font-mono text-white text-sm">
                  +{images.length - 5} PHOTOS
                </span>
              </div>
            )}
          </div>
        )}
      </div>

        {/* Hover overlay hint */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-md" />
      </div>
    </>
  );
}
