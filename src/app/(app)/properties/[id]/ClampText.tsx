"use client";

/**
 * ClampText — shows long free-text (the listing remarks) in full on desktop, but
 * clamps it to a few lines on phones with a "Show more" toggle so the marketing
 * blurb stops eating half a dozen screens of mobile scroll. Short text renders
 * plainly with no toggle.
 */

import React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function ClampText({
  text,
  className,
  lines = 5,
  threshold = 280,
}: {
  text: string;
  className?: string;
  lines?: number;
  threshold?: number;
}) {
  const isMobile = useIsMobile(767);
  const [expanded, setExpanded] = React.useState(false);

  // Desktop, or short text: render in full, no toggle.
  if (!isMobile || text.length < threshold) {
    return <p className={cn("whitespace-pre-line", className)}>{text}</p>;
  }

  const clamp = !expanded;
  return (
    <div>
      <p
        className={cn("whitespace-pre-line", className)}
        style={
          clamp
            ? { display: "-webkit-box", WebkitLineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" }
            : undefined
        }
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider text-cyan-400 active:text-cyan-300"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
