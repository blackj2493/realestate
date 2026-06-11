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

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://pureproperty.ca").replace(/\/$/, "");

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;

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

const brokerageLine = (b: string | null) =>
  b ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">${b}</div>` : "";

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

const sectionHeader = (title: string) =>
  `<h2 style="font-size:13px;color:#334155;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 4px;">${title}</h2>`;

function statusRowsHtml(items: StatusChangeAlert[]): string {
  return items
    .map(
      (s) => `
      <tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
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
      <tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
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
      <tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;">
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

export function renderAlertsDigest(p: DigestPayload): { subject: string; html: string; text: string } {
  const subject = subjectFor(p);

  const statusSection = p.statusChanges.length
    ? sectionHeader("Status changes") +
      `<table style="width:100%;border-collapse:collapse;">${statusRowsHtml(p.statusChanges)}</table>`
    : "";
  const dropsSection = p.drops.length
    ? sectionHeader("Price drops") +
      `<table style="width:100%;border-collapse:collapse;">${dropRowsHtml(p.drops)}</table>`
    : "";
  const bubblesSection = p.bubbles.length
    ? sectionHeader("New in your areas") + p.bubbles.map(bubbleSectionHtml).join("")
    : "";

  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Your watchlist &amp; market alerts</h1>
      <p style="color:#64748b;font-size:13px;margin:0;">${subject}</p>
      ${statusSection}
      ${dropsSection}
      ${bubblesSection}
      <a href="${SITE}/dashboard"
         style="display:inline-block;margin-top:20px;background:#0891b2;color:#fff;text-decoration:none;
                padding:10px 16px;border-radius:6px;font-size:13px;font-weight:600;">
        Open your dashboard
      </a>
      <p style="color:#94a3b8;font-size:11px;margin-top:24px;line-height:1.5;">
        You're receiving this because you saved these properties or areas on PureProperty.ca.
        <a href="${SITE}/dashboard" style="color:#94a3b8;">Manage alerts</a>.
        Data is deemed reliable but is not guaranteed accurate. Powered by PROPTX MLS®.
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
  const text = textParts.join("\n\n") + `\n\nOpen your dashboard: ${SITE}/dashboard`;

  return { subject, html, text };
}
