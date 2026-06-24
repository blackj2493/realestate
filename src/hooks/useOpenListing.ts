"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import type { ListingDocument } from "@/lib/typesense/client";

/**
 * useOpenListing — single source of truth for "user opened a property" on the
 * Command Center.
 *
 * Desktop (≥768px): open the in-page Quick Look drawer (zero-fetch preview) by
 * setting the selected property in the store.
 *
 * Mobile (≤767px): there is no interim drawer — navigate straight to the full
 * server-rendered report at /properties/[id]. The 767 cutoff matches the page's
 * existing mobile definition (the list/map toggle + ledger card-mode both switch
 * at `md`), so phones go direct while tablets/desktop keep the drawer.
 *
 * Centralizing the branch here keeps the three click sources (ledger row, map
 * marker/popup, location search) in lockstep — they all call openListing().
 */
export function useOpenListing(): (property: ListingDocument) => void {
  const router = useRouter();
  const isMobile = useIsMobile(767);
  const setSelectedProperty = useCommandCenterStore((s) => s.setSelectedProperty);
  // Carry the active lens so the detail page opens on the persona the user was
  // browsing in (lens continuity). Desktop opens the in-page drawer instead, which
  // already reads the live store, so it needs no param.
  const activePersona = useCommandCenterStore((s) => s.activePersona);

  return useCallback(
    (property: ListingDocument) => {
      if (isMobile) {
        router.push(`/properties/${property.id}?lens=${activePersona}`);
      } else {
        setSelectedProperty(property);
      }
    },
    [isMobile, router, setSelectedProperty, activePersona]
  );
}

export default useOpenListing;
