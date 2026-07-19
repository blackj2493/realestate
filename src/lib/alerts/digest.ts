/**
 * Combined nightly alerts digest — ONE email per user per day with up to three
 * sections (status changes / price drops / new listings in saved areas).
 * Pure renderer: subject + html + text from a DigestPayload (§4 — deterministic).
 *
 * Compliance:
 *  - Sold rows are a TEASE: the closing price never appears in email (VOW data
 *    stays behind the authenticated session). CTA links to the gated listing page.
 *  - Every listing row displays the listing brokerage in the same font size as
 *    the other details (§4 mandatory brokerage display).
 */

import type { StatusAlertKind } from "./transitions";
import type { BubbleSection } from "./bubbleDigest";
import { shell, footer, button, MONO } from "./emailShell";

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
  /** For kind 'relisted' this is the NEW active MLS key — the row links to the live listing. */
  listing_key: string;
  address: string;
  city: string | null;
  kind: StatusAlertKind;
  detail?: string;
  brokerage: string | null;
  /** Listing thumbnail for the email row; null when no photo. The sold PRICE stays gated. */
  thumb?: string | null;
  /** kind 'relisted' only: the new campaign's ask (IDX/public — display-safe). */
  newPrice?: number | null;
}

export interface DigestPayload {
  drops: DropAlert[];
  statusChanges: StatusChangeAlert[];
  bubbles: BubbleSection[];
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;

const isHttpUrl = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

// Left-hand listing thumbnail for any listing row (price drops, new-in-area, and status
// changes incl. sold). The PHOTO is public MLS marketing media (PropTx MediaURL) —
// pre-watermarked with the brokerage per TRREB §6.3(f) — so it can appear in an
// unauthenticated email; only the sold PRICE stays gated behind the "sign in" tease.
// MediaURL is a hotlinkable HTTPS URL, so image-proxying clients (Gmail) load it. alt=""
// + a gray fill means a blocked or missing photo degrades to a clean placeholder box,
// not a broken-image icon — the address sits in the adjacent cell either way.
function thumbCell(listingKey: string, thumb: string | null | undefined): string {
  const box =
    "display:block;width:84px;height:63px;border-radius:6px;border:0;background:#eef2f6;object-fit:cover;";
  const inner = isHttpUrl(thumb)
    ? `<img src="${thumb}" width="84" height="63" alt="" style="${box}">`
    : `<span style="${box}"></span>`;
  return `<td width="84" valign="top" style="width:84px;padding:12px 12px 12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(listingKey)}" style="text-decoration:none;">${inner}</a>
      </td>`;
}

const KIND_LABEL: Record<StatusAlertKind, string> = {
  sold: "SOLD",
  "sold-conditional": "SOLD CONDITIONAL",
  "off-market": "OFF MARKET",
  "back-on-market": "BACK ON MARKET",
  gone: "NO LONGER ACTIVE",
  relisted: "RELISTED",
};

const KIND_COLOR: Record<StatusAlertKind, string> = {
  sold: "#dc2626",
  "sold-conditional": "#d97706",
  "off-market": "#64748b",
  "back-on-market": "#0f766e",
  gone: "#64748b",
  relisted: "#0f766e",
};

function statusLine(s: StatusChangeAlert): string {
  if (s.kind === "sold") return "Sign in to see the closing price";
  if (s.kind === "off-market")
    return `Listing ${s.detail ? s.detail.toLowerCase() : "removed"} — a relist often signals a motivated seller`;
  if (s.kind === "back-on-market") return "Relisted — previous campaign ended without a sale";
  if (s.kind === "sold-conditional") return "Offer accepted with conditions — can still fall through";
  if (s.kind === "relisted")
    return `Back on the market under a new MLS#${s.newPrice != null ? ` — now asking ${money(s.newPrice)}` : ""}`;
  return "Removed from the active feed";
}

// Bounded sections (audit: a 500-listing watchlist must not produce a 500-row email).
// Bubbles already cap at 6 via bubbleDigest; these cap the two watchlist sections.
export const STATUS_EMAIL_ROW_CAP = 20;
export const DROP_EMAIL_ROW_CAP = 20;

const overflowLine = (n: number) =>
  `<div style="font-size:12px;margin-top:6px;">
     <a href="${SITE}/dashboard" style="color:#0891b2;text-decoration:none;font-weight:600;">+${n} more on your dashboard →</a>
   </div>`;

// TRREB §6.3(c): brokerage on EVERY listing row. Always render the line; when the feed
// omitted ListOfficeName, show the same "Brokerage unavailable" placeholder the cards use.
const brokerageLine = (b: string | null) =>
  `<div style="color:#64748b;font-size:12px;margin-top:2px;">${b || "Brokerage unavailable"}</div>`;

function subjectFor(p: DigestPayload): string {
  const parts: string[] = [];
  const sold = p.statusChanges.filter((s) => s.kind === "sold").length;
  const relisted = p.statusChanges.filter((s) => s.kind === "relisted").length;
  const otherStatus = p.statusChanges.length - sold - relisted;
  if (sold) parts.push(`${sold} sold`);
  if (relisted) parts.push(`${relisted} relisted`);
  if (otherStatus) parts.push(`${otherStatus} status change${otherStatus === 1 ? "" : "s"}`);
  if (p.drops.length) parts.push(`${p.drops.length} price drop${p.drops.length === 1 ? "" : "s"}`);
  const newCount = p.bubbles.reduce((n, b) => n + b.total, 0);
  if (newCount) parts.push(`${newCount} new listing${newCount === 1 ? "" : "s"}`);
  return parts.join(" · ") || "Your PureProperty alerts";
}

const sectionHeader = (title: string) =>
  `<h2 style="font-size:13px;color:#334155;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 4px;">${title}</h2>`;

function statusRowsHtml(items: StatusChangeAlert[]): string {
  return items
    .map(
      (s) => `
      <tr>
        ${thumbCell(s.listing_key, s.thumb)}
        <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <span style="display:inline-block;background:${KIND_COLOR[s.kind]};color:#fff;font-size:10px;font-weight:700;
                     letter-spacing:.06em;padding:2px 6px;border-radius:3px;vertical-align:middle;">${KIND_LABEL[s.kind]}</span>
        <a href="${listingUrl(s.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;margin-left:8px;">
          ${s.address || "Saved property"}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${s.city || ""}</div>
        ${brokerageLine(s.brokerage)}
        <div style="margin-top:6px;font-size:13px;color:#475569;">
          ${
            s.kind === "sold"
              ? `<a href="${listingUrl(s.listing_key)}" style="color:#0891b2;font-weight:600;text-decoration:none;">${statusLine(s)} →</a>`
              : statusLine(s)
          }
        </div>
      </td></tr>`
    )
    .join("");
}

function dropRowsHtml(drops: DropAlert[]): string {
  return drops
    .map((d) => {
      const cut = d.oldPrice - d.newPrice;
      return `
      <tr>
        ${thumbCell(d.listing_key, d.thumb)}
        <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(d.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;">
          ${d.address || "Saved property"}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${d.city || ""}</div>
        ${brokerageLine(d.brokerage)}
        <div style="margin-top:6px;font-size:14px;">
          <span style="color:#94a3b8;text-decoration:line-through;">${money(d.oldPrice)}</span>
          &nbsp;→&nbsp;
          <span style="color:#0f766e;font-weight:700;">${money(d.newPrice)}</span>
          <span style="color:#dc2626;font-weight:600;">&nbsp;(−${money(cut)})</span>
        </div>
      </td></tr>`;
    })
    .join("");
}

function bubbleSectionHtml(b: BubbleSection): string {
  const title = `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:14px;">${b.bubbleName}</div>`;
  if (b.collapsed) {
    return `${title}
      <div style="font-size:13px;color:#475569;margin-top:4px;">
        ${b.total} new listings appeared in this area —
        <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#0891b2;text-decoration:none;font-weight:600;">view them in the app</a>.
        Tip: smaller areas make sharper alerts.
      </div>`;
  }
  const rows = b.listings
    .map(
      (l) => `
      <tr>
        ${thumbCell(l.listing_key, l.thumb)}
        <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(l.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:14px;">
          ${l.address}
        </a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${l.city || ""}</div>
        ${brokerageLine(l.brokerage)}
        <div style="margin-top:4px;font-size:13px;color:#0f172a;">
          ${l.price != null ? `<strong>${money(l.price)}</strong>` : ""}
          ${l.beds != null ? ` · ${l.beds} bd` : ""}${l.baths != null ? ` · ${l.baths} ba` : ""}
        </div>
      </td></tr>`
    )
    .join("");
  const overflow =
    b.total > b.listings.length
      ? `<div style="font-size:12px;margin-top:6px;">
           <a href="${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}" style="color:#0891b2;text-decoration:none;font-weight:600;">+${b.total - b.listings.length} more in ${b.bubbleName} →</a>
         </div>`
      : "";
  return `${title}<table style="width:100%;border-collapse:collapse;">${rows}</table>${overflow}`;
}

export function renderAlertsDigest(
  p: DigestPayload,
  unsubscribeUrl?: string
): { subject: string; html: string; text: string } {
  const subject = subjectFor(p);

  const statusShown = p.statusChanges.slice(0, STATUS_EMAIL_ROW_CAP);
  const dropsShown = p.drops.slice(0, DROP_EMAIL_ROW_CAP);
  const statusSection = statusShown.length
    ? sectionHeader("Status changes") +
      `<table style="width:100%;border-collapse:collapse;">${statusRowsHtml(statusShown)}</table>` +
      (p.statusChanges.length > statusShown.length
        ? overflowLine(p.statusChanges.length - statusShown.length)
        : "")
    : "";
  const dropsSection = dropsShown.length
    ? sectionHeader("Price drops") +
      `<table style="width:100%;border-collapse:collapse;">${dropRowsHtml(dropsShown)}</table>` +
      (p.drops.length > dropsShown.length ? overflowLine(p.drops.length - dropsShown.length) : "")
    : "";
  const bubblesSection = p.bubbles.length
    ? sectionHeader("New in your areas") + p.bubbles.map(bubbleSectionHtml).join("")
    : "";

  const preheader = "Every move on your watchlist — with the read behind each one.";
  const body = `
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Your watchlist &amp; market alerts</h1>
      <p style="font-family:${MONO};color:#475569;font-size:13px;margin:0;">${subject}</p>
      ${statusSection}
      ${dropsSection}
      ${bubblesSection}
      <div style="margin-top:20px;">${button("Open your dashboard &rarr;", `${SITE}/dashboard`)}</div>
      ${footer({
        intro: "You're receiving this because you saved these properties or areas on PureProperty.ca.",
        manageUrl: `${SITE}/dashboard`,
        unsubscribeUrl,
      })}`;
  const html = shell({ preheader, headerLabel: "NIGHTLY BRIEF", body });

  const textParts: string[] = [];
  if (statusShown.length) {
    const more = p.statusChanges.length - statusShown.length;
    textParts.push(
      "Status changes:\n" +
        statusShown
          .map((s) => {
            const tail = s.kind === "sold" ? "Sign in to see the closing price" : statusLine(s);
            return `• [${KIND_LABEL[s.kind]}] ${s.address}${s.brokerage ? ` — ${s.brokerage}` : ""}\n  ${tail}: ${listingUrl(s.listing_key)}`;
          })
          .join("\n") +
        (more > 0 ? `\n• +${more} more on your dashboard` : "")
    );
  }
  if (dropsShown.length) {
    const more = p.drops.length - dropsShown.length;
    textParts.push(
      "Price drops:\n" +
        dropsShown
          .map(
            (d) =>
              `• ${d.address}${d.brokerage ? ` — ${d.brokerage}` : ""} — ${money(d.oldPrice)} -> ${money(d.newPrice)} (-${money(d.oldPrice - d.newPrice)})\n  ${listingUrl(d.listing_key)}`
          )
          .join("\n") +
        (more > 0 ? `\n• +${more} more on your dashboard` : "")
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
    (unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : "");

  return { subject, html, text };
}
