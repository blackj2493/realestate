"use client";

/**
 * Opens a lead form on arrival when the URL asks for one: `?ask=price_opinion` (2026-11).
 *
 * The price-drop rows in our alert emails link here, so a reader who clicked "Is the new
 * price fair?" lands with the opinion form already open, instead of looking for the button.
 * It dispatches the same `pp:open-viewing` event every listing button uses, so the request
 * goes through the normal lead pipeline. Only an active listing renders this component.
 */

import { useEffect } from "react";
import { isLeadIntent } from "@/components/Property/leadIntents";
import { track } from "@/lib/analytics/posthog";

export default function AskOpener({ listingKey, isLease }: { listingKey: string; isLease: boolean }) {
  useEffect(() => {
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (!isLeadIntent(ask)) return;
    // A price opinion is a buyer's question; on a lease it falls back to the default form.
    if (ask === "price_opinion" && isLease) return;
    // Wait one frame: the form registers its listener in its own mount effect.
    const id = window.requestAnimationFrame(() => {
      track("listing_cta_clicked", { listingKey, intent: ask, placement: "email_link" });
      window.dispatchEvent(new CustomEvent("pp:open-viewing", { detail: { listingKey, intent: ask } }));
    });
    return () => window.cancelAnimationFrame(id);
  }, [listingKey, isLease]);

  return null;
}
