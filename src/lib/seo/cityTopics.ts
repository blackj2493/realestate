/**
 * The city question pages (market facts, days on market, power of sale, homes not selling,
 * home value, price change, condo prices, good time to buy, basement value)
 * and their paths, in one module so every page can link all of them. Search engines and AI
 * answer engines find and weigh pages through internal links: before this, a city hub linked
 * only the market page and a neighbourhood page linked none.
 *
 * The paths repeat the per-family helpers (outlookPath, powerOfSalePath, notSellingPath,
 * homeValuePath) as plain strings so that this module imports no page component (the views
 * render CityTopicLinks, so importing them back would be a cycle). cityTopics.test.ts pins
 * each string to its helper.
 */
import { OUTLOOK_CITIES } from "@/lib/data/outlookCities";

export type CityTopic = "market" | "days-on-market" | "power-of-sale" | "not-selling" | "home-value" | "basement-value" | "price-change" | "condo-prices" | "good-time-to-buy";

export const daysOnMarketPath = (slug?: string) => (slug ? `/data/days-on-market/${slug}` : "/data/days-on-market");

export const CITY_TOPICS: { id: CityTopic; hub: string; path: (slug: string) => string; label: (city: string) => string }[] = [
  { id: "market", hub: "/data/housing-market", path: (s) => `/data/housing-market/${s}`, label: (c) => `${c} housing market, month by month` },
  { id: "days-on-market", hub: "/data/days-on-market", path: (s) => daysOnMarketPath(s), label: (c) => `How long homes take to sell in ${c}` },
  { id: "power-of-sale", hub: "/power-of-sale", path: (s) => `/power-of-sale/${s}`, label: (c) => `Power of sale homes in ${c}` },
  { id: "not-selling", hub: "/house-not-selling", path: (s) => `/house-not-selling/${s}`, label: (c) => `Why homes do not sell in ${c}` },
  { id: "home-value", hub: "/home-value", path: (s) => `/home-value/${s}`, label: (c) => `What is my home worth in ${c}?` },
  { id: "price-change", hub: "/data/price-change", path: (s) => `/data/price-change/${s}`, label: (c) => `Are home prices dropping in ${c}?` },
  { id: "condo-prices", hub: "/data/condo-prices", path: (s) => `/data/condo-prices/${s}`, label: (c) => `${c} condo prices and fees` },
  { id: "good-time-to-buy", hub: "/data/good-time-to-buy", path: (s) => `/data/good-time-to-buy/${s}`, label: (c) => `Is it a good time to buy in ${c}?` },
  { id: "basement-value", hub: "/data/basement-value", path: (s) => `/data/basement-value/${s}`, label: (c) => `Does a finished basement add value in ${c}?` },
];

export const TOPIC_HUBS: { href: string; label: string }[] = [
  { href: "/data/housing-market", label: "Housing market by city" },
  { href: "/data/days-on-market", label: "How long homes take to sell" },
  { href: "/power-of-sale", label: "Power of sale in Ontario" },
  { href: "/house-not-selling", label: "Why homes do not sell" },
  { href: "/home-value", label: "Free home value opinion" },
  { href: "/data/price-change", label: "Are home prices dropping? Same-home change" },
  { href: "/data/condo-prices", label: "Condo prices and fees by city" },
  { href: "/data/good-time-to-buy", label: "Is it a good time to buy?" },
  { href: "/data/basement-value", label: "What a finished basement adds" },
];

/** The covered city for a hub slug (e.g. "markham" or "Markham"), else null. */
export function topicCity(slug: string | null | undefined): { city: string; slug: string } | null {
  if (!slug) return null;
  return OUTLOOK_CITIES.find((c) => c.slug === slug.toLowerCase()) ?? null;
}
