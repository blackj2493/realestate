/**
 * Welcome email — sent once, on first authenticated load (see /api/welcome).
 *
 * Pure renderer: {subject, html, text} from a WelcomeInput (§4 — deterministic,
 * no LLM). Personalized when `intent` (the area they were viewing pre-signup) is
 * present, generic otherwise. Its job is ACTIVATION: get the user to save an area
 * or add a watchlist listing, which is what switches on the daily alerts digest.
 *
 * Compliance:
 *  - No VOW data in email. We show ACTIVE (for-sale) listings and an active count
 *    only — never a sold price (those stay behind the authenticated session).
 *  - TRREB §6.3(c): every listing card carries its brokerage ("Listed by …").
 *  - TRREB §6.3(f): the listing photo is the TRREB thumbnail URL as-is (watermark
 *    baked in); we never substitute a stock image when a photo is missing.
 *  - CASL: sender identified (company name + mailing address in the footer) and
 *    every send carries a working unsubscribe link.
 */

export interface WelcomeIntent {
  label: string; // "Madawaska Valley"
  slug: string; // "madawaska-valley"
  prov?: string; // "on"
}

/** A single for-sale listing preview card (active listings only — never sold). */
export interface WelcomeCardListing {
  address: string;
  city: string;
  price: number;
  propertyType: string;
  beds?: number;
  baths?: number;
  sqft?: number | null;
  brokerage?: string | null;
  photoUrl?: string | null; // absolute TRREB thumbnail URL, or null → no image cell
  url?: string; // absolute link to the listing detail page
}

export interface WelcomeInput {
  name?: string | null;
  intent?: WelcomeIntent | null;
  /** Active for-sale listings in the intent area (best-effort; null = unknown). */
  listingCount?: number | null;
  /** Up to 2 sample for-sale listings to preview as cards (best-effort; may be empty). */
  listings?: WelcomeCardListing[];
  siteUrl: string;
  /** Primary CTA target (already absolute). */
  ctaUrl: string;
  unsubscribeUrl: string;
}

// CASL sender identification — company name + mailing address on every commercial
// send. Kept here (not env) so the compliance footer can never silently go missing.
const SENDER_LINE = "pureproperty.ca · 268 America Avenue, Maple, ON L6A 3G7";

// Light TRREB PropertySubType → human label map (matches PropertyCard's labels).
const TYPE_LABEL: Record<string, string> = {
  Detached: "House",
  "Semi-Detached": "Semi-Det",
  "Att/Row/Townhouse": "Townhouse",
  Townhouse: "Townhouse",
  "Condo Apartment": "Condo",
  "Condo Townhouse": "Condo Townhouse",
  Apartment: "Apartment",
  Duplex: "Duplex",
  Triplex: "Triplex",
  "Vacant Land": "Land",
};

function firstName(name?: string | null): string {
  const n = (name || "").trim().split(/\s+/)[0];
  return n || "there";
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n: number) => "$" + Math.round(n || 0).toLocaleString("en-CA");

const typeLabel = (t: string) => TYPE_LABEL[t] || t;

