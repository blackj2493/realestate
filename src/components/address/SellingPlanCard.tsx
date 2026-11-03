"use client";

/**
 * SellingPlanCard — the seller offer on address pages (2026-11).
 *
 * WHY HERE. A homeowner on their own address page is already looking at prices. That is
 * the moment help is welcome; the same offer at signup read as a sales funnel, so it lives
 * here (owner decision 2026-11-03). Generic "a licensed REALTOR®", no personal or brokerage
 * name (owner decision). The four points are answered from the site's own data: real sold
 * prices on the street, true time to sell (relists counted), which upgrades pay, and timing
 * plus today's competition.
 */

import OfferRequestCard, { type OfferCopy } from "./OfferRequestCard";

export const SELLING_PLAN_COPY: OfferCopy = {
  title: "Thinking of selling? Get a selling plan for your home.",
  intro: "A licensed REALTOR® prepares it from your street’s real sales:",
  points: [
    "the price to list at, and what similar homes actually sold for",
    "how long homes like yours really take to sell, counting relists",
    "which upgrades are worth doing before you list, and which are not",
    "when to list, and which homes you will compete with today",
  ],
  footnote: "Free. No calls unless you ask for one.",
  openLabel: "Get my selling plan",
  sentText: (address, email) => `Request sent. Your selling plan for ${address} is on its way to ${email}.`,
  messagePlaceholder: "e.g. finished basement, new roof in 2023, hoping to list in spring",
};

export default function SellingPlanCard({ address }: { address: string }) {
  return <OfferRequestCard address={address} intent="selling_plan" copy={SELLING_PLAN_COPY} />;
}
