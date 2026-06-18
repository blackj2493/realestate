/**
 * Lead-intent config — the rungs of the listing-page CTA ladder.
 *
 * All rungs route through the SAME lead pipeline (`/api/viewing-requests` →
 * `viewing_requests` table). The intent only changes copy + how the owner-facing
 * email/record is tagged — so no new table/column (no migration) is needed.
 */

export type LeadIntent = "viewing" | "question" | "price_opinion";

export interface LeadIntentDef {
  id: LeadIntent;
  /** Button text on the ladder. */
  rungLabel: string;
  /** Small subtext under the rung. */
  rungHint: string;
  /** Heading inside the opened form. */
  heading: string;
  /** Label above the free-text field. */
  messageLabel: string;
  /** Submit button text. */
  submitLabel: string;
  /** Free-text placeholder. */
  placeholder: string;
  /** Only "viewing" needs a preferred-time picker. */
  showTime: boolean;
}

export const LEAD_INTENTS: Record<LeadIntent, LeadIntentDef> = {
  viewing: {
    id: "viewing",
    rungLabel: "Book a viewing",
    rungHint: "See it in person",
    heading: "Schedule a Viewing",
    messageLabel: "Message",
    submitLabel: "Request Viewing",
    placeholder: "Anything specific you'd like to see?",
    showTime: true,
  },
  question: {
    id: "question",
    rungLabel: "Ask a question",
    rungHint: "A quick question to the listing team",
    heading: "Ask about this listing",
    messageLabel: "Your question",
    submitLabel: "Send question",
    placeholder: "e.g. Is it tenanted? Any pending special assessment? What's the real monthly hydro + gas?",
    showTime: false,
  },
  price_opinion: {
    id: "price_opinion",
    rungLabel: "Get a 2nd opinion on price",
    rungHint: "Our read on whether it's fairly priced",
    heading: "Get a second opinion on the price",
    messageLabel: "Anything to add?",
    submitLabel: "Request our read",
    placeholder: "We'll reply with our take on the price vs recent comparable sales.",
    showTime: false,
  },
};

/** Rungs in ladder order (primary first). */
export const LEAD_INTENT_IDS: LeadIntent[] = ["viewing", "question", "price_opinion"];

export function isLeadIntent(v: unknown): v is LeadIntent {
  return v === "viewing" || v === "question" || v === "price_opinion";
}

/** Optional message seed for an intent, using listing context. */
export function seedMessageFor(intent: LeadIntent, ctx: { priceText?: string; address?: string }): string {
  if (intent === "price_opinion") {
    return `Could you give me your read on whether ${ctx.priceText ?? "the asking price"} is fair for ${ctx.address ?? "this property"} versus recent comparable sales?`;
  }
  return "";
}
