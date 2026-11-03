/**
 * Lead follow-up — the INSTANT auto-acknowledgement to someone who submits a viewing /
 * question / price-opinion request (api/viewing-requests). Tier-0 speed-to-lead: the top
 * of the brokerage funnel.
 *
 * Mode B "plain note" from the human identity (SENDERS.leadFollowUp = Tanmay), signed
 * with the registrant's full name, brokerage and direct line (voice.md §3, updated
 * 2026-11-03).
 *
 * VIEWING REQUESTS ASK FOR A TIME, NOT FOR PATIENCE. October 2026: a renter replied to
 * the old "figures are on the way" note within 11 minutes asking to view the unit in an
 * hour. The note gave her no phone number and promised rent history she did not ask
 * for. A viewing request is a request to book, so that lane now asks for two times and
 * gives the number to text. The figure lists below apply to questions and price checks.
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
export type LeadIntent = "viewing" | "question" | "price_opinion" | "selling_plan";

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
  selling_plan: {
    subject: (where) => `Your selling plan — ${where}`,
    opener: "Got your request for a selling plan for",
  },
};

/** What a homeowner's selling plan covers — the same four points the address-page card promises. */
const SELLING_PLAN_FIGURES = [
  "the price to list at, and what similar homes on and near your street actually sold for",
  "how long homes like yours really take to sell, counting the ones that came down and went back up",
  "which upgrades are worth doing before you list, and which are not",
  "when to list, and which homes you would be competing with today",
];

/**
 * The one thing a viewing lead should send back, per lane. A landlord decides on a
 * tenant fast, so the tenant lanes ask for what the landlord asks first.
 */
const VIEWING_ASK: Record<LeadLane, string | null> = {
  "residential-sale": null,
  "residential-lease":
    "So the landlord can say yes quickly, it helps to send your move-in date and how many people will live there.",
  "commercial-sale": "It helps to know what you plan to run there, so I can check the zoning first.",
  "commercial-lease":
    "It helps to know what you plan to run there and when you need it, so I can check with the landlord first.",
};

const P = `font-size:15px;line-height:1.65;color:#0f172a;margin:0 0 14px;`;

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
  const { phone, name, credential } = SENDERS.leadFollowUp;

  const { subject: subjectOf, opener } = INTENT_COPY[intent];
  const subject = subjectOf(where);

  // Each paragraph is plain text; html and text are built from the same list so the two
  // parts can never say different things.
  let preheader: string;
  let paras: string[];
  let figures: string[] = [];
  if (intent === "viewing") {
    preheader = `Reply with a time, or text me at ${phone}.`;
    paras = [
      `${opener} ${where}. I can set up a showing.`,
      `Reply with two times that work for you, or call or text me at ${phone} — a text is the fastest way to book.`,
      ...(VIEWING_ASK[lane] ? [VIEWING_ASK[lane] as string] : []),
    ];
  } else if (intent === "selling_plan") {
    preheader = "Your selling plan is on the way.";
    figures = SELLING_PLAN_FIGURES;
    paras = [`${opener} ${where}. I'll send it to you personally, soon. It will cover:`];
  } else {
    preheader = LANE_PREHEADER[lane];
    figures = LANE_FIGURES[lane];
    paras = [
      `${opener} ${where}. I'll come back to you personally, and soon, with the figures that matter on this one:`,
    ];
  }
  const closing =
    intent === "viewing"
      ? []
      : [`Is there anything specific you want me to check first? If a call is easier, call or text me at ${phone}.`];

  const items = figures.map((f) => `<li style="margin:0 0 8px;">${esc(f)}</li>`).join("");
  const htmlPara = (s: string, i: number) =>
    i === 0 && s.includes(where)
      ? `<p style="${P}">${esc(s).replace(esc(where), `<b>${esc(where)}</b>`)}</p>`
      : `<p style="${P}">${esc(s)}</p>`;

  const body = `
    <p style="${P}">Hi ${esc(fn)},</p>
    ${paras.map(htmlPara).join("\n    ")}
    ${items ? `<ul style="${P}margin:0 0 18px;padding-left:20px;">${items}</ul>` : ""}
    ${closing.map((s) => `<p style="${P}">${esc(s)}</p>`).join("")}
    <p style="${P}margin:22px 0 0;">— ${esc(name)}<br><span style="color:#475569;font-size:13px;">${esc(credential)} · ${esc(phone)}</span></p>
    <p style="color:#94a3b8;font-size:11px;margin-top:30px;line-height:1.6;">You asked us about this property on PureProperty.ca. <a href="${unsub}" style="color:#94a3b8;">Not interested — stop these</a>.</p>`;

  const text = [
    `Hi ${fn},`,
    "",
    ...paras.flatMap((p) => [p, ""]),
    ...(figures.length ? [...figures.map((f) => `- ${f}`), ""] : []),
    ...closing.flatMap((p) => [p, ""]),
    `— ${name}`,
    `${credential} · ${phone}`,
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
