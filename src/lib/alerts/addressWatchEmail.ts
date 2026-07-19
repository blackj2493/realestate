/**
 * Email for the ANONYMOUS address-watch audience ("Track this address" on the address
 * profile page — no account). One email per lead per night, one row per watched address
 * that hit the market. Pure renderer (§4 — deterministic, no LLM).
 *
 * Compliance mirrors listingAlertEmail.ts:
 *  - Rows show only ACTIVE (IDX/public) listing facts: ask price, beds/baths, brokerage.
 *  - Every row displays the listing brokerage (TRREB §6.3(c)).
 *  - Carries the one-click unsubscribe (they have no dashboard to manage).
 */

import { shell, footer, esc, money, listingUrl } from "./emailShell";

export interface AddressWatchHit {
  /** The watched address as the lead typed/saw it. */
  address: string;
  city: string | null;
  /** The NEW active listing at that address. */
  listing_key: string;
  price: number | null;
  beds: number | null;
  baths: number | null;
  brokerage: string | null;
  thumb: string | null;
}

const isHttpUrl = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

const brokerageLine = (b: string | null) =>
  `<div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(b || "Brokerage unavailable")}</div>`;

function thumbCell(listingKey: string, thumb: string | null): string {
  const box =
    "display:block;width:84px;height:63px;border-radius:6px;border:0;background:#eef2f6;object-fit:cover;";
  const inner = isHttpUrl(thumb)
    ? `<img src="${thumb}" width="84" height="63" alt="" style="${box}">`
    : `<span style="${box}"></span>`;
  return `<td width="84" valign="top" style="width:84px;padding:12px 12px 12px 0;border-bottom:1px solid #e2e8f0;">
        <a href="${listingUrl(listingKey)}" style="text-decoration:none;">${inner}</a>
      </td>`;
}

function rowHtml(h: AddressWatchHit): string {
  return `
    <tr>
      ${thumbCell(h.listing_key, h.thumb)}
      <td valign="top" style="padding:12px 0;border-bottom:1px solid #e2e8f0;">
        <span style="display:inline-block;background:#0f766e;color:#fff;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 6px;border-radius:3px;vertical-align:middle;margin-right:8px;">NOW FOR SALE</span>
        <a href="${listingUrl(h.listing_key)}" style="color:#0f172a;text-decoration:none;font-weight:600;font-size:15px;vertical-align:middle;">${esc(h.address)}</a>
        <div style="color:#64748b;font-size:12px;margin-top:2px;">${esc(h.city || "")}</div>
        ${brokerageLine(h.brokerage)}
        <div style="margin-top:4px;font-size:13px;color:#0f172a;">
          ${h.price != null ? `<strong>${money(h.price)}</strong>` : ""}
          ${h.beds != null ? ` · ${h.beds} bd` : ""}${h.baths != null ? ` · ${h.baths} ba` : ""}
        </div>
      </td>
    </tr>`;
}

export function renderAddressWatchEmail(input: {
  hits: AddressWatchHit[]; // ≥1
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const { hits, unsubscribeUrl } = input;

  const subject =
    hits.length === 1
      ? `${hits[0].address} just hit the market`
      : `${hits.length} addresses you're tracking just hit the market`;
  const preheader = "An address you asked us to track is now listed for sale.";

  const body = `
      <h1 style="font-size:18px;color:#0f172a;margin:0 0 4px;">An address you're tracking is for sale</h1>
      <p style="color:#64748b;font-size:13px;margin:0;">${esc(subject)}</p>
      <table style="width:100%;border-collapse:collapse;margin-top:14px;">${hits.map(rowHtml).join("")}</table>
      ${footer({
        intro: `You're getting this because you asked PureProperty.ca to watch ${hits.length === 1 ? "this address" : "these addresses"}.`,
        unsubscribeUrl,
      })}`;
  const html = shell({ preheader, headerLabel: "ADDRESS WATCH", body });

  const text =
    hits
      .map(
        (h) =>
          `• NOW FOR SALE: ${h.address}${h.city ? `, ${h.city}` : ""}${h.price != null ? ` — ${money(h.price)}` : ""}${h.brokerage ? ` — ${h.brokerage}` : ""}\n  ${listingUrl(h.listing_key)}`
      )
      .join("\n\n") + `\n\nUnsubscribe: ${unsubscribeUrl}`;

  return { subject, html, text };
}
