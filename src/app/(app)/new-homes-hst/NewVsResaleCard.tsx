"use client";

import OfferRequestCard, { type OfferCopy } from "@/components/address/OfferRequestCard";

/** Lead offer: a written new vs resale comparison. Same pipeline as the address-page offers. */
const COPY: OfferCopy = {
  title: "Choosing between a new home and a resale home?",
  intro: "Tell us the homes or the area. We compare them for you and send it by email:",
  points: [
    "whether the new home qualifies for the HST relief, and how much it is",
    "what similar new and nearly-new homes nearby actually sold for",
    "how much room there is to negotiate on each",
    "the questions to ask the builder before you sign",
  ],
  footnote: "Free, sent to your inbox. No calls unless you ask for one.",
  openLabel: "Compare them for me",
  sentText: (where, email) => `Request sent. Your comparison for ${where} is on its way to ${email}.`,
  messagePlaceholder: "e.g. a new townhouse in Milton vs a 3-year-old one in Oakville, budget $1M",
};

export default function NewVsResaleCard() {
  return (
    <OfferRequestCard
      address=""
      intent="new_vs_resale"
      copy={COPY}
      askAddress={{ label: "Homes or area you are comparing", placeholder: "Addresses, links, or a neighbourhood" }}
    />
  );
}
