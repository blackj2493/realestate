/**
 * Lead follow-up — the INSTANT auto-acknowledgement to someone who submits a viewing /
 * question / price-opinion request (api/viewing-requests). Tier-0 speed-to-lead: the top
 * of the brokerage funnel.
 *
 * Mode B "plain note" from the human identity (SENDERS.leadFollowUp = Tanmay). Phase-1
 * framing — delivers data/insight, makes NO representation claim (voice.md §3/§10).
 *
 * FOUR LANES. The first version promised one fixed set of figures: days on market "for
 * sale", price history, and monthly carrying cost. Those are the right figures for a
 * residential BUYER and wrong for everyone else — a tenant does not carry the property,
 * and a commercial lease is quoted per square foot per year with TMI on top, so a
 * "monthly cost" is not even the same unit. The lane comes from the listing itself (see
 * classifyLeadLane) and decides which figures we promise.
 *
 * PLAIN LANGUAGE (voice.md §5.1). Emails explain every term on first use; the insider
 * lexicon stays in-app. That is why "TMI" is spelled out inline here, and why the old
 * "shadow numbers" coinage is gone — a first-contact email to a stranger is the worst
 * place for a term only we use.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SENDERS } from "./senders";
import { plainNote, esc, SITE } from "./emailShell";
import { marketingUnsubscribeUrl } from "./unsubscribe";
import { sendTransactionalEmail, type SendResult } from "./sendEmail";
import { isCommercialProperty } from "@/lib/filters/fundamentals";

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "there";

/** Which set of figures actually applies to this listing. */
export type LeadLane =
  | "residential-sale"
  | "residential-lease"
  | "commercial-sale"
  | "commercial-lease";

/** The CTA-ladder intents from api/viewing-requests. Mirrors INTENT_LABELS there. */
export type LeadIntent = "viewing" | "question" | "price_opinion";

export interface LeadFollowUpInput {
  name: string;
  address?: string | null;
  listingKey: string;
  email: string;
  /** What they clicked. Defaults to a viewing request, the original single path. */
  intent?: LeadIntent;
  /** Resolved by fetchLeadLane. Defaults to the residential sale copy. */
  lane?: LeadLane;
}

/**
 * Pure classifier. `TransactionType` is the field to trust for sale-vs-lease — the
 * status string does not carry it. `PropertyType` is the TRREB class facet and
 * "Commercial" is its exact spelling, so isCommercialProperty stays the single
 * definition of that boundary (filters/fundamentals.ts).
 */
export function classifyLeadLane(facts: {
  transactionType?: string | null;
  propertyType?: string | null;
}): LeadLane {
  const lease = /lease/i.test(String(facts.transactionType ?? ""));
  const commercial = isCommercialProperty(facts.propertyType);
  if (commercial) return lease ? "commercial-lease" : "commercial-sale";
  return lease ? "residential-lease" : "residential-sale";
}

/**
 * Read the two facts the copy branches on. Best-effort: a lead must never fail because
 * we could not classify it, so every error path falls back to the residential sale lane
 * (the original copy, and the bulk of the book).
 *
 * The select pulls the two jsonb values as scalars rather than the whole `full_payload`.
 * One PK row detoasts once either way, but returning the raw payload would ship a large
 * MLS record over the wire for two short strings. Neither field has a promoted column on
 * `listings` today; switch to one if it lands.
 */
export async function fetchLeadLane(
  supabase: SupabaseClient,
  listingKey: string
): Promise<LeadLane> {
  try {
    const { data, error } = await supabase
      .from("listings")
      .select(
        "transaction_type:full_payload->>TransactionType,property_type:full_payload->>PropertyType"
      )
      .eq("listing_key", listingKey)
      .maybeSingle();
    if (error || !data) return "residential-sale";
    const row = data as { transaction_type?: string | null; property_type?: string | null };
    return classifyLeadLane({
      transactionType: row.transaction_type,
      propertyType: row.property_type,
    });
  } catch {
    return "residential-sale";
  }
}

/**
 * What we promise to send, per lane. Every entry is plain language — no term appears
 * that the same sentence does not also explain.
 */
