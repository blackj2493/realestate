/**
 * Shared email shell for all user-facing PureProperty emails (voice.md §11.9).
 *
 * Email-safe by construction: a table-based centered wrapper (Gmail's mobile app ignores
 * max-width on div wrappers), inline styles only, no flexbox / absolute positioning.
 * Every email composes one of:
 *   - shell({ preheader, headerLabel, body })  — Mode A "terminal readout" (navy header)
 *   - plainNote({ preheader, body })           — Mode B "plain note" (lead follow-up)
 *
 * Compliance helpers (footer with the CASL mailing address + "deemed reliable" notice)
 * live here so every email inherits them.
 */

export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const MAIL_ADDRESS = "268 America Ave, Vaughan, ON L6A 3G7";
// NOTE: 'SF Mono' uses SINGLE quotes — this string is interpolated into double-quoted
// style="…" attributes, so an embedded double-quote would truncate the attribute.
export const MONO = "ui-monospace,SFMono-Regular,'SF Mono',Menlo,Consolas,monospace";

export const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
export const listingUrl = (key: string) => `${SITE}/properties/${encodeURIComponent(key)}`;
export const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"));

export const button = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">${label}</a>`;

export const sectionHeader = (title: string) =>
  `<h2 style="font-size:12px;color:#334155;text-transform:uppercase;letter-spacing:.10em;margin:24px 0 10px;">${title}</h2>`;

export const link = (label: string, href: string, color = "#0e7490") =>
  `<a href="${href}" style="color:${color};text-decoration:none;font-weight:600;">${label}</a>`;

/** Standard footer. Renders whichever manage/unsubscribe links are provided, then the
 *  "deemed reliable" MLS notice (unless mls:false) and the CASL mailing address. */
export function footer(opts: {
  intro: string;
  manageUrl?: string;
  unsubscribeUrl?: string;
  mls?: boolean;
}): string {
  const links: string[] = [];
  if (opts.manageUrl) links.push(`<a href="${opts.manageUrl}" style="color:#64748b;">Manage alerts</a>`);
  if (opts.unsubscribeUrl) links.push(`<a href="${opts.unsubscribeUrl}" style="color:#64748b;">Unsubscribe</a>`);
  const linkLine = links.length ? " " + links.join(" &middot; ") + "." : "";
  const mls = opts.mls === false ? "" : "Data is deemed reliable but not guaranteed accurate. Powered by PROPTX MLS&reg;.<br>";
  return `<p style="color:#64748b;font-size:11px;margin-top:26px;line-height:1.6;border-top:1px solid #f1f5f9;padding-top:16px;">
      ${opts.intro}${linkLine}<br>
      ${mls}PureProperty &middot; ${MAIL_ADDRESS}
    </p>`;
}

const HEAD = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"></head>`;
const preheaderDiv = (t: string) => `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${t}</div>`;
const LOGO_DARK_BG = `<span style="font-size:17px;font-weight:700;color:#ffffff;"><span style="font-weight:400;margin-right:8px;">&#10094;</span>PURE<span style="font-weight:400;color:#8fa4b8;">PROPERTY</span><span style="font-weight:400;color:#6b7e92;">.ca</span></span>`;
const LOGO_LIGHT = `<div style="font-size:13px;font-weight:700;color:#0a1828;margin:0 0 20px;"><span style="font-weight:400;margin-right:6px;">&#10094;</span>PURE<span style="font-weight:400;color:#4a6378;">PROPERTY</span><span style="font-weight:400;color:#6b7e92;">.ca</span></div>`;

/** Mode A — the branded "terminal readout" document (navy header + accent rule). */
export function shell(opts: { preheader: string; headerLabel: string; body: string }): string {
  return `${HEAD}
<body style="margin:0;padding:0;background:#eef2f6;">
  ${preheaderDiv(opts.preheader)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#eef2f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center" style="padding:16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:0;">
          <table role="presentation" width="100%" style="border-collapse:collapse;background:#0a1828;">
            <tr>
              <td style="padding:14px 24px;">${LOGO_DARK_BG}</td>
              <td align="right" style="padding:14px 24px;"><span style="font-family:${MONO};color:#67e8f9;font-size:10px;letter-spacing:.14em;">${opts.headerLabel}</span></td>
            </tr>
            <tr><td colspan="2" style="height:2px;background:#0891b2;line-height:2px;">&nbsp;</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 24px 28px;">
          ${opts.body}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** Mode B — the near-plaintext "plain note" (Tanmay's lead follow-up). No header bar,
 *  small light logo; deliberately un-designed so it reads as a real person, not a bot. */
export function plainNote(opts: { preheader: string; body: string }): string {
  return `${HEAD}
<body style="margin:0;padding:0;background:#ffffff;">
  ${preheaderDiv(opts.preheader)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center" style="padding:8px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;">
        <tr><td style="padding:30px 28px 24px;">
          ${LOGO_LIGHT}
          ${opts.body}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
