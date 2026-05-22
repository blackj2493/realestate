"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
        {/* Counter */}
        <div className="font-mono text-slate-400 text-sm">
          [{currentIndex + 1}] / [{images.length}]
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-2 hover:bg-slate-800 rounded-md transition-colors"
          aria-label="Close gallery"
        >
          <X className="w-6 h-6 text-slate-400" />
        </button>
      </div>

      {/* Main Stage */}
      <div className="flex-1 relative flex items-center justify-center p-8">
        {/* Previous Button */}
        {images.length > 1 && (
          <button
            onClick={goToPrevious}
            className="absolute left-4 z-10 p-3 bg-slate-900/80 hover:bg-slate-800 rounded-full transition-colors"
            aria-label="Previous image"
          >
            <ChevronLeft className="w-8 h-8 text-slate-300" />
          </button>
        )}

        {/* Current Image */}
        <div className="relative w-full h-full max-w-6xl max-h-[70vh]">
          <Image
            src={images[currentIndex]}
            alt={`Property image ${currentIndex + 1}`}
            fill
            className="object-contain"
            sizes="100vw"
            priority
          />
        </div>

        {/* Next Button */}
        {images.length > 1 && (
          <button
            onClick={goToNext}
            className="absolute right-4 z-10 p-3 bg-slate-900/80 hover:bg-slate-800 rounded-full transition-colors"
            aria-label="Next image"
          >
            <ChevronRight className="w-8 h-8 text-slate-300" />
          </button>
        )}
      </div>

      {/* Filmstrip */}
      <div className="border-t border-slate-800 bg-slate-900/50 p-4">
        <div
          ref={filmstripRef}
          className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-slate-900"
          style={{ scrollbarWidth: "thin" }}
        >
          {images.map((image, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`relative flex-shrink-0 w-20 h-20 rounded-md overflow-hidden transition-all ${
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
