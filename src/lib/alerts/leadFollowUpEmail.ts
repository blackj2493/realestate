/**
 * Lead follow-up — the INSTANT auto-acknowledgement to someone who submits a viewing /
 * question / price-opinion request (api/viewing-requests). Tier-0 speed-to-lead: the top
 * of the brokerage funnel, and today's active bug (the lead currently gets nothing back).
 *
 * Mode B "plain note" from the human identity (SENDERS.leadFollowUp = Tanmay). Phase-1
 * framing — delivers data/insight, makes NO representation claim (voice.md §3/§10).
 */
import { Resend } from "resend";
import { SENDERS } from "./senders";
import { plainNote, esc, SITE } from "./emailShell";
import { marketingUnsubscribeUrl } from "./unsubscribe";

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "there";

export interface LeadFollowUpInput {
  name: string;
  address?: string | null;
  listingKey: string;
  email: string;
}

export function renderLeadFollowUpEmail(input: LeadFollowUpInput): {
  subject: string;
  html: string;
  text: string;
} {
  const where = (input.address && input.address.trim()) || "the property you asked about";
  const fn = firstName(input.name);
  const unsub = marketingUnsubscribeUrl(input.email, SITE);
  const subject = `Re: your request on ${where}`;
  const preheader = "The shadow numbers on it are on the way.";

  const body = `
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 14px;">Hi ${esc(fn)},</p>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 14px;">Got your request on <b>${esc(where)}</b> — I'll come back to you personally, fast, with the shadow numbers on this one: True DOM, the full price history, and the Capital Burn Rate the listing never shows. That's the read most buyers never get.</p>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 22px;">Anything specific you want me to dig into first?</p>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0;">— Tanmay, PureProperty</p>
    <p style="color:#94a3b8;font-size:11px;margin-top:30px;line-height:1.6;">You asked us about this property on PureProperty.ca. <a href="${unsub}" style="color:#94a3b8;">Not interested — stop these</a>.</p>`;

  const text = [
    `Hi ${fn},`,
    "",
    `Got your request on ${where} — I'll come back to you personally, fast, with the shadow numbers on this one: True DOM, the full price history, and the Capital Burn Rate the listing never shows. That's the read most buyers never get.`,
    "",
    "Anything specific you want me to dig into first?",
    "",
    "— Tanmay, PureProperty",
    "",
    `Not interested — stop these: ${unsub}`,
  ].join("\n");

  return { subject, html: plainNote({ preheader, body }), text };
}

/** Best-effort send. Never throws to the caller (a failed follow-up must not fail the
 *  lead capture). No-ops without RESEND_API_KEY. */
export async function sendLeadFollowUp(input: LeadFollowUpInput): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;
  const { subject, html, text } = renderLeadFollowUpEmail(input);
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: SENDERS.leadFollowUp.from,
    replyTo: SENDERS.leadFollowUp.replyTo,
    to: input.email,
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${marketingUnsubscribeUrl(input.email, SITE)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
}
