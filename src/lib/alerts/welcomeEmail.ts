/**
 * Welcome / activation email — sent once, on a new consumer's FIRST VOW-Terms
 * acceptance (wired in src/app/api/vow/accept-terms/route.ts). A feature-showcase
 * "gate" whose design of record is docs/brand/email-welcome.html.
 *
 * Sender: SENDERS.welcome (machine "PureProperty <hello@>", reply-to support@) — §11.8,
 * deliberately NOT the Tanmay persona.
 *
 * Email-safe by construction: table layout, inline styles, no SVG / flexbox / absolute
 * positioning (Outlook renders with Word's engine). The one visual that must be raster —
 * the True DOM price-path — loads as a hosted PNG with a descriptive text fallback in alt.
 *
 * Compliance: no sold/closing prices appear; "deemed reliable" notice + CASL mailing
 * address in the footer; one-click unsubscribe. Copy is deterministic (no LLM).
 */
import { Resend } from "resend";
import { SENDERS } from "./senders";
import { marketingUnsubscribeUrl } from "./unsubscribe";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const MAIL_ADDRESS = "268 America Ave, Vaughan, ON L6A 3G7";
/** Hosted PNG of the live CampaignHistoryChart price-path. Generated as an email asset
 *  (see the screenshots step) — until it exists, the alt text carries the message. */
const TRUE_DOM_CHART = `${SITE}/email-assets/welcome/true-dom.png`;

const SUBJECT = "You're in — the tools most buyers never get";
const PREHEADER =
  "What it's really worth, what you could make it worth, and how long it's really been for sale.";

// Small style tokens kept inline-able as plain strings (no <style> — Gmail strips head styles).
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const eyebrow = (t: string) =>
  `<div style="font-family:${MONO};font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#0e7490;">${t}</div>`;
const ftitle = (t: string) => `<div style="font-size:16px;font-weight:700;color:#0f172a;margin:5px 0 6px;">${t}</div>`;
const fbody = (t: string) => `<p style="font-size:13.5px;line-height:1.55;color:#475569;margin:0 0 10px;">${t}</p>`;
const link = (label: string, href: string) =>
  `<a href="${href}" style="color:#0e7490;text-decoration:none;font-weight:600;font-size:13px;">${label} &rarr;</a>`;

/** A "first layer" finding tile (concrete per-listing fact, valence-coloured). */
function finding(label: string, value: string, accentBar: string): string {
  return `<td width="50%" valign="top" style="padding:0 8px 14px 0;border-left:2px solid ${accentBar};padding-left:11px;">
    <div style="font-family:${MONO};font-size:9px;letter-spacing:.1em;color:#67e8f9;text-transform:uppercase;">${label}</div>
    <div style="font-size:13px;color:#ffffff;font-weight:600;margin-top:4px;line-height:1.4;">${value}</div>
  </td>`;
}

