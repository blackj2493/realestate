"use client";

/**
 * The /house-not-selling request form: a seller asks for a free written second opinion on
 * their asking price. Same pipeline as /home-value (OfferRequestCard -> intent "home_value";
 * a person replies by email). Client wrapper because the copy carries a function.
 *
 * RECO: many of these sellers have a listing agreement with another brokerage. The copy
 * offers an opinion only and says, in the card, that we do not ask anyone to change agents
 * or end a listing. Do not add switching language here.
 */
import OfferRequestCard, { type OfferCopy } from "@/components/address/OfferRequestCard";
import { REPLY_PROMISE } from "@/components/homeValue/HomeValueExtras";

const COPY: OfferCopy = {
  title: "Get a free second opinion on your asking price",
  intro: "We send you, by email:",
  points: [
    "a price range for your home, and why",
    "what similar homes near you actually sold for",
    "how your asking price compares with those sales",
  ],
  footnote: `Free. No obligation. If your home is listed with an agent, we do not ask you to change agents or to end your listing. ${REPLY_PROMISE}`,
  openLabel: "Get my second opinion",
  sentText: (address, email) => `Request sent. Your price opinion for ${address} is on its way to ${email}.`,
  messagePlaceholder: "e.g. listed at $1,099,000 since August, one price cut",
};

export default function NotSellingRequestCard({ city }: { city: string | null }) {
  return (
    <OfferRequestCard
      address=""
      intent="home_value"
      copy={COPY}
      askAddress={{ label: "Your home's address", placeholder: city ? `e.g. 12 Main Street, ${city}` : "e.g. 12 Main Street, Markham" }}
      startOpen
    />
  );
}
