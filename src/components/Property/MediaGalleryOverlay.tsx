"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { TouchEvent as ReactTouchEvent } from "react";
import Image from "next/image";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface MediaGalleryOverlayProps {
  images: string[];
  isOpen: boolean;
  onClose: () => void;
  initialIndex?: number;
}

export default function MediaGalleryOverlay({
  images,
  isOpen,
  onClose,
  initialIndex = 0,
}: MediaGalleryOverlayProps) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const filmstripRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);

  // Reset index when overlay opens
  useEffect(() => {
    if (isOpen) {
      setCurrentIndex(initialIndex);
    }
  }, [isOpen, initialIndex]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  // Touch swipe navigation (mobile): record start X, compare against end X on release.
  const handleTouchStart = useCallback((e: ReactTouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: ReactTouchEvent) => {
      if (touchStartX.current === null) return;
      const deltaX = e.changedTouches[0].clientX - touchStartX.current;
      const SWIPE_THRESHOLD = 40; // px
      if (deltaX <= -SWIPE_THRESHOLD) {
        goToNext(); // swipe left → next
      } else if (deltaX >= SWIPE_THRESHOLD) {
        goToPrevious(); // swipe right → previous
      }
      touchStartX.current = null;
    },
    [goToNext, goToPrevious]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "ArrowLeft":
          goToPrevious();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, goToNext, goToPrevious]);

  // Scroll filmstrip to keep active thumbnail visible
  useEffect(() => {
    if (filmstripRef.current && isOpen) {
      const thumbnail = filmstripRef.current.children[currentIndex] as HTMLElement;
      if (thumbnail) {
        thumbnail.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "center",
        });
      }
    }
  }, [currentIndex, isOpen]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4 border-b border-border">
        {/* Counter */}
        <div className="font-mono text-muted-foreground text-sm">
          [{currentIndex + 1}] / [{images.length}]
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="flex items-center justify-center min-w-[44px] min-h-[44px] hover:bg-muted rounded-md transition-colors"
          aria-label="Close gallery"
        >
          <X className="w-6 h-6 text-muted-foreground" />
        </button>
      </div>

      {/* Main Stage */}
      <div
        className="flex-1 relative flex items-center justify-center p-2 md:px-16 md:py-4"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Previous Button */}
        {images.length > 1 && (
          <button
            onClick={goToPrevious}
            className="absolute left-4 z-10 p-3 bg-card/80 hover:bg-muted rounded-full transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-8 h-8 text-foreground" />
          </button>
        )}

        {/* Current Image — fill the stage; object-contain keeps aspect ratio.
            No max-w/max-h caps: the flex-1 stage between header and filmstrip is
            the only bound, so the photo grows to the available space instead of
            sitting boxed in the middle. Source is Large/Largest, so this stays sharp. */}
        <div className="relative w-full h-full">
          {/* unoptimized: serve TRREB's watermarked bytes as-is (IDX §6.3(f)) and
              avoid paid image-optimizer cache churn on daily-changing listings.
              Mirrors ListingThumbnail + next.config policy. */}
          <Image
            src={images[currentIndex]}
            alt={`Property image ${currentIndex + 1}`}
            fill
            unoptimized
            className="object-contain"
            sizes="100vw"
            priority
          />
        </div>

        {/* Next Button */}
        {images.length > 1 && (
          <button
            onClick={goToNext}
            className="absolute right-4 z-10 p-3 bg-card/80 hover:bg-muted rounded-full transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="w-8 h-8 text-foreground" />
          </button>
        )}
      </div>

      {/* Filmstrip */}
      <div className="border-t border-border bg-card p-2 md:p-4">
        <div
          ref={filmstripRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900"
          style={{ scrollbarWidth: "thin" }}
        >
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`relative flex-shrink-0 w-14 h-14 md:w-20 md:h-20 rounded-md overflow-hidden transition-all ${
                index === currentIndex
                  ? "ring-2 ring-emerald-500 opacity-100"
                  : "opacity-50 hover:opacity-75"
              }`}
              aria-label={`Go to image ${index + 1}`}
            >
              <Image
                src={image}
                alt={`Thumbnail ${index + 1}`}
                fill
                unoptimized
                className="object-cover"
                sizes="80px"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
