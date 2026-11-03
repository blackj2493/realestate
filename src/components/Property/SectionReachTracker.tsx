"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics/posthog";

/**
 * Bump when the listing page's section order changes, so a PostHog breakdown by
 * `layoutVersion` compares one order with the next.
 * 2026-11-03: phones read overview → numbers → history → sold comps → details/area →
 * similar for sale → market grids → neighbourhood.
 */
export const LISTING_LAYOUT_VERSION = "2026-11-03";

/**
 * Fires `listing_section_reached` once per section per page view, when any part of an
 * element tagged `data-reach="<section>"` enters the viewport. A section rendered twice
 * (one copy for phones, one for desktop) shares the name; the hidden copy never
 * intersects, so it never fires. Only the listing key and the section name are sent
 * (posthog.ts compliance note).
 */
export default function SectionReachTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const layout = window.matchMedia("(min-width: 1024px)").matches ? "desktop" : "mobile";
    const seen = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const section = (entry.target as HTMLElement).dataset.reach;
        observer.unobserve(entry.target);
        if (!section || seen.has(section)) continue;
        seen.add(section);
        track("listing_section_reached", { listingId, section, layout, layoutVersion: LISTING_LAYOUT_VERSION });
      }
    });
    document.querySelectorAll<HTMLElement>("[data-reach]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [listingId]);
  return null;
}
