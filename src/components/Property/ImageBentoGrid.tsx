"use client";

import Image from "next/image";
import { CameraOff } from "lucide-react";

interface ImageBentoGridProps {
  images: string[];
  onClick?: () => void;
  className?: string;
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

export default function ImageBentoGrid({ images, onClick, className = "" }: ImageBentoGridProps) {
  // No images - show placeholder
  if (!images || images.length === 0) {
    return (
      <div className={`relative grid grid-cols-2 grid-rows-2 gap-2 rounded-md overflow-hidden ${className}`}>
        <EmptyState />
      </div>
    );
  }

  // Bento layout: 5 images max
  // Hero image (left) spans 2 rows, 4 thumbnails (right) in 2x2 grid
  return (
    <div 
      className={`relative grid grid-cols-2 grid-rows-4 gap-2 rounded-md overflow-hidden cursor-pointer group ${className}`}
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
      {/* Hero Image - spans 2 rows (row-span-2 means 2 of 4 rows, so we use row-span-2 on a 4-row grid) */}
      {/* Actually, let's use a simpler approach: 2 columns, left image takes 2 rows */}
      <div 
        className="relative col-span-1 row-span-2 min-h-[300px]"
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
          sizes="(max-width: 768px) 50vw, 25vw"
          priority
        />
      </div>

      {/* Top-right thumbnail */}
      {images[1] && (
        <div 
          className="relative row-span-1 min-h-[146px]"
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
            sizes="(max-width: 768px) 50vw, 25vw"
          />
        </div>
      )}

      {/* Second row right (empty if only 2 images) */}
      {images[2] && (
        <div 
          className="relative row-span-1 min-h-[146px]"
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
            sizes="(max-width: 768px) 50vw, 25vw"
          />
        </div>
      )}

      {/* Third image if exists, fills bottom-left hero area... wait, hero is already spanning */}
      {/* Actually hero spans 2 rows (row 1-2), so images 2 and 3 are row 1-2 right column */}
      {/* We need 4 rows total for proper bento: rows 1-2 left (hero), rows 1-4 right column */}
      
      {/* Re-thinking the grid: 
          Grid is 2 cols x 4 rows
          Hero: col 1, rows 1-2 (span 2 rows)
          img 2: col 2, row 1
          img 3: col 2, row 2
          img 4: col 2, row 3
          img 5: col 2, row 4
      */}
      
      {/* Wait, let me recalculate - we want 5 images in bento:
          Hero (big): 1 column, 2 rows tall
          4 thumbnails: 1 column x 4 rows
          Total: 2 columns x 4 rows
      */}
      
      {/* Image 4 */}
      {images[3] && (
        <div 
          className="relative row-span-1 min-h-[146px]"
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
            sizes="(max-width: 768px) 50vw, 25vw"
          />
        </div>
      )}

      {/* Image 5 - with overlay if more images */}
      {images[4] && (
        <div 
          className="relative row-span-1 min-h-[146px]"
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
            sizes="(max-width: 768px) 50vw, 25vw"
          />
          
          {/* Overflow indicator */}
          {images.length > 5 && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
              <span className="font-mono text-white text-sm">
                +{images.length - 5} PHOTOS
              </span>
            </div>
          )}
        </div>
      )}

      {/* Hover overlay hint */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-md" />
    </div>
  );
}