function featureLine(l: WelcomeCardListing): string {
  return [
    l.beds && l.beds > 0 ? `${l.beds} bd` : "",
    l.baths && l.baths > 0 ? `${l.baths} ba` : "",
    l.sqft && l.sqft > 0 ? `${l.sqft.toLocaleString("en-CA")} sq ft` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Wordmark, matching public/logo.svg: chevron + PURE (bold white), PROPERTY (slate),
// .ca (faint). Rendered as text, not an <img>/SVG, so it survives Gmail (which strips
// inline SVG and often blocks remote images).
const WORDMARK =
  `<div style="margin-bottom:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">` +
  `<span style="font-weight:400;color:#ffffff;margin-right:7px;">&#10094;</span>` +
  `PURE<span style="font-weight:400;color:#8FA4B8;">PROPERTY</span><span style="font-weight:400;color:#6B7E92;">.ca</span>` +
  `</div>`;

// Email-safe property card (table layout for Outlook). Mirrors PropertyCard: photo,
// price, address, city · type, beds/baths/sqft, and the required brokerage line.
function renderCard(l: WelcomeCardListing): string {
  const meta = [l.city, l.propertyType ? typeLabel(l.propertyType) : ""]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  const feats = featureLine(l);
  const imgCell = l.photoUrl
    ? `<td width="116" valign="top" style="width:116px;"><img src="${esc(l.photoUrl)}" width="116" height="92" alt="${esc(l.address)}" style="display:block;width:116px;height:92px;object-fit:cover;border:0;"/></td>`
    : "";
  const inner = `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background:#111b2e;border:1px solid #20293b;border-radius:10px;overflow:hidden;margin:0 0 10px;">
      <tr>${imgCell}<td valign="top" style="padding:12px 14px;">
        <div style="font-size:17px;font-weight:700;color:#ffffff;">${money(l.price)}</div>
        <div style="font-size:14px;font-weight:600;color:#e6ecf4;margin-top:2px;">${esc(l.address)}</div>
        ${meta ? `<div style="font-size:13px;color:#8fa4b8;margin-top:2px;">${meta}</div>` : ""}
        ${feats ? `<div style="font-size:13px;color:#c6d0de;margin-top:6px;">${feats}</div>` : ""}
        ${l.brokerage ? `<div style="font-size:12px;color:#6b7e92;margin-top:7px;">Listed by ${esc(l.brokerage)}</div>` : ""}
      </td></tr></table>`;
  return l.url
    ? `<a href="${esc(l.url)}" style="text-decoration:none;color:inherit;display:block;">${inner}</a>`
    : inner;
}

export function renderWelcomeEmail(input: WelcomeInput): { subject: string; html: string; text: string } {
  const { name, intent, listingCount, siteUrl, ctaUrl, unsubscribeUrl } = input;
  const fn = firstName(name);
  const label = intent?.label ?? "";
  const hasIntent = !!label;
  const hasCount = typeof listingCount === "number" && listingCount > 0;
  const count = hasCount ? listingCount!.toLocaleString("en-CA") : "";
  const cards = (input.listings ?? []).slice(0, 2);

  const subject = hasIntent
    ? hasCount
      ? `${count} homes for sale in ${label}`
      : `Homes for sale in ${label}`
    : "Pick an area to watch";

  const ctaLabel = hasIntent
    ? hasCount
      ? `See ${count} homes in ${label}`
      : `See homes in ${label}`
    : "Find your area";

  // Connector before the cards, only when we actually have cards to show.
  const connector = cards.length === 0 ? "" : cards.length === 1 ? " Here's one:" : " Here are two:";

  const lead = hasIntent
    ? hasCount
      ? `You searched <strong>${esc(label)}</strong> before signing up. There are <strong>${count}</strong> homes for sale there today.${connector}`
      : `You searched <strong>${esc(label)}</strong> before signing up.${connector}`
    : `PureProperty covers every active Ontario MLS&reg; listing, with the cap rate, school scores, and zoning most sites leave out.`;

  const action = hasIntent
    ? `Save the area, or add a home to your watchlist. We'll send one email a day when a price changes or a new home comes up.`
    : `Choose an area to follow. We'll email you once a day when prices move or new homes come up.`;

  const cardsHtml = cards.map(renderCard).join("");

  const textLead = hasIntent
    ? hasCount
      ? `You searched ${label} before signing up. There are ${count} homes for sale there today.`
      : `You searched ${label} before signing up.`
    : `PureProperty covers every active Ontario MLS listing, with the cap rate, school scores, and zoning most sites leave out.`;

  const textCards = cards
    .map((l) => {
      const feats = featureLine(l);
      return `- ${money(l.price)} — ${l.address}, ${l.city}${feats ? ` (${feats})` : ""}${
        l.brokerage ? ` · Listed by ${l.brokerage}` : ""
      }`;
    })
    .join("\n");

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#e2e8f0;">
    ${WORDMARK}
    <p style="font-size:16px;line-height:1.5;color:#ffffff;margin:0 0 14px;">Hi ${esc(fn)},</p>
    <p style="font-size:15px;line-height:1.62;color:#c6d0de;margin:0 0 16px;">${lead}</p>
    ${cardsHtml}
    <p style="font-size:15px;line-height:1.62;color:#c6d0de;margin:${cardsHtml ? "14px" : "0"} 0 22px;">${action}</p>
    <a href="${esc(ctaUrl)}" style="display:inline-block;background:#10b981;color:#04120c;font-weight:700;text-decoration:none;font-size:14px;padding:11px 20px;border-radius:8px;">${esc(ctaLabel)}</a>
    ${hasIntent ? `<p style="font-size:13px;line-height:1.6;color:#8fa4b8;margin:22px 0 0;">You can change or mute your areas anytime.</p>` : ""}
    <hr style="border:none;border-top:1px solid #20293b;margin:26px 0 15px;" />
    <p style="font-size:11.5px;line-height:1.6;color:#6b7e92;margin:0;">
      ${SENDER_LINE}.<br/>
      You're getting this because you created an account.
      <a href="${esc(unsubscribeUrl)}" style="color:#7c8aa0;text-decoration:underline;">Unsubscribe</a>.
    </p>
  </div></body></html>`;

  const text = [
    `Hi ${fn},`,
    ``,
    textLead,
    ...(textCards ? [``, textCards] : []),
    ``,
    action,
    ``,
    `${ctaLabel}: ${ctaUrl}`,
    ...(hasIntent ? [``, `You can change or mute your areas anytime.`] : []),
    ``,
    SENDER_LINE,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
