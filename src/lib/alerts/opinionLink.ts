/**
 * "Is the new price fair?" link for a price-drop row in an alert email (2026-11).
 *
 * The free price second-opinion produced 9 of 9 sale-side leads and the only closed deal
 * through Oct 2026. A price drop on a home the reader already watches is the moment they ask
 * whether the new price is fair, so the drop row offers the opinion directly. The link opens
 * the listing with the opinion form already open (`?ask=price_opinion`, read by AskOpener).
 *
 * Sale listings only: a tenant does not need an opinion on a sale price. The caller decides
 * from the feed's TransactionType, never from the price.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

export const OPINION_LINK_TEXT = "Is the new price fair? Get a free second opinion";

export function opinionUrl(listingKey: string): string {
  return `${SITE}/properties/${encodeURIComponent(listingKey)}?ask=price_opinion`;
}

export function opinionLinkHtml(listingKey: string): string {
  return `<div style="margin-top:8px;font-size:13px;"><a href="${opinionUrl(listingKey)}" style="color:#047857;font-weight:700;text-decoration:none;">${OPINION_LINK_TEXT} →</a></div>`;
}

export function opinionLinkText(listingKey: string): string {
  return `  ${OPINION_LINK_TEXT}: ${opinionUrl(listingKey)}`;
}
