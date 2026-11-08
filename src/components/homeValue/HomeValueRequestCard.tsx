"use client";

/**
 * The /home-value request form: a homeowner asks for a free written price opinion on
 * THEIR home. Client wrapper (like SellingPlanCard) because the copy carries a function
 * (sentText), which a server page cannot pass to a client component. One pipeline:
 * OfferRequestCard -> /api/viewing-requests with intent "home_value". No valuation on the
 * page; a person sends the opinion by email.
 */
import OfferRequestCard, { type OfferCopy } from "@/components/address/OfferRequestCard";
import { REPLY_PROMISE } from "./HomeValueExtras";

export const HOME_VALUE_COPY: OfferCopy = {
  title: "Get a free price opinion for your home",
  intro: "We send you, by email:",
  points: [
    "what your home is likely worth today, as a range, and why",
    "what similar homes near you actually sold for",
    "what your home last sold for, updated for the market since then",
    "what could move the number up or down: condition, upgrades and timing",
  ],
  footnote: `Free. No obligation. No calls unless you ask for one. ${REPLY_PROMISE}`,
  openLabel: "Get my price opinion",
  sentText: (address, email) => `Request sent. Your price opinion for ${address} is on its way to ${email}.`,
  messagePlaceholder: "e.g. 3-bedroom semi, finished basement, new kitchen in 2022",
};

export default function HomeValueRequestCard({ city }: { city: string | null }) {
  return (
    <OfferRequestCard
      address=""
      intent="home_value"
      copy={HOME_VALUE_COPY}
      askAddress={{ label: "Your home's address", placeholder: city ? `e.g. 12 Main Street, ${city}` : "e.g. 12 Main Street, Markham" }}
      startOpen
    />
  );
}
