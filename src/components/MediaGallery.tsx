"use client";

import { useState, useMemo } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

interface MediaItem {
  MediaURL: string;
  ShortDescription?: string;
  Order?: number;
  MediaKey?: string;
  MediaCategory?: string;
}

interface MediaGalleryProps {
  media: MediaItem[];
}

export default function MediaGallery({ media }: MediaGalleryProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showLightbox, setShowLightbox] = useState(false);

  // Enhanced deduplication logic - filter for photos only and remove duplicates
  const uniqueMedia = useMemo(() => {
    const uniqueUrls = new Map();
    
    // First filter for photos only, then deduplicate
    return media
      .filter(item => item.MediaCategory === "Photo" || !item.MediaCategory)
      .filter(item => {
        // Clean the URL by removing any query parameters or trailing spaces
        const cleanUrl = item.MediaURL.split("?")[0].trim();
        
        if (!uniqueUrls.has(cleanUrl)) {
          uniqueUrls.set(cleanUrl, true);
          return true;
        }
        return false;
      });
  }, [media]);

  const handlePrevious = () => {
    setSelectedIndex((prev) => (prev === 0 ? uniqueMedia.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setSelectedIndex((prev) => (prev === uniqueMedia.length - 1 ? 0 : prev + 1));
  };

  // If no media or all duplicates, show placeholder
  if (!uniqueMedia.length) {
    return (
      <div className="h-[600px] bg-gray-100 flex items-center justify-center rounded-lg">
        <p className="text-muted-foreground">No images available</p>
      </div>
    );
  }

  return (
    <>
      {/* Main Gallery Grid - HouseSigma style */}
      <div className="relative grid grid-cols-4 grid-rows-2 gap-2 h-[600px] mb-8 rounded-lg overflow-hidden">
        {/* Main Large Image - takes 2x2 space */}
        <div 
          className="col-span-2 row-span-2 relative cursor-pointer"
          onClick={() => {
            setSelectedIndex(0);
            setShowLightbox(true);
          }}
        >
          <img
            src={uniqueMedia[0]?.MediaURL}
            alt={uniqueMedia[0]?.ShortDescription || "Main property photo"}
            className="w-full h-full object-cover"
          />
        </div>

        {/* Smaller Images Grid - 2x2 grid of smaller images */}
        {uniqueMedia.slice(1, 5).map((item, index) => (
          <div
            key={item.MediaKey || item.MediaURL}
            className="relative cursor-pointer"
            onClick={() => {
              setSelectedIndex(index + 1);
              setShowLightbox(true);
            }}
          >
            <img
              src={item.MediaURL}
              alt={item.ShortDescription || `Property photo ${index + 2}`}
              className="w-full h-full object-cover"
            />
          </div>
        ))}

        {/* Remaining Photos Counter */}
        {uniqueMedia.length > 5 && (
          <div 
            className="absolute right-4 bottom-4 bg-black/70 text-white px-3 py-1 rounded-full cursor-pointer hover:bg-black/80 transition-colors"
            onClick={() => {
              setSelectedIndex(5);
              setShowLightbox(true);
            }}
          >
            +{uniqueMedia.length - 5} photos
          </div>
        )}
      </div>

      {/* Lightbox */}
      {showLightbox && (
        <div className="fixed inset-0 bg-black z-50 flex">
          {/* Close Button */}
          <button
            onClick={() => setShowLightbox(false)}
            className="absolute top-4 right-4 text-white z-10 p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-8 h-8" />
          </button>

          {/* Sidebar with Thumbnails */}
          <div className="w-[200px] h-full overflow-y-auto bg-black/50 p-2 flex flex-col">
            <div className="grid grid-cols-2 gap-2 auto-rows-[100px]">
              {uniqueMedia.map((item, index) => (
                <div
                  key={item.MediaKey || item.MediaURL}
                  className={`cursor-pointer transition-opacity rounded overflow-hidden ${
                    index === selectedIndex ? "ring-2 ring-white" : "opacity-50 hover:opacity-75"
                  }`}
                  onClick={() => setSelectedIndex(index)}
                >
                  <img
                    src={item.MediaURL}
                    alt={item.ShortDescription || `Property photo ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Main Image */}
          <div className="flex-1 relative flex items-center justify-center p-4">
            <img
              src={uniqueMedia[selectedIndex]?.MediaURL}
              alt={uniqueMedia[selectedIndex]?.ShortDescription || "Property photo"}
              className="max-h-full max-w-full object-contain"
            />

            {/* Navigation Buttons */}
            <button
              onClick={handlePrevious}
              className="absolute left-4 text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
            <button
              onClick={handleNext}
              className="absolute right-4 text-white p-2 rounded-full hover:bg-white/10 transition-colors"
            >
              <ChevronRight className="w-8 h-8" />
            </button>

            {/* Image Counter */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white bg-black/50 px-3 py-1 rounded-full">
              {selectedIndex + 1} / {uniqueMedia.length}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