export function renderWelcomeEmail(recipientEmail?: string): { subject: string; html: string; text: string } {
  // Personalised one-click unsubscribe (CASL). Falls back to the dashboard for previews
  // without a recipient; a real send always passes the address.
  const unsubUrl = recipientEmail ? marketingUnsubscribeUrl(recipientEmail, SITE) : `${SITE}/dashboard`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head>
<body style="margin:0;padding:0;background:#eef2f6;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${PREHEADER}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#eef2f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center" style="padding:16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:0;">

          <!-- header -->
          <table role="presentation" width="100%" style="border-collapse:collapse;background:#0a1828;">
        <tr>
          <td style="padding:14px 24px;"><span style="font-size:17px;font-weight:700;color:#ffffff;"><span style="font-weight:400;margin-right:8px;">&#10094;</span>PURE<span style="font-weight:400;color:#8fa4b8;">PROPERTY</span><span style="font-weight:400;color:#6b7e92;">.ca</span></span></td>
          <td align="right" style="padding:14px 24px;"><span style="font-family:${MONO};color:#67e8f9;font-size:10px;letter-spacing:.14em;">ACCESS &middot; GRANTED</span></td>
        </tr>
        <tr><td colspan="2" style="height:2px;background:#0891b2;line-height:2px;">&nbsp;</td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 24px 28px;">
        <h1 style="font-size:20px;color:#0f172a;margin:0 0 10px;">You're in.</h1>
        <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 22px;">Every home on PureProperty now carries the read most buyers never get — what it's really worth, what you could make it worth, and how long it's really been for sale. Here's where to start.</p>

        <!-- heatmap hero (hosted PNG of the AlphaMap hex heatmap) -->
        ${eyebrow("The map &middot; the terminal view")}
        <img src="${SITE}/email-assets/welcome/map.png" width="524" alt="Neighbourhood heat map — yield and days-on-market by block, with two hot clusters" style="display:block;width:100%;max-width:524px;height:auto;border:0;border-radius:8px;margin:8px 0 6px;">
        ${fbody(`Your market, x-rayed block by block — yield, days-on-market and price compression. ${link("Open the map", `${SITE}/terminal`)}`)}

        <!-- 1 · Estimated Sale Price -->
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:26px;border-top:1px solid #eef2f6;"><tr><td style="padding-top:20px;">
          ${eyebrow("Estimated sale price")}
          ${ftitle("The asking price is an opinion. See the number.")}
          ${fbody("We estimate what a home should actually sell for — from real, recent comparable sales — and line it up against the ask. The gap is your negotiation.")}
          <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;background:#fbfdff;"><tr><td style="padding:16px 18px;">
            <div style="font-size:11px;color:#64748b;">128 Maplecrest Ave, Vaughan &middot; asking <span style="font-family:${MONO};">$2,282,000</span></div>
            <div style="font-family:${MONO};font-size:30px;font-weight:800;color:#0f172a;margin:4px 0 2px;">$2,231,796</div>
            <div style="font-family:${MONO};font-size:12px;color:#64748b;">Likely range $2,142,524 &ndash; $2,321,068</div>
            <div style="margin:9px 0;"><span style="background:#f59e0b;color:#fff;font-size:9px;font-weight:700;letter-spacing:.06em;border-radius:4px;padding:3px 7px;">MEDIUM CONFIDENCE</span> <span style="font-family:${MONO};font-size:11px;color:#94a3b8;">Based on 214 sales</span></div>
            <div style="font-family:${MONO};font-size:12px;color:#047857;font-weight:600;">&#8776; $50,204 (&#8722;2.2%) below ask &middot; room to negotiate</div>
            <table role="presentation" width="100%" style="border-collapse:collapse;border-radius:4px;overflow:hidden;margin:14px 0 4px;"><tr><td style="width:78%;background:#94a3b8;height:8px;">&nbsp;</td><td style="width:22%;background:#e2e8f0;height:8px;">&nbsp;</td></tr></table>
            <div style="font-family:${MONO};font-size:9px;color:#94a3b8;">&#9670; estimate sits below the comparable-sale band and the ask</div>
          </td></tr></table>
          <div style="margin-top:10px;">${link("See any home's real value", `${SITE}/terminal`)}</div>
        </td></tr></table>

        <!-- 2 · Renovation Upside -->
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #eef2f6;"><tr><td style="padding-top:20px;">
          ${eyebrow("Renovation upside")}
          ${ftitle("The money hiding in the floor plan.")}
          ${fbody("For every home we price the value-add moves that actually pay back — ranked by return, net of cost. The specific play with the best payback on this house, in this neighbourhood.")}
          <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;background:#fbfdff;"><tr><td style="padding:16px 18px;">
            <div style="font-size:11px;color:#64748b;">128 Maplecrest Ave &middot; Vellore Village</div>
            <div style="margin:6px 0 12px;"><span style="font-family:${MONO};font-size:22px;font-weight:800;color:#047857;">$118,898</span><span style="font-size:12px;color:#64748b;"> unlockable &middot; </span><span style="font-family:${MONO};font-size:15px;font-weight:700;color:#047857;">~$74,898</span><span style="font-size:12px;color:#64748b;"> net after cost</span></div>
            <table role="presentation" width="100%" style="border-collapse:collapse;font-size:12px;">
              <tr><td style="color:#94a3b8;font-size:9px;text-transform:uppercase;letter-spacing:.06em;padding-bottom:4px;">Move</td><td align="right" style="color:#94a3b8;font-size:9px;text-transform:uppercase;padding-bottom:4px;">Adds</td><td align="right" style="color:#94a3b8;font-size:9px;text-transform:uppercase;padding-bottom:4px;">Cost</td><td align="right" style="color:#94a3b8;font-size:9px;text-transform:uppercase;padding-bottom:4px;">Return</td></tr>
              <tr><td style="color:#0f172a;border-top:1px solid #eef2f6;padding:5px 0;">Add a parking space</td><td align="right" style="font-family:${MONO};color:#047857;border-top:1px solid #eef2f6;">+$21,850</td><td align="right" style="font-family:${MONO};color:#94a3b8;border-top:1px solid #eef2f6;">&#8722;$5,500</td><td align="right" style="font-family:${MONO};font-weight:700;border-top:1px solid #eef2f6;">3.99&times;</td></tr>
              <tr><td style="color:#0f172a;border-top:1px solid #eef2f6;padding:5px 0;">Add a full bathroom</td><td align="right" style="font-family:${MONO};color:#047857;border-top:1px solid #eef2f6;">+$54,800</td><td align="right" style="font-family:${MONO};color:#94a3b8;border-top:1px solid #eef2f6;">&#8722;$18,250</td><td align="right" style="font-family:${MONO};font-weight:700;border-top:1px solid #eef2f6;">3.0&times;</td></tr>
              <tr><td style="color:#0f172a;border-top:1px solid #eef2f6;padding:5px 0;">Add a bedroom</td><td align="right" style="font-family:${MONO};color:#047857;border-top:1px solid #eef2f6;">+$31,950</td><td align="right" style="font-family:${MONO};color:#94a3b8;border-top:1px solid #eef2f6;">&#8722;$16,450</td><td align="right" style="font-family:${MONO};font-weight:700;border-top:1px solid #eef2f6;">1.94&times;</td></tr>
            </table>
            <div style="font-size:11px;color:#475569;margin-top:10px;line-height:1.5;border-top:1px solid #eef2f6;padding-top:9px;">Best payback in Vellore Village: <b>add a full bathroom</b> — +$40,000 net (3.0&times;). Based on 301 comparable sales.</div>
          </td></tr></table>
          <div style="margin-top:10px;">${link("See the upside on any home", `${SITE}/terminal`)}</div>
        </td></tr></table>

        <!-- 3 · True DOM (hosted chart image) -->
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #eef2f6;"><tr><td style="padding-top:20px;">
          ${eyebrow("True DOM &middot; the relist trick")}
          ${ftitle('"New listing." Actually a year of price cuts.')}
          ${fbody("Sellers reset the days-on-market clock by re-listing. We stitch every campaign back together, so the real path shows — and how motivated the seller really is.")}
          <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;background:#fbfdff;"><tr><td style="padding:14px 18px;">
            <div style="font-family:${MONO};font-size:12px;color:#334155;margin-bottom:8px;">Listed <b style="color:#047857;">6&times;</b> &middot; True DOM <b style="color:#0e7490;">41d</b> &middot; $2.64M &rarr; $2.28M <b style="color:#047857;">(&#8722;14%)</b></div>
            <img src="${TRUE_DOM_CHART}" width="524" alt="Price-path: listed at $2.64M, expired and relisted 4 times through the year, now active at $2.28M — a 14% decline the public days-on-market hides." style="display:block;width:100%;max-width:524px;height:auto;border:0;">
          </td></tr></table>
          <div style="margin-top:10px;">${link("See the real timeline", `${SITE}/terminal`)}</div>
        </td></tr></table>

        <!-- 4 · Compare -->
        <table role="presentation" width="100%" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #eef2f6;"><tr><td style="padding-top:20px;">
          ${eyebrow("Side by side")}
          ${ftitle("Two homes enter. The numbers decide.")}
          ${fbody("Line up any two listings on the figures that actually settle it. The better buy is usually not the prettier photo.")}
          <table role="presentation" width="100%" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;font-size:12px;">
            <tr style="background:#0a1828;color:#cbd5e1;"><td style="padding:7px 10px;">Metric</td><td style="padding:7px 10px;">128 Maplecrest<br><span style="font-family:${MONO};color:#34d399;">$2,282,000</span></td><td style="padding:7px 10px;">363 Maria Antonia<br><span style="font-family:${MONO};color:#34d399;">$1,905,000</span></td></tr>
            <tr><td style="padding:7px 10px;color:#64748b;text-transform:uppercase;font-size:10px;border-top:1px solid #eef2f6;">Est. sale price</td><td style="padding:7px 10px;font-family:${MONO};border-top:1px solid #eef2f6;">$2,231,796</td><td style="padding:7px 10px;font-family:${MONO};border-top:1px solid #eef2f6;">$1,942,500</td></tr>
            <tr><td style="padding:7px 10px;color:#64748b;text-transform:uppercase;font-size:10px;border-top:1px solid #eef2f6;">vs comp value</td><td style="padding:7px 10px;font-family:${MONO};color:#b45309;border-top:1px solid #eef2f6;">6% over</td><td style="padding:7px 10px;font-family:${MONO};color:#047857;font-weight:700;border-top:1px solid #eef2f6;">9% under</td></tr>
            <tr><td style="padding:7px 10px;color:#64748b;text-transform:uppercase;font-size:10px;border-top:1px solid #eef2f6;">True DOM</td><td style="padding:7px 10px;font-family:${MONO};border-top:1px solid #eef2f6;">41 days</td><td style="padding:7px 10px;font-family:${MONO};color:#047857;font-weight:700;border-top:1px solid #eef2f6;">12 days</td></tr>
            <tr><td style="padding:7px 10px;color:#64748b;text-transform:uppercase;font-size:10px;border-top:1px solid #eef2f6;">Monthly cashflow</td><td style="padding:7px 10px;font-family:${MONO};color:#be123c;border-top:1px solid #eef2f6;">&#8722;$1,240</td><td style="padding:7px 10px;font-family:${MONO};color:#047857;font-weight:700;border-top:1px solid #eef2f6;">&#8722;$610</td></tr>
          </table>
          <div style="margin-top:10px;">${link("Compare two homes", `${SITE}/properties/compare`)}</div>
        </td></tr></table>

        <!-- the gate -->
        <table role="presentation" width="100%" style="border-collapse:collapse;background:#0a1828;border-radius:10px;margin-top:28px;"><tr><td style="padding:20px 20px 18px;">
          <div style="color:#ffffff;font-size:15px;font-weight:700;">And that's just the first layer.</div>
          <div style="color:#8fa4b8;font-size:13px;line-height:1.5;margin:5px 0 15px;">Four more things 128 Maplecrest is quietly telling us:</div>
          <table role="presentation" width="100%" style="border-collapse:collapse;">
            <tr>${finding("Nearby development", '48 townhomes approved <span style="color:#fbbf24;">&middot; 220m away</span>', "#d97706")}${finding("Suite Potential", 'legal basement suite <span style="color:#34d399;">&middot; likely</span>', "#059669")}</tr>
            <tr>${finding("School boundaries", "zoned &middot; Vellore Village PS", "#334155")}${finding("Underwriting sandbox", 'rented out: <span style="color:#fb7185;">&#8722;$1,240/mo</span>', "#be123c")}</tr>
          </table>
          <div style="color:#64748b;font-size:11px;border-top:1px solid #1e3a52;padding-top:12px;margin-top:6px;">+ walkability, heritage flags, rental yield &amp; assignment detection — on every listing.</div>
        </td></tr></table>

        <!-- CTA -->
        <p style="font-size:15px;line-height:1.6;color:#334155;margin:24px 0 14px;">Start with a street you already know — your own, or the one you keep driving past. Pull it up and see it the way the terminal does.</p>
        <a href="${SITE}/terminal" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:13px 22px;border-radius:6px;font-size:14px;font-weight:600;">Open your terminal &rarr;</a>
        <p style="font-size:14px;line-height:1.6;color:#475569;margin:24px 0 0;">— The PureProperty terminal</p>

        <!-- footer -->
        <p style="color:#64748b;font-size:11px;margin-top:26px;line-height:1.6;border-top:1px solid #f1f5f9;padding-top:16px;">
          You created a PureProperty.ca account. <a href="${SITE}/dashboard" style="color:#64748b;">Manage alerts</a> &middot; <a href="${unsubUrl}" style="color:#64748b;">Unsubscribe</a>.<br>
          Data is deemed reliable but not guaranteed accurate. Powered by PROPTX MLS&reg;.<br>
          PureProperty &middot; ${MAIL_ADDRESS}
        </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    "You're in.",
    "",
    "Every home on PureProperty now carries the read most buyers never get:",
    "",
    "- Estimated sale price — what a home should actually sell for vs the ask (e.g. est. $2,231,796 on a $2,282,000 ask; room to negotiate).",
    "- Renovation upside — the value-add moves that pay back, ranked by return (e.g. up to $118,898 unlockable, ~$74,898 net).",
    "- True DOM — the real days-on-market, stitched across every relist (a 'new' listing can be a year of quiet price cuts).",
    "- Compare — any two homes on the figures that decide it.",
    "",
    "And that's just the first layer: nearby development, suite potential, school boundaries, an underwriting sandbox, walkability, heritage flags, rental yield and assignment detection — on every listing.",
    "",
    `Start with a street you already know: ${SITE}/terminal`,
    "",
    "— The PureProperty terminal",
    "",
    `Manage alerts: ${SITE}/dashboard | Unsubscribe: ${unsubUrl}`,
    "Data is deemed reliable but not guaranteed accurate. Powered by PROPTX MLS.",
    `PureProperty · ${MAIL_ADDRESS}`,
  ].join("\n");

  return { subject: SUBJECT, html, text };
}

/**
 * Fire-and-forget welcome send. Best-effort: never throws to the caller (a failed
 * welcome must not break Terms acceptance). No-ops without RESEND_API_KEY.
 */
export async function sendWelcomeEmail(to: string): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { subject, html, text } = renderWelcomeEmail(to);
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: SENDERS.welcome.from,
    replyTo: SENDERS.welcome.replyTo,
    to,
    subject,
    html,
    text,
    headers: {
      // RFC 8058 one-click unsubscribe (required by Gmail/Yahoo bulk rules).
      "List-Unsubscribe": `<${marketingUnsubscribeUrl(to, SITE)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
