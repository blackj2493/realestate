/**
 * Combined nightly alerts digest — ONE email per user per day with up to three
 * sections (status changes / price drops / new listings in saved areas).
 * Pure renderer: subject + html + text from a DigestPayload (§4 — deterministic).
 *
 * Compliance:
 *  - Sold rows are a TEASE: the closing price never appears in email (VOW data
 *    stays behind the authenticated session). CTA links to the gated listing page.
 *  - Every listing card displays the listing brokerage (§4 mandatory display).
 *  - Photos are the watermarked TRREB thumbnail as-is; never a stock stand-in (§6.3f).
 *  - CASL: company name + mailing address in the footer, plus a one-click
 *    unsubscribe (the worker passes a signed URL; honoured via email_opt_out).
 */

import type { StatusAlertKind } from "./transitions";
import type { BubbleSection, NewListingAlert } from "./bubbleDigest";

export interface DropAlert {
  listing_key: string;
  address: string;
  city: string | null;
  oldPrice: number;
  newPrice: number;
  thumb: string | null;
  brokerage: string | null;
}

export interface StatusChangeAlert {
  listing_key: string;
  address: string;
  city: string | null;
  kind: StatusAlertKind;
  detail?: string;
  brokerage: string | null;
}

export interface DigestPayload {
  drops: DropAlert[];
  statusChanges: StatusChangeAlert[];
  bubbles: BubbleSection[];
}