const LANE_FIGURES: Record<LeadLane, string[]> = {
  "residential-sale": [
    "how long it has really been on the market, counting the earlier listings if it came down and went back up",
    "every asking-price change since it first came up",
    "what it costs to own each month, including the mortgage, the property tax and the condo fee where there is one",
  ],
  "residential-lease": [
    "how long the unit has been up, counting the earlier listings if it came down and went back up",
    "every asking-rent change since it first came up",
    "what the rent covers, such as heat, water, parking and a locker",
    "what comparable units nearby actually rented for, not what they asked",
  ],
  "commercial-sale": [
    "how long it has been on the market, counting the earlier listings if it came down and went back up",
    "every asking-price change since it first came up",
    "the zoning, and what that zoning lets you operate there",
    "the annual property tax, and the TMI — your share of the building's taxes, maintenance and insurance",
  ],
  "commercial-lease": [
    "how the rent is quoted, because a price per square foot per year and a monthly rent are not comparable until you convert one",
    "the TMI — your share of the building's taxes, maintenance and insurance, which you pay on top of the base rent",
    "the usable area, and how it compares to the total area you are quoted",
    "the zoning, and what that zoning lets you operate there",
  ],
};

/** Preheader per lane. Plain, and true to what the body promises. */
const LANE_PREHEADER: Record<LeadLane, string> = {
  "residential-sale": "The numbers behind this listing are on the way.",
  "residential-lease": "The rent history behind this listing is on the way.",
  "commercial-sale": "The numbers behind this listing are on the way.",
  "commercial-lease": "The rent basis and the TMI on this one are on the way.",
};

/**
 * Subject + opening line per intent. The old subject opened with "Re:", which implies a
 * reply to a message that never existed — a small deception on first contact, and a
 * pattern some spam filters score against.
 */
const INTENT_COPY: Record<LeadIntent, { subject: (where: string) => string; opener: string }> = {
  viewing: {
    subject: (where) => `Your viewing request — ${where}`,
    opener: "Got your viewing request on",
  },
  question: {
    subject: (where) => `Your question about ${where}`,
    opener: "Got your question about",
  },
  price_opinion: {
    subject: (where) => `Your price check on ${where}`,
    opener: "Got your request for a price check on",
  },
};

export function renderLeadFollowUpEmail(input: LeadFollowUpInput): {
  subject: string;
  html: string;
  text: string;
} {
  const where = (input.address && input.address.trim()) || "the property you asked about";
  const fn = firstName(input.name);
  const lane = input.lane ?? "residential-sale";
  const intent = input.intent ?? "viewing";
  const unsub = marketingUnsubscribeUrl(input.email, SITE);

  const { subject: subjectOf, opener } = INTENT_COPY[intent];
  const subject = subjectOf(where);
  const preheader = LANE_PREHEADER[lane];
  const figures = LANE_FIGURES[lane];

  const items = figures.map((f) => `<li style="margin:0 0 8px;">${esc(f)}</li>`).join("");

  const body = `
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 14px;">Hi ${esc(fn)},</p>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 14px;">${esc(opener)} <b>${esc(where)}</b>. I'll come back to you personally, and soon, with the figures that matter on this one:</p>
    <ul style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 18px;padding-left:20px;">${items}</ul>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 22px;">Is there anything specific you want me to check first?</p>
    <p style="font-size:15px;line-height:1.65;color:#0f172a;margin:0;">— Tanmay, PureProperty</p>
    <p style="color:#94a3b8;font-size:11px;margin-top:30px;line-height:1.6;">You asked us about this property on PureProperty.ca. <a href="${unsub}" style="color:#94a3b8;">Not interested — stop these</a>.</p>`;

  const text = [
    `Hi ${fn},`,
    "",
    `${opener} ${where}. I'll come back to you personally, and soon, with the figures that matter on this one:`,
    "",
    ...figures.map((f) => `- ${f}`),
    "",
    "Is there anything specific you want me to check first?",
    "",
    "— Tanmay, PureProperty",
    "",
    `Not interested — stop these: ${unsub}`,
  ].join("\n");

  return { subject, html: plainNote({ preheader, body }), text };
}

/** Best-effort send. Never throws to the caller (a failed follow-up must not fail the
 *  lead capture). No-ops without RESEND_API_KEY. */
export async function sendLeadFollowUp(input: LeadFollowUpInput): Promise<SendResult> {
  const { subject, html, text } = renderLeadFollowUpEmail(input);
  return sendTransactionalEmail({
    kind: "lead-follow-up",
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
