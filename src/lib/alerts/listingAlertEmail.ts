/**
 * Email for the ANONYMOUS listing-alert audience (single-field capture on the listing
 * page — no account). Distinct from digest.ts (the signed-in watchlist digest): this is
 * framed per-listing ("homes you're watching"), carries a one-click UNSUBSCRIBE link
 * (they have no dashboard to manage), and never links to /dashboard.
 *
 * Pure renderer: subject + html + text from the change set (§4 — deterministic, no LLM).
 * Compliance mirrors digest.ts:
 *  - Sold rows are a TEASE: the closing price NEVER appears in email; the row links to the
 *    gated listing page instead.
 *  - Every row shows the listing brokerage in the same size as the other details (§4).
 */

import type { StatusAlertKind } from "./transitions";
import { shell, footer } from "./emailShell";

export interface ListingAlertChange {
  listing_key: string;
  address: string;
  city: string | null;
  brokerage: string | null;
  /** Price drop (active listing) — old→new. */
  drop?: { oldPrice: number; newPrice: number };
  /** Status change (sold / off-market / back-on-market / …). */
  status?: { kind: StatusAlertKind; detail?: string };
}

export interface ListingAlertEmailInput {
  changes: ListingAlertChange[]; // ≥1
  unsubscribeUrl: string;
}

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));

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

function statusLine(s: NonNullable<ListingAlertChange["status"]>): string {
  // ANON audience: show only the neutral status KIND (SOLD / OFF MARKET), never the
  // specific VOW de-list reason (Terminated / Expired / Suspended) nor any close price.
  // The specific reason is VOW Listing Information and is gated to signed-in consumers —
  // mirroring the dashboard dispositions gate. Note we deliberately DON'T interpolate
  // s.detail here (that was the leak: "Listing terminated …" reaching non-consumers).
  switch (s.kind) {
    case "sold":
      return "Sign in to see the closing price";
    case "off-market":
      return "No longer on the active market — a relist often signals a motivated seller";
    case "back-on-market":
      return "Back on the market — sign in to see the full listing history";
    case "sold-conditional":
      return "Offer accepted with conditions — it can still fall through";
    default:
      return "No longer on the active market";
  }
}

/** One short human line describing a single change (used for subjects + text). */
function summarize(c: ListingAlertChange): string {
  if (c.drop) return `${money(c.drop.oldPrice - c.drop.newPrice)} price drop`;
  if (c.status) return KIND_LABEL[c.status.kind];
  return "Update";
}

function subjectFor(changes: ListingAlertChange[]): string {
  if (changes.length === 1) {
    const c = changes[0];
    const where = c.address || c.city || "a home you're watching";
    return `${summarize(c)} — ${where}`;
  }
  const drops = changes.filter((c) => c.drop).length;
  const status = changes.length - drops;
  const parts: string[] = [];
  if (drops) parts.push(`${drops} price drop${drops === 1 ? "" : "s"}`);
  if (status) parts.push(`${status} status change${status === 1 ? "" : "s"}`);
  return parts.join(" · ") || `${changes.length} updates on homes you're watching`;
}

// TRREB §6.3(c): brokerage on EVERY listing row. Always render; when the feed omitted
// ListOfficeName, show the same "Brokerage unavailable" placeholder the cards use.
const brokerageLine = (b: string | null) =>
  `<div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(b || "Brokerage unavailable")}</div>`;

function rowHtml(c: ListingAlertChange): string {
  const badge = c.status
    ? `<span style="display:inline-block;background:${KIND_COLOR[c.status.kind]};color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:3px;vertical-align:middle;margin-right:8px;">${KIND_LABEL[c.status.kind]}</span>`
    : "";
  const detail = c.drop
    ? `<div style="margin-top:6px;font-size:14px;">
         <span style="color:#94a3b8;text-decoration:line-through;">${money(c.drop.oldPrice)}</span>
         &nbsp;→&nbsp;
         <span style="color:#0f766e;font-weight:700;">${money(c.drop.newPrice)}</span>
         <span style="color:#dc2626;font-weight:600;">&nbsp;(−${money(c.drop.oldPrice - c.drop.newPrice)})</span>
       </div>`
    : c.status
      ? `<div style="margin-top:6px;font-size:13px;color:#475569;">${
          c.status.kind === "sold"
            ? `<a href="${listingUrl(c.listing_key)}" style="color:#0891b2;font-weight:600;text-decoration:none;">${statusLine(c.status)} →</a>`
            : statusLine(c.status)
        }</div>`
      : "";
  return `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
      ${badge}<a href="${listingUrl(c.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;vertical-align:middle;">${esc(c.address || "A home you're watching")}</a>
      <div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(c.city || "")}</div>
      ${brokerageLine(c.brokerage)}
      ${detail}
    </td></tr>`;
}

export function renderListingAlertEmail(
  input: ListingAlertEmailInput
): { subject: string; html: string; text: string } {
  const { changes, unsubscribeUrl } = input;
  const subject = subjectFor(changes);

  const preheader = changes.length === 1 ? `${summarize(changes[0])} — sign in for the full history` : subject;
  const body = `
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">Updates on homes you're watching</h1>
      <p style="color:#64748b;font-size:13px;margin:0;">${esc(subject)}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:14px;">${changes.map(rowHtml).join("")}</table>
      ${footer({
        intro: `You're getting this because you asked PureProperty.ca to alert you about ${changes.length === 1 ? "this home" : "these homes"}.`,
        unsubscribeUrl,
      })}`;
  const html = shell({ preheader, headerLabel: "LISTING ALERT", body });

  const text =
    changes
      .map((c) => {
        const head = c.status ? `[${KIND_LABEL[c.status.kind]}] ` : "";
        const body = c.drop
          ? `${money(c.drop.oldPrice)} -> ${money(c.drop.newPrice)} (-${money(c.drop.oldPrice - c.drop.newPrice)})`
          : c.status
            ? statusLine(c.status)
            : "Update";
        return `• ${head}${c.address || "A home you're watching"}${c.brokerage ? ` — ${c.brokerage}` : ""}\n  ${body}\n  ${listingUrl(c.listing_key)}`;
      })
      .join("\n\n") + `\n\nUnsubscribe: ${unsubscribeUrl}`;

  return { subject, html, text };
}
