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
  // alert_scope 'filtered': always show WHAT the alert matched, so a quiet or
  // short digest is legible ("why didn't I see X?" → it didn't fit the filters).
  const filterLine = b.filterLabel
    ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">filtered to: ${b.filterLabel}</div>`
    : "";
  const title = `<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:14px;">${b.bubbleName}</div>${filterLine}`;
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
  // A busy area names its full count in words rather than as a bare "+N more", because
  // there the number IS the point: 143 is the reason to go and narrow it down.
  const areaUrl = `${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}`;
  const more = b.total - b.listings.length;
  const overflow =
    more <= 0
      ? ""
      : b.highVolume
        ? `<div style="font-size:12px;color:#475569;margin-top:6px;">
             ${b.total} new homes came up in ${b.bubbleName}. These are the ${b.listings.length} newest —
             <a href="${areaUrl}" style="color:#0891b2;text-decoration:none;font-weight:600;">see them all →</a>
           </div>`
        : `<div style="font-size:12px;margin-top:6px;">
             <a href="${areaUrl}" style="color:#0891b2;text-decoration:none;font-weight:600;">+${more} more in ${b.bubbleName} →</a>
           </div>`;
  return `${title}<table style="width:100%;border-collapse:collapse;">${rows}</table>${overflow}`;
}

/**
 * "Toronto", "Toronto and Barrhaven", "Toronto, Barrhaven and Kanata", then "your areas".
 * Past three names the sentence stops being readable and the names stop being the point.
 */
function nameList(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return "your areas";
}

/**
 * The one line that tells a reader they can narrow this email down.
 *
 * WHO SEES IT. Any area that sent EVERYTHING tonight — tested as `!filterLabel`, which is
 * null in exactly the three cases that mean "no filter was applied": alert_scope 'all',
 * scope 'filtered' over an empty lens (the identical query — see hasActiveLensFilters),
 * and a pre-095 snapshot the worker could not translate. That is why the test is the
 * label and not the stored scope: no new column, and no way for the three to drift apart.
 *
 * ONCE PER EMAIL, not once per area. Three copies of the same advice reads as nagging, and
 * the advice is the same whichever area prompted it.
 *
 * Plain language per voice.md §5.1 — this is the widest, coldest channel we have, and half
 * of these readers have never opened the terminal. No "alert scope", no "bubble", no
 * "lens": say what they get now, and what they get if they act.
 */
function filterNudgeHtml(unfilteredNames: string[]): string {
  if (unfilteredNames.length === 0) return "";
  return `<div style="margin-top:16px;border-left:3px solid #0891b2;background:#f8fafc;padding:10px 12px;">
      <div style="font-size:13px;color:#334155;line-height:1.5;">
        You get every new home in ${nameList(unfilteredNames)}.
        Set your filters and we send only the homes that match — your price, your bedrooms, your kind of home.
      </div>
      <div style="font-size:12px;margin-top:6px;">
        <a href="${SITE}/dashboard" style="color:#0891b2;text-decoration:none;font-weight:600;">Set my filters →</a>
      </div>
    </div>`;
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
  // Areas that carried no filter tonight — they are the ones the nudge is for.
  const unfilteredAreas = p.bubbles.filter((b) => !b.filterLabel).map((b) => b.bubbleName);
  const bubblesSection = p.bubbles.length
    ? sectionHeader("New in your areas") +
      p.bubbles.map(bubbleSectionHtml).join("") +
      filterNudgeHtml(unfilteredAreas)
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
          .map(
            (b) =>
              `• ${b.bubbleName}${b.filterLabel ? ` [${b.filterLabel}]` : ""} (${b.total} new):\n` +
              b.listings
                .map(
                  (l) =>
                    `   - ${l.address}${l.price != null ? ` — ${money(l.price)}` : ""}${l.brokerage ? ` — ${l.brokerage}` : ""}\n     ${listingUrl(l.listing_key)}`
                )
                .join("\n") +
              (b.highVolume
                ? `\n   ${b.total} new homes in ${b.bubbleName} — see them all: ${SITE}/dashboard?bubble=${encodeURIComponent(b.bubbleId)}`
                : "")
          )
          .join("\n")
    );
    if (unfilteredAreas.length) {
      textParts.push(
        `You get every new home in ${nameList(unfilteredAreas)}. Set your filters and we send only the homes that match — your price, your bedrooms, your kind of home.\nSet my filters: ${SITE}/dashboard`
      );
    }
  }
  const text =
    textParts.join("\n\n") +
    `\n\nOpen your dashboard: ${SITE}/dashboard` +
    (unsubscribeUrl ? `\nUnsubscribe: ${unsubscribeUrl}` : "");

  return { subject, html, text };
}
