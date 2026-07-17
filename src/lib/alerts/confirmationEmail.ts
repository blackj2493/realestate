/**
 * Sign-up confirmation — first touch after the anonymous listing-alert capture form
 * (api/listing-alerts). Upgraded from plain text to the branded Mode A shell. Machine
 * sender (SENDERS.confirmation = alerts@, reply-to support@); ends on the machine footer,
 * not a brand signature (voice.md §3).
 */
import { shell, footer, button, esc, SITE, MONO } from "./emailShell";
import { unsubscribeUrl } from "./unsubscribe";

export interface ConfirmationInput {
  email: string;
  address?: string | null;
  city?: string | null;
  listingKey: string;
  kindLabel: string; // e.g. "Price & status alerts"
  watchingFor: string; // e.g. "price · status"
}

export function renderConfirmationEmail(input: ConfirmationInput): {
  subject: string;
  html: string;
  text: string;
} {
  const where = (input.address && input.address.trim()) || (input.city ? `homes in ${input.city}` : "this home");
  const subject = `Tracking ${input.address || input.city || input.listingKey} — ${input.kindLabel.toLowerCase()} on`;
  const preheader = "You'll only hear from us when it changes.";
  const unsub = unsubscribeUrl(input.email, SITE);
  const cityChip = input.city && input.address ? ` <span style="color:#475569;font-weight:400;font-size:12px;">&middot; ${esc(input.city)}</span>` : "";

  const body = `
    <h1 style="font-size:18px;color:#0f172a;margin:0 0 12px;">You're set.</h1>
    <p style="font-size:15px;line-height:1.65;color:#334155;margin:0 0 16px;">We're now tracking <b style="color:#0f172a;">${esc(where)}</b> for ${esc(input.kindLabel.toLowerCase())}. The day something actually changes, you'll hear it from us — same day, with the history behind the number, not just the headline. That's the only reason we'll email you.</p>
    <table role="presentation" width="100%" style="border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;"><tr><td style="padding:14px 16px;">
      <div style="color:#64748b;font-size:9px;letter-spacing:.10em;text-transform:uppercase;">Now watching</div>
      <div style="color:#0f172a;font-weight:700;font-size:15px;margin-top:4px;">${esc(where)}${cityChip}</div>
      <div style="font-family:${MONO};color:#475569;font-size:13px;margin-top:6px;">Watching for: ${esc(input.watchingFor)}</div>
    </td></tr></table>
    <div style="margin-top:18px;">${button("See what else the terminal shows &rarr;", `${SITE}/terminal`)}</div>
    ${footer({
      intro: "Machine-sent by PureProperty Alerts because you asked to watch this on PureProperty.ca.",
      unsubscribeUrl: unsub,
      mls: false,
    })}`;

  const text = [
    "You're set.",
    "",
    `We're now tracking ${where} for ${input.kindLabel.toLowerCase()}. The day something actually changes, you'll hear it from us — same day, with the history behind the number. That's the only reason we'll email you.`,
    "",
    `See what else the terminal shows: ${SITE}/terminal`,
    "",
    `Unsubscribe anytime: ${unsub}`,
  ].join("\n");

  return { subject, html: shell({ preheader, headerLabel: "ALERT ARMED", body }), text };
}