/** Per-recipient options — the signed unsubscribe URL (CASL). */
export interface DigestOptions {
  unsubscribeUrl?: string;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const SENDER_LINE = "pureproperty.ca · 268 America Avenue, Maple, ON L6A 3G7";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KIND_LABEL: Record<StatusAlertKind, string> = {
  sold: "SOLD",
  "sold-conditional": "SOLD CONDITIONAL",
  "off-market": "OFF MARKET",
  "back-on-market": "BACK ON MARKET",
  gone: "NO LONGER ACTIVE",
};

const KIND_COLOR: Record<StatusAlertKind, string> = {
  sold: "#dc2626",
  "sold-conditional": "#d97706",
  "off-market": "#64748b",
  "back-on-market": "#0f766e",
  gone: "#64748b",
};

function statusLine(s: StatusChangeAlert): string {
  if (s.kind === "sold") return "Sign in to see the closing price";
  if (s.kind === "off-market")
    return `Listing ${s.detail ? s.detail.toLowerCase() : "removed"} — a relist often signals a motivated seller`;
  if (s.kind === "back-on-market") return "Relisted — previous campaign ended without a sale";
  if (s.kind === "sold-conditional") return "Offer accepted with conditions — can still fall through";
  return "Removed from the active feed";
}

// Wordmark, matching public/logo.svg: chevron + PURE (white), PROPERTY (slate),
// .ca (faint). Text, not SVG/img, so Gmail can't strip it.
const WORDMARK =
  `<div style="margin-bottom:20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;font-weight:800;letter-spacing:-0.02em;color:#ffffff;">` +
  `<span style="font-weight:400;color:#ffffff;margin-right:7px;">&#10094;</span>` +
  `PURE<span style="font-weight:400;color:#8FA4B8;">PROPERTY</span><span style="font-weight:400;color:#6B7E92;">.ca</span>` +
  `</div>`;

const sectionHeader = (title: string) =>
  `<div style="font-size:12px;color:#8fa4b8;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin:22px 0 10px;">${title}</div>`;

const brokerageLine = (b: string | null) =>
  b ? `<div style="color:#6b7e92;font-size:12px;margin-top:6px;">${esc(b)}</div>` : "";

const cardOpen =
  `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background:#111b2e;border:1px solid #20293b;border-radius:10px;overflow:hidden;margin:0 0 10px;"><tr>`;
const cardClose = `</tr></table>`;

const imgCell = (url: string, alt: string) =>
  `<td width="116" valign="top" style="width:116px;"><img src="${esc(url)}" width="116" height="92" alt="${esc(
    alt
  )}" style="display:block;width:116px;height:92px;object-fit:cover;border:0;"/></td>`;

// Whole-card link (no inner <a>) — used by drop + new-listing cards.
const linkWrap = (href: string, inner: string) =>
  `<a href="${href}" style="text-decoration:none;color:inherit;display:block;">${inner}</a>`;

function subjectFor(p: DigestPayload): string {
  const parts: string[] = [];
  const sold = p.statusChanges.filter((s) => s.kind === "sold").length;
  const otherStatus = p.statusChanges.length - sold;
  if (sold) parts.push(`${sold} sold`);
  if (otherStatus) parts.push(`${otherStatus} status change${otherStatus === 1 ? "" : "s"}`);
  if (p.drops.length) parts.push(`${p.drops.length} price drop${p.drops.length === 1 ? "" : "s"}`);
  const newCount = p.bubbles.reduce((n, b) => n + b.total, 0);
  if (newCount) parts.push(`${newCount} new listing${newCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Your PureProperty alerts";
}

// Status card — no photo, no price (sold price is gated); inner <a> links to the
// gated listing. Kept $-free so a status-only digest carries no dollar sign.
function statusCardHtml(s: StatusChangeAlert): string {
  const tease =
    s.kind === "sold"
      ? `<a href="${listingUrl(s.listing_key)}" style="color:#38bdf8;font-weight:600;text-decoration:none;">${statusLine(s)} →</a>`
      : statusLine(s);
  return `${cardOpen}<td style="padding:12px 14px;">
      <span style="display:inline-block;background:${KIND_COLOR[s.kind]};color:#ffffff;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:4px;vertical-align:middle;">${KIND_LABEL[s.kind]}</span>
      <a href="${listingUrl(s.listing_key)}" style="color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;margin-left:8px;">${esc(s.address || "Saved property")}</a>
      <div style="color:#8fa4b8;font-size:12px;margin-top:3px;">${esc(s.city || "")}</div>
      ${brokerageLine(s.brokerage)}
      <div style="margin-top:7px;font-size:13px;color:#c6d0de;">${tease}</div>
    </td>${cardClose}`;
}

function dropCardHtml(d: DropAlert): string {
  const cut = d.oldPrice - d.newPrice;
  const inner = `${cardOpen}${d.thumb ? imgCell(d.thumb, d.address || "Saved property") : ""}<td valign="top" style="padding:12px 14px;">
      <div style="font-size:15px;">
        <span style="color:#94a3b8;text-decoration:line-through;">${money(d.oldPrice)}</span>
        <span style="color:#8fa4b8;">&nbsp;→&nbsp;</span>
        <span style="color:#ffffff;font-weight:700;">${money(d.newPrice)}</span>
        <span style="color:#f06b6b;font-weight:700;">&nbsp;−${money(cut)}</span>
      </div>
      <div style="color:#e6ecf4;font-weight:600;font-size:14px;margin-top:4px;">${esc(d.address || "Saved property")}</div>
      <div style="color:#8fa4b8;font-size:12px;margin-top:2px;">${esc(d.city || "")}</div>
      ${brokerageLine(d.brokerage)}
    </td>${cardClose}`;
  return linkWrap(listingUrl(d.listing_key), inner);
}

function newCardHtml(l: NewListingAlert): string {
  const bb = [l.beds != null ? `${l.beds} bd` : "", l.baths != null ? `${l.baths} ba` : ""]
    .filter(Boolean)
    .join(" · ");
  const inner = `${cardOpen}${l.thumb ? imgCell(l.thumb, l.address) : ""}<td valign="top" style="padding:12px 14px;">
      ${l.price != null ? `<div style="font-size:16px;color:#ffffff;font-weight:700;">${money(l.price)}</div>` : ""}
      <div style="color:#e6ecf4;font-weight:600;font-size:14px;margin-top:2px;">${esc(l.address)}</div>
      <div style="color:#8fa4b8;font-size:12px;margin-top:2px;">${esc(l.city || "")}</div>
      ${bb ? `<div style="color:#c6d0de;font-size:13px;margin-top:6px;">${bb}</div>` : ""}
      ${brokerageLine(l.brokerage)}
    </td>${cardClose}`;
  return linkWrap(listingUrl(l.listing_key), inner);
}

function bubbleSectionHtml(b: BubbleSection): string {
  const title = `<div style="font-size:13px;font-weight:700;color:#e6ecf4;margin:14px 0 8px;">${esc(b.bubbleName)}</div>`;
  if (b.collapsed) {
    return `${title}
      <div style="font-size:13px;color:#8fa4b8;margin-top:4px;">
        ${b.total} new listings appeared in this area —
        <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#38bdf8;text-decoration:none;font-weight:600;">view them in the app</a>.
        Tip: smaller areas make sharper alerts.
      </div>`;
  }
  const cards = b.listings.map(newCardHtml).join("");
  const overflow =
    b.total > b.listings.length
      ? `<div style="font-size:12px;margin:2px 0 6px;">
           <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#38bdf8;text-decoration:none;font-weight:600;">+${b.total - b.listings.length} more in ${esc(b.bubbleName)} →</a>
         </div>`
      : "";
  return `${title}${cards}${overflow}`;
}

export function renderAlertsDigest(
  p: DigestPayload,
  opts: DigestOptions = {}
): { subject: string; html: string; text: string } {
  const subject = subjectFor(p);
  const unsubscribeUrl = opts.unsubscribeUrl || `${SITE}/dashboard`;

  const statusSection = p.statusChanges.length
    ? sectionHeader("Status changes") + p.statusChanges.map(statusCardHtml).join("")
    : "";
  const dropsSection = p.drops.length
    ? sectionHeader("Price drops") + p.drops.map(dropCardHtml).join("")
    : "";
  const bubblesSection = p.bubbles.length
    ? sectionHeader("New in your areas") + p.bubbles.map(bubbleSectionHtml).join("")
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:28px 24px;color:#e2e8f0;">
      ${WORDMARK}
      <h1 style="font-size:18px;color:#ffffff;margin:0 0 4px;">What changed in your areas</h1>
      <p style="color:#8fa4b8;font-size:13px;margin:0;">${subject}</p>
      ${statusSection}
      ${dropsSection}
      ${bubblesSection}
      <a href="${SITE}/dashboard" style="display:inline-block;margin-top:22px;background:#10b981;color:#04120c;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:700;">Open your dashboard</a>
      <hr style="border:none;border-top:1px solid #20293b;margin:26px 0 15px;" />
      <p style="color:#6b7e92;font-size:11.5px;margin:0;line-height:1.6;">
        ${SENDER_LINE}.<br/>
        You saved these properties or areas on PureProperty.
        <a href="${SITE}/dashboard" style="color:#7c8aa0;text-decoration:underline;">Manage alerts</a> ·
        <a href="${esc(unsubscribeUrl)}" style="color:#7c8aa0;text-decoration:underline;">Unsubscribe</a>.<br/>
        Data is deemed reliable but not guaranteed accurate. Powered by PROPTX MLS®.
      </p>
    </div>
  </body></html>`;

  const textParts: string[] = [];
  if (p.statusChanges.length) {
    textParts.push(
      "Status changes:\n" +
        p.statusChanges
          .map((s) => {
            const tail = s.kind === "sold" ? "Sign in to see the closing price" : statusLine(s);
            return `• [${KIND_LABEL[s.kind]}] ${s.address}${s.brokerage ? ` — ${s.brokerage}` : ""}\n  ${tail}: ${listingUrl(s.listing_key)}`;
          })
          .join("\n")
    );
  }
  if (p.drops.length) {
    textParts.push(
      "Price drops:\n" +
        p.drops
          .map(
            (d) =>
              `• ${d.address}${d.brokerage ? ` — ${d.brokerage}` : ""} — ${money(d.oldPrice)} -> ${money(d.newPrice)} (-${money(d.oldPrice - d.newPrice)})\n  ${listingUrl(d.listing_key)}`
          )
          .join("\n")
    );
  }
  if (p.bubbles.length) {
    textParts.push(
      "New in your areas:\n" +
        p.bubbles
          .map((b) =>
            b.collapsed
              ? `• ${b.bubbleName}: ${b.total} new listings — view in the app`
              : `• ${b.bubbleName} (${b.total} new):\n` +
                b.listings
                  .map(
                    (l) =>
                      `   - ${l.address}${l.price != null ? ` — ${money(l.price)}` : ""}${l.brokerage ? ` — ${l.brokerage}` : ""}\n     ${listingUrl(l.listing_key)}`
                  )
                  .join("\n")
          )
          .join("\n")
    );
  }
  const text =
    textParts.join("\n\n") +
    `\n\nOpen your dashboard: ${SITE}/dashboard` +
    `\n\n${SENDER_LINE}\nManage alerts: ${SITE}/dashboard\nUnsubscribe: ${unsubscribeUrl}\nData deemed reliable but not guaranteed. Powered by PROPTX MLS®.`;

  return { subject, html, text };
}
